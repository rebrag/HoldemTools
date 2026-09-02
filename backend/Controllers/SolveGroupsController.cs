// Controllers/SolveGroupsController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// The caller's saved solve groups: named, ordered rotations of push/fold
    /// jobs for the /multiway session simulator. Small (a handful of groups,
    /// a handful of members each) and always read whole, so the read side is
    /// one GET and a write replaces the member list outright - there is no
    /// per-member endpoint to keep consistent.
    /// </summary>
    [ApiController]
    [Route("api/solvegroups")]
    [Authorize]
    public class SolveGroupsController : ControllerBase
    {
        // Enforced here rather than left to the column definitions: the
        // EF-InMemory test provider ignores HasMaxLength, and a 400 beats a SQL
        // truncation error either way.
        public const int MaxNameLength = 100;
        // A rotation longer than this is a mistake, not a plan; it also bounds
        // the ownership check below to one small IN query.
        public const int MaxMembers = 64;

        private readonly AppDbContext _db;

        public SolveGroupsController(AppDbContext db)
        {
            _db = db;
        }

        public class GroupDto
        {
            public Guid Id { get; set; }
            public string Name { get; set; } = default!;
            /// <summary>Member job ids in rotation order; a job may repeat.</summary>
            public Guid[] JobIds { get; set; } = Array.Empty<Guid>();
            public DateTimeOffset CreatedAtUtc { get; set; }
            public DateTimeOffset? UpdatedAtUtc { get; set; }

            public static GroupDto From(SolveGroup g) => new()
            {
                Id = g.Id,
                Name = g.Name,
                JobIds = g.Members.OrderBy(m => m.Position).Select(m => m.JobId).ToArray(),
                CreatedAtUtc = g.CreatedAtUtc,
                UpdatedAtUtc = g.UpdatedAtUtc,
            };
        }

        public class UpsertDto
        {
            public string Name { get; set; } = "";
            public Guid[] JobIds { get; set; } = Array.Empty<Guid>();
        }

        // GET api/solvegroups - every group of the caller's, oldest first so
        // the list is stable as groups are added.
        [HttpGet]
        public async Task<ActionResult<GroupDto[]>> List()
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var groups = await _db.SolveGroups
                .Include(g => g.Members)
                .Where(g => g.UserId == uid)
                .OrderBy(g => g.CreatedAtUtc)
                .ToListAsync();
            return Ok(groups.Select(GroupDto.From).ToArray());
        }

        // POST api/solvegroups   body: { name, jobIds }
        [HttpPost]
        public async Task<ActionResult<GroupDto>> Create([FromBody] UpsertDto req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var problem = await ValidateAsync(uid, req);
            if (problem != null) return BadRequest(problem);

            var id = Guid.NewGuid();
            var group = new SolveGroup
            {
                Id = id,
                UserId = uid,
                Name = req.Name.Trim(),
                CreatedAtUtc = DateTimeOffset.UtcNow,
                Members = MembersFor(req.JobIds, id),
            };
            _db.SolveGroups.Add(group);
            await _db.SaveChangesAsync();
            return Ok(GroupDto.From(group));
        }

        // PUT api/solvegroups/{id}   body: { name, jobIds } - replaces both.
        [HttpPut("{id:guid}")]
        public async Task<ActionResult<GroupDto>> Update(Guid id, [FromBody] UpsertDto req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var group = await _db.SolveGroups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id && g.UserId == uid);
            if (group == null) return NotFound();
            var problem = await ValidateAsync(uid, req);
            if (problem != null) return BadRequest(problem);

            group.Name = req.Name.Trim();
            group.UpdatedAtUtc = DateTimeOffset.UtcNow;
            // Replace, never diff: the order is part of the group, and a
            // rotation is short enough that rewriting it is the simple thing.
            _db.SolveGroupMembers.RemoveRange(group.Members);
            group.Members.Clear();
            // Added through the set, not through the navigation: an entity
            // with a pre-set key that EF only discovers through a navigation
            // is tracked as Modified, and the save then looks for rows that
            // were never written. Fix-up puts them into group.Members, in
            // order, because their GroupId names a tracked principal.
            _db.SolveGroupMembers.AddRange(MembersFor(req.JobIds, group.Id));
            await _db.SaveChangesAsync();
            return Ok(GroupDto.From(group));
        }

        // DELETE api/solvegroups/{id} - the group only; its solves stay.
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var group = await _db.SolveGroups
                .Include(g => g.Members)
                .FirstOrDefaultAsync(g => g.Id == id && g.UserId == uid);
            if (group == null) return NotFound();
            _db.SolveGroupMembers.RemoveRange(group.Members);
            _db.SolveGroups.Remove(group);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        private static List<SolveGroupMember> MembersFor(Guid[] jobIds, Guid groupId) =>
            jobIds.Select((jobId, i) => new SolveGroupMember
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                JobId = jobId,
                Position = i,
            }).ToList();

        /// <summary>The first thing wrong with the request, or null. Every
        /// member must be a push/fold job of the caller's: a group is only
        /// ever played by the simulator, and a foreign or postflop job in it
        /// would surface there as a confusing "cannot play this".</summary>
        private async Task<string?> ValidateAsync(string uid, UpsertDto req)
        {
            var name = req.Name?.Trim() ?? "";
            if (name.Length == 0) return "name is required.";
            if (name.Length > MaxNameLength) return $"name must be at most {MaxNameLength} characters.";
            if (req.JobIds == null) return "jobIds is required (an empty list is fine).";
            if (req.JobIds.Length > MaxMembers) return $"a group holds at most {MaxMembers} solves.";
            var distinct = req.JobIds.Distinct().ToArray();
            if (distinct.Length == 0) return null;
            var owned = await _db.EngineCompareJobs
                .Where(j => j.UserId == uid
                            && j.Mode == EngineCompareJobMode.PushFold
                            && distinct.Contains(j.Id))
                .Select(j => j.Id)
                .ToListAsync();
            var unknown = distinct.Except(owned).ToArray();
            return unknown.Length == 0
                ? null
                : $"{unknown.Length} of the solves do not exist or are not push/fold solves of yours.";
        }
    }
}
