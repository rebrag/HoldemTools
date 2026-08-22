// Controllers/PlayersController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize] // every action requires a verified Firebase ID token
    public class PlayersController : ControllerBase
    {
        // Name/Notes limits are enforced here rather than left to the column
        // definitions: the EF-InMemory test provider ignores HasMaxLength, and a
        // 400 beats a SQL truncation error either way.
        private const int MaxNameLength = 100;
        private const int MaxNotesLength = 4000;

        // Photos are client-downscaled (~512px JPEG) before upload, so anything
        // near this cap is a mistake, not a real avatar.
        private const long MaxPhotoBytes = 5 * 1024 * 1024;

        private readonly AppDbContext _db;
        private readonly IPlayerPhotoStore _photos;

        public PlayersController(AppDbContext db, IPlayerPhotoStore photos)
        {
            _db = db;
            _photos = photos;
        }

        public class PlayerUpsertDto
        {
            public string? Name { get; set; }
            public string? Notes { get; set; }
        }

        // The ADLS path stays server-side; clients get a has-photo flag plus a
        // timestamp to version their cached photo blobs by.
        public class PlayerDto
        {
            public Guid Id { get; set; }
            public string Name { get; set; } = default!;
            public string? Notes { get; set; }
            public bool HasPhoto { get; set; }
            public DateTimeOffset? PhotoUpdatedAt { get; set; }
            public DateTimeOffset CreatedAt { get; set; }
            public DateTimeOffset? UpdatedAt { get; set; }
        }

        private static PlayerDto ToDto(Player p) => new()
        {
            Id = p.Id,
            Name = p.Name,
            Notes = p.Notes,
            HasPhoto = p.PhotoPath != null,
            PhotoUpdatedAt = p.PhotoUpdatedAt,
            CreatedAt = p.CreatedAt,
            UpdatedAt = p.UpdatedAt,
        };

        // Validates and normalizes an upsert body. Returns null (with error set)
        // when the name is blank or a field exceeds its column bound.
        private static (string Name, string? Notes)? Normalize(PlayerUpsertDto? dto, out string? error)
        {
            var name = dto?.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                error = "name is required.";
                return null;
            }
            if (name.Length > MaxNameLength)
            {
                error = $"name must be at most {MaxNameLength} characters.";
                return null;
            }

            var notes = dto?.Notes?.Trim();
            if (string.IsNullOrEmpty(notes)) notes = null;
            if (notes != null && notes.Length > MaxNotesLength)
            {
                error = $"notes must be at most {MaxNotesLength} characters.";
                return null;
            }

            error = null;
            return (name, notes);
        }

        // Loads a player only when it belongs to the caller. A miss and another
        // user's row are indistinguishable (NotFound) so ids don't leak existence.
        private async Task<Player?> FindOwned(Guid id, string uid) =>
            await _db.Players.FirstOrDefaultAsync(p => p.Id == id && p.UserId == uid);

        // GET /api/players
        [HttpGet]
        public async Task<ActionResult<IEnumerable<PlayerDto>>> GetAll()
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var items = await _db.Players
                .Where(p => p.UserId == uid)
                .OrderBy(p => p.Name)
                .ThenBy(p => p.CreatedAt)
                .ToListAsync();

            return Ok(items.Select(ToDto));
        }

        // POST /api/players
        [HttpPost]
        public async Task<ActionResult<PlayerDto>> Create([FromBody] PlayerUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var normalized = Normalize(dto, out var error);
            if (normalized == null) return BadRequest(error);

            var entity = new Player
            {
                Id = Guid.NewGuid(),
                UserId = uid, // from the token, never the body
                Name = normalized.Value.Name,
                Notes = normalized.Value.Notes,
                CreatedAt = DateTimeOffset.UtcNow,
            };

            _db.Players.Add(entity);
            await _db.SaveChangesAsync();

            return Ok(ToDto(entity));
        }

        // PUT /api/players/{id}
        [HttpPut("{id:guid}")]
        public async Task<ActionResult<PlayerDto>> Update(Guid id, [FromBody] PlayerUpsertDto dto)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var normalized = Normalize(dto, out var error);
            if (normalized == null) return BadRequest(error);

            var entity = await FindOwned(id, uid);
            if (entity == null) return NotFound();

            entity.Name = normalized.Value.Name;
            entity.Notes = normalized.Value.Notes;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(ToDto(entity));
        }

        // DELETE /api/players/{id}
        // Hands referencing this player keep working: their seats carry the name
        // snapshot, and a dangling playerId is skipped by client-side filters.
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var entity = await FindOwned(id, uid);
            if (entity == null) return NotFound();

            var photoPath = entity.PhotoPath;
            _db.Players.Remove(entity);
            await _db.SaveChangesAsync();

            // After the row is gone: an orphaned blob beats a live row whose
            // blob delete failed.
            if (photoPath != null) await _photos.DeleteAsync(photoPath);

            return NoContent();
        }

        // ─────────────────────────── photo ───────────────────────────
        //
        // Reads are owner-only ([Authorize] + ownership check): these are photos
        // of real, identifiable people, so no leak-by-link ShareToken scheme and
        // never the anonymous api/files route. The frontend fetches with a bearer
        // token and displays via object URLs.

        private static readonly Dictionary<string, string> ExtByContentType = new()
        {
            ["image/jpeg"] = "jpg",
            ["image/png"] = "png",
            ["image/webp"] = "webp",
        };

        // Content-Type is client-asserted, so require the file's own magic bytes
        // to agree before storing anything.
        private static bool MatchesMagicBytes(string contentType, byte[] head)
        {
            switch (contentType)
            {
                case "image/jpeg":
                    return head.Length >= 2 && head[0] == 0xFF && head[1] == 0xD8;
                case "image/png":
                    return head.Length >= 4
                        && head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47;
                case "image/webp":
                    return head.Length >= 12
                        && head[0] == (byte)'R' && head[1] == (byte)'I' && head[2] == (byte)'F' && head[3] == (byte)'F'
                        && head[8] == (byte)'W' && head[9] == (byte)'E' && head[10] == (byte)'B' && head[11] == (byte)'P';
                default:
                    return false;
            }
        }

        // PUT /api/players/{id}/photo
        // Multipart form, field "file". Replaces any existing photo: the new blob
        // is written to a fresh unguessable path first, then the row is updated,
        // then the old blob is deleted best-effort - so PhotoPath is always a
        // valid version key and a crash mid-replace never loses the photo.
        [HttpPut("{id:guid}/photo")]
        [RequestSizeLimit(6 * 1024 * 1024)]
        public async Task<ActionResult<PlayerDto>> UploadPhoto(Guid id, IFormFile? file)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            if (file == null || file.Length == 0) return BadRequest("file is required.");
            if (file.Length > MaxPhotoBytes) return BadRequest("Photo must be 5 MB or smaller.");

            var contentType = file.ContentType?.ToLowerInvariant() ?? "";
            if (!ExtByContentType.TryGetValue(contentType, out var ext))
                return BadRequest("Photo must be a JPEG, PNG, or WebP image.");

            var entity = await FindOwned(id, uid);
            if (entity == null) return NotFound();

            // Buffer once (small by contract) so we can sniff and upload from
            // the same bytes.
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var bytes = ms.ToArray();
            var head = bytes.Length >= 12 ? bytes[..12] : bytes;
            if (!MatchesMagicBytes(contentType, head))
                return BadRequest("File content does not match its image type.");

            var newPath = $"playerphotos/{entity.UserId}/{entity.Id}/{ShareTokenGenerator.NewToken()}.{ext}";
            using (var upload = new MemoryStream(bytes))
            {
                await _photos.SaveAsync(newPath, upload);
            }

            var oldPath = entity.PhotoPath;
            entity.PhotoPath = newPath;
            entity.PhotoContentType = contentType;
            entity.PhotoUpdatedAt = DateTimeOffset.UtcNow;
            entity.UpdatedAt = entity.PhotoUpdatedAt;
            await _db.SaveChangesAsync();

            if (oldPath != null) await _photos.DeleteAsync(oldPath);

            return Ok(ToDto(entity));
        }

        // GET /api/players/{id}/photo
        [HttpGet("{id:guid}/photo")]
        public async Task<IActionResult> GetPhoto(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var entity = await FindOwned(id, uid);
            if (entity?.PhotoPath == null) return NotFound();

            // PhotoUpdatedAt changes on every replace, so its ticks are an exact
            // version key (and unlike a path hash, stable across process restarts).
            var etag = $"\"photo-{entity.PhotoUpdatedAt?.UtcTicks ?? 0}\"";
            Response.Headers.CacheControl = "private, max-age=86400";
            Response.Headers.ETag = etag;
            if (Request.Headers.IfNoneMatch.Contains(etag))
            {
                return StatusCode(StatusCodes.Status304NotModified);
            }

            var stream = await _photos.OpenReadAsync(entity.PhotoPath);
            if (stream == null) return NotFound(); // blob deleted out-of-band

            return File(stream, entity.PhotoContentType ?? "application/octet-stream");
        }

        // DELETE /api/players/{id}/photo
        [HttpDelete("{id:guid}/photo")]
        public async Task<IActionResult> DeletePhoto(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            var entity = await FindOwned(id, uid);
            if (entity == null) return NotFound();

            var oldPath = entity.PhotoPath;
            entity.PhotoPath = null;
            entity.PhotoContentType = null;
            entity.PhotoUpdatedAt = null;
            entity.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();

            if (oldPath != null) await _photos.DeleteAsync(oldPath);

            return NoContent();
        }
    }
}
