// Controllers/SolveJobsController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// User-facing solve-job status. The watcher-facing claim/report endpoints
    /// live in SolveJobsWatcherController under the same route prefix.
    /// </summary>
    [ApiController]
    [Route("api/solvejobs")]
    [Authorize]
    public class SolveJobsController : ControllerBase
    {
        private readonly AppDbContext _db;

        public SolveJobsController(AppDbContext db)
        {
            _db = db;
        }

        // --------------------------------------------------------------------
        // GET api/solvejobs/{id}
        // Polled by the frontend (~2s) while a solve is pending.
        //
        // Visibility: sim-path jobs (no seat meta) are readable by any signed-in
        // user, because identical submissions dedupe across users and the solved
        // result lands in the shared library anyway. Hand-history jobs carry
        // personal seat metadata, so those are owner-only and answer 404 (not
        // 403) to everyone else to avoid leaking their existence.
        // --------------------------------------------------------------------
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetJob(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            var job = await _db.SolveJobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == id);
            if (job == null || (job.HasSeatMeta && job.UserId != uid))
                return NotFound();

            int? queuePosition = null;
            if (job.Status == SolveJobStatus.Queued)
            {
                var ahead = await _db.SolveJobs.CountAsync(j =>
                    j.Status == SolveJobStatus.Queued &&
                    (j.Priority > job.Priority ||
                     (j.Priority == job.Priority && j.CreatedAtUtc < job.CreatedAtUtc)));
                queuePosition = ahead + 1;
            }

            var active = SolveJobStatus.Active.ToArray();
            var activeAhead = await _db.SolveJobs.CountAsync(j => active.Contains(j.Status));

            Response.Headers.CacheControl = "no-cache";
            return Ok(ToDto(job, queuePosition, activeAhead));
        }

        // --------------------------------------------------------------------
        // GET api/solvejobs  – the current user's recent jobs, newest first.
        // --------------------------------------------------------------------
        [HttpGet]
        public async Task<IActionResult> GetMyJobs()
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            var jobs = await _db.SolveJobs.AsNoTracking()
                .Where(j => j.UserId == uid)
                .OrderByDescending(j => j.CreatedAtUtc)
                .Take(20)
                .ToListAsync();

            Response.Headers.CacheControl = "no-cache";
            return Ok(jobs.Select(j => ToDto(j, queuePosition: null, activeAhead: null)));
        }

        public static SolveJobStatusResponse ToDto(SolveJob job, int? queuePosition, int? activeAhead) => new()
        {
            Id = job.Id,
            Status = job.Status,
            Board = job.Board,
            Folder = job.Folder,
            LineKey = job.LineKey,
            ActingPos = job.ActingPos,
            IsIcm = job.IsIcm,
            QueuePosition = queuePosition,
            ActiveAhead = activeAhead,
            Error = job.Error,
            AttemptCount = job.AttemptCount,
            HandHistoryId = job.HandHistoryId,
            ResultStacks = job.ResultStacks,
            ResultNodeName = job.ResultNodeName,
            CreatedAtUtc = job.CreatedAtUtc,
            ClaimedAtUtc = job.ClaimedAtUtc,
            CompletedAtUtc = job.CompletedAtUtc,
            LastHeartbeatUtc = job.LastHeartbeatUtc,
        };

        // Serialized camelCase by the default JSON options, matching the
        // frontend's SolveJobDto.
        public class SolveJobStatusResponse
        {
            public Guid Id { get; set; }
            public string Status { get; set; } = "";
            public string? Board { get; set; }
            public string Folder { get; set; } = "";
            public string LineKey { get; set; } = "";
            public string ActingPos { get; set; } = "";
            public bool IsIcm { get; set; }
            public int? QueuePosition { get; set; }
            public int? ActiveAhead { get; set; }
            public string? Error { get; set; }
            public int AttemptCount { get; set; }
            public int? HandHistoryId { get; set; }
            public string? ResultStacks { get; set; }
            public string? ResultNodeName { get; set; }
            public DateTimeOffset CreatedAtUtc { get; set; }
            public DateTimeOffset? ClaimedAtUtc { get; set; }
            public DateTimeOffset? CompletedAtUtc { get; set; }
            public DateTimeOffset? LastHeartbeatUtc { get; set; }
        }
    }
}
