// Controllers/SolveJobsWatcherController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// Watcher-facing queue endpoints: claim the next job, report progress.
    /// Authenticated by the X-Watcher-Key shared secret, not Firebase.
    /// </summary>
    [ApiController]
    [Route("api/solvejobs")]
    [WatcherKey]
    public class SolveJobsWatcherController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly int _claimTimeoutSeconds;
        private readonly int _maxAttempts;

        public SolveJobsWatcherController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _claimTimeoutSeconds = int.TryParse(config["Watcher:ClaimTimeoutSeconds"], out var t) ? t : 300;
            _maxAttempts = int.TryParse(config["Watcher:MaxAttempts"], out var a) ? a : 2;
        }

        // --------------------------------------------------------------------
        // POST api/solvejobs/claim   body: { watcherId }
        // Atomically pops the next Queued job. 204 when the queue is empty.
        // --------------------------------------------------------------------
        [HttpPost("claim")]
        public async Task<IActionResult> Claim([FromBody] SolveJobClaimRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");
            var watcherId = req.WatcherId.Trim();
            if (watcherId.Length > 64)
                watcherId = watcherId[..64];

            await RequeueStaleClaimsAsync();

            var job = await ClaimNextAsync(watcherId);
            if (job == null)
                return NoContent();

            return Ok(new
            {
                id = job.Id,
                type = job.Type,
                blobPath = job.BlobPath,
                folder = job.Folder,
                lineKey = job.LineKey,
                actingPos = job.ActingPos,
                isIcm = job.IsIcm,
                board = job.Board,
                attemptCount = job.AttemptCount,
                priority = job.Priority,
                createdAtUtc = job.CreatedAtUtc,
            });
        }

        // --------------------------------------------------------------------
        // PATCH api/solvejobs/{id}
        // body: { watcherId, status?, error?, heartbeat?, resultStacks?,
        //         resultNodeName?, board? }
        // Status transitions are linear (Claimed -> Solving -> Extracting ->
        // Uploading -> Done); Failed is reachable from any active state.
        // heartbeat:true with no status is a pure keepalive.
        // --------------------------------------------------------------------
        [HttpPatch("{id:guid}")]
        public async Task<IActionResult> Report(Guid id, [FromBody] SolveJobReportRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");

            var job = await _db.SolveJobs.FirstOrDefaultAsync(j => j.Id == id);
            if (job == null)
                return NotFound();

            // A requeued-and-reclaimed job must reject the crashed claimer's
            // late reports: its WatcherId was cleared (or reassigned) by the
            // stale sweep, so the old claimer no longer matches.
            if (SolveJobStatus.Terminal.Contains(job.Status) || job.WatcherId != req.WatcherId)
                return Conflict(new { status = job.Status, watcherId = job.WatcherId });

            var now = DateTimeOffset.UtcNow;
            job.LastHeartbeatUtc = now;

            if (req.Status != null)
            {
                if (!IsValidTransition(job.Status, req.Status))
                    return Conflict(new { status = job.Status, rejected = req.Status });

                job.Status = req.Status;
                if (req.Status == SolveJobStatus.Failed)
                    job.Error = Truncate(req.Error, 2000) ?? "unspecified watcher error";
                if (SolveJobStatus.Terminal.Contains(req.Status))
                    job.CompletedAtUtc = now;
            }

            if (req.ResultStacks != null) job.ResultStacks = Truncate(req.ResultStacks, 200);
            if (req.ResultNodeName != null) job.ResultNodeName = Truncate(req.ResultNodeName, 200);
            if (req.Board != null) job.Board = Truncate(req.Board, 12);

            await _db.SaveChangesAsync();
            return Ok(new { ok = true, status = job.Status });
        }

        // --------------------------------------------------------------------
        // Helpers
        // --------------------------------------------------------------------

        /// <summary>
        /// Jobs whose claimer stopped heartbeating go back to Queued, or to
        /// Failed once they have used up their attempts. Runs inline on every
        /// claim (the watcher polls constantly), so no hosted service needed.
        /// Idempotent; a race between two sweeps is benign.
        /// </summary>
        private async Task RequeueStaleClaimsAsync()
        {
            var cutoff = DateTimeOffset.UtcNow.AddSeconds(-_claimTimeoutSeconds);
            var active = SolveJobStatus.Active.ToArray();
            var stale = await _db.SolveJobs
                .Where(j => active.Contains(j.Status) &&
                            (j.LastHeartbeatUtc == null || j.LastHeartbeatUtc < cutoff))
                .ToListAsync();

            if (stale.Count == 0)
                return;

            var now = DateTimeOffset.UtcNow;
            foreach (var job in stale)
            {
                job.WatcherId = null;
                if (job.AttemptCount >= _maxAttempts)
                {
                    job.Status = SolveJobStatus.Failed;
                    job.Error = "watcher timed out";
                    job.CompletedAtUtc = now;
                }
                else
                {
                    job.Status = SolveJobStatus.Queued;
                }
            }
            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Atomic queue-pop. On SQL Server this is a single UPDATE with
        /// UPDLOCK/READPAST so concurrent claimers can never take the same row.
        /// The EF InMemory provider (unit tests) cannot run raw SQL, so it
        /// falls back to a non-atomic read-modify-write, which is fine
        /// single-threaded.
        /// </summary>
        private async Task<SolveJob?> ClaimNextAsync(string watcherId)
        {
            if (_db.Database.IsRelational())
            {
                var claimed = await _db.SolveJobs.FromSqlRaw(@"
WITH next AS (
    SELECT TOP (1) *
    FROM SolveJobs WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE Status = 'Queued'
    ORDER BY Priority DESC, CreatedAtUtc ASC
)
UPDATE next
SET Status = 'Claimed',
    ClaimedAtUtc = SYSUTCDATETIME(),
    LastHeartbeatUtc = SYSUTCDATETIME(),
    AttemptCount = AttemptCount + 1,
    WatcherId = {0}
OUTPUT inserted.*;", watcherId)
                    .AsNoTracking()
                    .ToListAsync();
                return claimed.FirstOrDefault();
            }

            var job = await _db.SolveJobs
                .Where(j => j.Status == SolveJobStatus.Queued)
                .OrderByDescending(j => j.Priority)
                .ThenBy(j => j.CreatedAtUtc)
                .FirstOrDefaultAsync();
            if (job == null)
                return null;

            var now = DateTimeOffset.UtcNow;
            job.Status = SolveJobStatus.Claimed;
            job.ClaimedAtUtc = now;
            job.LastHeartbeatUtc = now;
            job.AttemptCount += 1;
            job.WatcherId = watcherId;
            await _db.SaveChangesAsync();
            return job;
        }

        private static bool IsValidTransition(string current, string next)
        {
            if (next == SolveJobStatus.Failed)
                return SolveJobStatus.Active.Contains(current);

            var chain = SolveJobStatus.Chain;
            var from = chain.ToList().IndexOf(current);
            var to = chain.ToList().IndexOf(next);
            // Strictly the next stage, and only from a claimed (active) state:
            // a Queued job must be claimed through /claim, never via PATCH.
            return from >= 1 && to == from + 1;
        }

        private static string? Truncate(string? s, int max) =>
            s == null ? null : (s.Length <= max ? s : s[..max]);
    }

    // ========= DTOs =========
    public class SolveJobClaimRequest
    {
        public string WatcherId { get; set; } = "";
    }

    public class SolveJobReportRequest
    {
        public string WatcherId { get; set; } = "";
        public string? Status { get; set; }
        public string? Error { get; set; }
        public bool Heartbeat { get; set; }
        public string? ResultStacks { get; set; }
        public string? ResultNodeName { get; set; }
        public string? Board { get; set; }
    }
}
