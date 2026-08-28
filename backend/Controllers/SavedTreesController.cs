// Controllers/SavedTreesController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    // The user's saved-tree library: named tree-building configurations
    // organised into nestable folders, so a spot built once on /compare can be
    // reloaded rather than rebuilt. Deliberately a near-copy of
    // SavedRangesController - the two libraries have identical shapes and
    // identical failure modes, and the picker on the client is the same
    // component pattern, so keeping them structurally parallel is worth more
    // than the abstraction that would remove the duplication.
    //
    // The whole library is small (tens of rows) and the picker always renders
    // all of it, so the read side is a single GET returning both tables. That
    // keeps the client from having to fetch a folder's contents on expand and
    // makes the folder tree render without a loading state per node.
    [ApiController]
    [Route("api/[controller]")]
    [Authorize] // every action here requires a verified Firebase ID token
    public class SavedTreesController : ControllerBase
    {
        // Enforced here rather than left to the column definitions: the
        // EF-InMemory test provider ignores HasMaxLength, and a 400 beats a SQL
        // truncation error either way.
        private const int MaxNameLength = 100;
        // Matches SavedTree.Config's column bound. A tree carrying two full
        // 169-class ranges serializes to a few KB, so this leaves real headroom.
        private const int MaxConfigLength = 16000;

        // A folder tree deeper than this is a mistake or an attack, not a
        // library. Bounds the recursive walks below.
        private const int MaxFolderDepth = 32;

        private readonly AppDbContext _db;

        public SavedTreesController(AppDbContext db)
        {
            _db = db;
        }

        public class FolderDto
        {
            public Guid Id { get; set; }
            public string Name { get; set; } = default!;
            public Guid? ParentId { get; set; }
            public DateTimeOffset CreatedAt { get; set; }
            public DateTimeOffset? UpdatedAt { get; set; }
        }

        public class TreeDto
        {
            public Guid Id { get; set; }
            public string Name { get; set; } = default!;
            public Guid? FolderId { get; set; }
            public string Config { get; set; } = default!;
            public DateTimeOffset CreatedAt { get; set; }
            public DateTimeOffset? UpdatedAt { get; set; }
        }

        public class LibraryDto
        {
            public List<FolderDto> Folders { get; set; } = new();
            public List<TreeDto> Trees { get; set; } = new();
        }

        public class FolderUpsertDto
        {
            public string? Name { get; set; }
            public Guid? ParentId { get; set; }
        }

        public class TreeUpsertDto
        {
            public string? Name { get; set; }
            public Guid? FolderId { get; set; }
            public string? Config { get; set; }
        }

        private static FolderDto ToDto(TreeFolder f) => new()
        {
            Id = f.Id,
            Name = f.Name,
            ParentId = f.ParentId,
            CreatedAt = f.CreatedAt,
            UpdatedAt = f.UpdatedAt,
        };

        private static TreeDto ToDto(SavedTree r) => new()
        {
            Id = r.Id,
            Name = r.Name,
            FolderId = r.FolderId,
            Config = r.Config,
            CreatedAt = r.CreatedAt,
            UpdatedAt = r.UpdatedAt,
        };

        // Loads a row only when it belongs to the caller. A miss and another
        // user's row are indistinguishable (NotFound) so ids don't leak existence.
        private Task<TreeFolder?> FindOwnedFolder(Guid id, string uid) =>
            _db.TreeFolders.FirstOrDefaultAsync(f => f.Id == id && f.UserId == uid)!;

        private Task<SavedTree?> FindOwnedTree(Guid id, string uid) =>
            _db.SavedTrees.FirstOrDefaultAsync(r => r.Id == id && r.UserId == uid)!;

        private static string? NormalizeName(string? raw, out string? error)
        {
            error = null;
            var name = (raw ?? string.Empty).Trim();
            if (name.Length == 0)
            {
                error = "Name is required.";
                return null;
            }
            if (name.Length > MaxNameLength)
            {
                error = $"Name must be {MaxNameLength} characters or fewer.";
                return null;
            }
            return name;
        }

        /// <summary>
        /// Verifies a supplied parent/folder id exists and belongs to the caller.
        /// A null id means "the library root", which is always valid.
        /// </summary>
        private async Task<bool> ParentIsUsable(Guid? parentId, string uid)
        {
            if (parentId == null) return true;
            return await _db.TreeFolders.AnyAsync(f => f.Id == parentId && f.UserId == uid);
        }

        /// <summary>
        /// True when <paramref name="candidateParent"/> is <paramref name="folderId"/>
        /// itself or sits inside its subtree. Moving a folder into its own
        /// subtree would orphan that subtree from the root and make the library
        /// unreachable, so it is rejected rather than repaired.
        /// </summary>
        private async Task<bool> WouldCycle(Guid folderId, Guid? candidateParent, string uid)
        {
            var cursor = candidateParent;
            for (var hops = 0; cursor != null && hops <= MaxFolderDepth; hops++)
            {
                if (cursor == folderId) return true;
                var parent = await _db.TreeFolders
                    .Where(f => f.Id == cursor && f.UserId == uid)
                    .Select(f => f.ParentId)
                    .FirstOrDefaultAsync();
                cursor = parent;
            }
            // Ran past the depth bound: treat as a cycle rather than looping.
            return cursor != null;
        }

        // GET /api/savedtrees
        // The whole library in one payload - see the note on the class.
        [HttpGet]
        public async Task<ActionResult<LibraryDto>> GetAll()
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var folders = await _db.TreeFolders
                .Where(f => f.UserId == uid)
                .OrderBy(f => f.Name)
                .ThenBy(f => f.CreatedAt)
                .ToListAsync();

            var trees = await _db.SavedTrees
                .Where(r => r.UserId == uid)
                .OrderBy(r => r.Name)
                .ThenBy(r => r.CreatedAt)
                .ToListAsync();

            return Ok(new LibraryDto
            {
                Folders = folders.Select(ToDto).ToList(),
                Trees = trees.Select(ToDto).ToList(),
            });
        }

        // ─────────────────────────── folders ───────────────────────────

        // POST /api/savedtrees/folders
        [HttpPost("folders")]
        public async Task<ActionResult<FolderDto>> CreateFolder([FromBody] FolderUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var name = NormalizeName(dto?.Name, out var error);
            if (name == null) return BadRequest(error);

            if (!await ParentIsUsable(dto!.ParentId, uid)) return BadRequest("Unknown parent folder.");

            var entity = new TreeFolder
            {
                Id = Guid.NewGuid(),
                UserId = uid, // from the token, never the body
                Name = name,
                ParentId = dto.ParentId,
                CreatedAt = DateTimeOffset.UtcNow,
            };

            _db.TreeFolders.Add(entity);
            await _db.SaveChangesAsync();

            return Ok(ToDto(entity));
        }

        // PUT /api/savedtrees/folders/{id}  - rename and/or move
        [HttpPut("folders/{id:guid}")]
        public async Task<ActionResult<FolderDto>> UpdateFolder(Guid id, [FromBody] FolderUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var name = NormalizeName(dto?.Name, out var error);
            if (name == null) return BadRequest(error);

            var entity = await FindOwnedFolder(id, uid);
            if (entity == null) return NotFound();

            if (!await ParentIsUsable(dto!.ParentId, uid)) return BadRequest("Unknown parent folder.");
            if (await WouldCycle(id, dto.ParentId, uid))
            {
                return BadRequest("A folder cannot be moved inside itself.");
            }

            entity.Name = name;
            entity.ParentId = dto.ParentId;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(ToDto(entity));
        }

        // DELETE /api/savedtrees/folders/{id}
        //
        // Deletes the folder and every folder beneath it. Trees are NOT deleted
        // with it - they fall back to the library root. Losing a built tree to a
        // mis-clicked folder delete is a much worse outcome than an untidy root,
        // and there is no undo here.
        [HttpDelete("folders/{id:guid}")]
        public async Task<IActionResult> DeleteFolder(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var entity = await FindOwnedFolder(id, uid);
            if (entity == null) return NotFound();

            // One read of the user's folders, then walk in memory: the library is
            // small, and this avoids a query per level.
            var all = await _db.TreeFolders.Where(f => f.UserId == uid).ToListAsync();
            var childrenOf = all
                .Where(f => f.ParentId != null)
                .GroupBy(f => f.ParentId!.Value)
                .ToDictionary(g => g.Key, g => g.ToList());

            var doomed = new List<TreeFolder>();
            var queue = new Queue<TreeFolder>();
            queue.Enqueue(entity);
            var seen = new HashSet<Guid> { entity.Id };
            while (queue.Count > 0)
            {
                var folder = queue.Dequeue();
                doomed.Add(folder);
                if (!childrenOf.TryGetValue(folder.Id, out var kids)) continue;
                foreach (var kid in kids)
                {
                    // `seen` also stops a cycle that somehow reached the table
                    // from turning this into an infinite loop.
                    if (seen.Add(kid.Id)) queue.Enqueue(kid);
                }
            }

            var doomedIds = doomed.Select(f => f.Id).ToHashSet();

            var orphaned = await _db.SavedTrees
                .Where(r => r.UserId == uid && r.FolderId != null && doomedIds.Contains(r.FolderId!.Value))
                .ToListAsync();
            foreach (var tree in orphaned)
            {
                tree.FolderId = null;
                tree.UpdatedAt = DateTimeOffset.UtcNow;
            }

            // Deepest first, so no row is removed while another still points at it
            // (the FK is Restrict, not Cascade - see AppDbContext).
            doomed.Reverse();
            _db.TreeFolders.RemoveRange(doomed);

            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ─────────────────────────── trees ───────────────────────────

        private static string? NormalizeConfig(string? raw, out string? error)
        {
            error = null;
            var config = (raw ?? string.Empty).Trim();
            if (config.Length == 0)
            {
                error = "A saved tree cannot be empty.";
                return null;
            }
            if (config.Length > MaxConfigLength)
            {
                error = $"Tree configuration is too large ({config.Length} characters).";
                return null;
            }
            return config;
        }

        // POST /api/savedtrees/trees
        [HttpPost("trees")]
        public async Task<ActionResult<TreeDto>> CreateTree([FromBody] TreeUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var name = NormalizeName(dto?.Name, out var nameError);
            if (name == null) return BadRequest(nameError);

            var config = NormalizeConfig(dto!.Config, out var configError);
            if (config == null) return BadRequest(configError);

            if (!await ParentIsUsable(dto.FolderId, uid)) return BadRequest("Unknown folder.");

            var entity = new SavedTree
            {
                Id = Guid.NewGuid(),
                UserId = uid, // from the token, never the body
                Name = name,
                FolderId = dto.FolderId,
                Config = config,
                CreatedAt = DateTimeOffset.UtcNow,
            };

            _db.SavedTrees.Add(entity);
            await _db.SaveChangesAsync();

            return Ok(ToDto(entity));
        }

        // PUT /api/savedtrees/trees/{id}  - rename, move and/or overwrite
        [HttpPut("trees/{id:guid}")]
        public async Task<ActionResult<TreeDto>> UpdateTree(Guid id, [FromBody] TreeUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var name = NormalizeName(dto?.Name, out var nameError);
            if (name == null) return BadRequest(nameError);

            var config = NormalizeConfig(dto!.Config, out var configError);
            if (config == null) return BadRequest(configError);

            var entity = await FindOwnedTree(id, uid);
            if (entity == null) return NotFound();

            if (!await ParentIsUsable(dto.FolderId, uid)) return BadRequest("Unknown folder.");

            entity.Name = name;
            entity.FolderId = dto.FolderId;
            entity.Config = config;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(ToDto(entity));
        }

        // DELETE /api/savedtrees/trees/{id}
        [HttpDelete("trees/{id:guid}")]
        public async Task<IActionResult> DeleteTree(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var entity = await FindOwnedTree(id, uid);
            if (entity == null) return NotFound();

            _db.SavedTrees.Remove(entity);
            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}
