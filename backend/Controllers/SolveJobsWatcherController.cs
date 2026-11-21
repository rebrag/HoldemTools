// Controllers/SolveJobsWatcherController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// Watcher-facing queue endpoints: claim the next job, report progress.
    /// Authenticated by the X-Watcher-Key shared secret, not Firebase.
    ///
    /// One queue, routed by solver: each solver's watcher claims from its own
    /// route and only ever sees jobs routed to it. /claim is hard-wired to Pio
    /// so the deployed Pio watcher, which sends only {watcherId}, keeps working
    /// unchanged and can never pop an htsolver job.
    /// </summary>
    [ApiController]
    [Route("api/solvejobs")]
    [WatcherKey]
    public class SolveJobsWatcherController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IEngineSolutionsIndex _engineIndex;
        private readonly int _claimTimeoutSeconds;
        private readonly int _maxAttempts;

        public SolveJobsWatcherController(AppDbContext db, IConfiguration config, IEngineSolutionsIndex engineIndex)
        {
            _db = db;
            _engineIndex = engineIndex;
            _claimTimeoutSeconds = int.TryParse(config["Watcher:ClaimTimeoutSeconds"], out var t) ? t : 300;
            _maxAttempts = int.TryParse(config["Watcher:MaxAttempts"], out var a) ? a : 2;
        }

        // --------------------------------------------------------------------
        // POST api/solvejobs/claim   body: { watcherId }
        // Atomically pops the next Queued PIO job. 204 when there is none.
        // --------------------------------------------------------------------
        [HttpPost("claim")]
        public Task<IActionResult> Claim([FromBody] SolveJobClaimRequest req) =>
            ClaimFor(SolveJobSolver.Pio, req);

        // --------------------------------------------------------------------
        // POST api/solvejobs/claim/htsolver   body: { watcherId }
        // Atomically pops the next Queued HTSOLVER job. 204 when there is none.
        // A new worker pointed at an API without this route gets a 404, never
        // a Pio job.
        // --------------------------------------------------------------------
        [HttpPost("claim/htsolver")]
        public Task<IActionResult> ClaimHtSolver([FromBody] SolveJobClaimRequest req) =>
            ClaimFor(SolveJobSolver.HtSolver, req);

        private async Task<IActionResult> ClaimFor(string solver, SolveJobClaimRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");
            var watcherId = req.WatcherId.Trim();
            if (watcherId.Length > 64)
                watcherId = watcherId[..64];

            await RequeueStaleClaimsAsync();

            var job = await ClaimNextAsync(watcherId, solver);
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
                solver = job.Solver,
            });
        }

        // --------------------------------------------------------------------
        // PATCH api/solvejobs/{id}
        // body: { watcherId, status?, error?, heartbeat?, resultStacks?,
        //         resultNodeName?, board?, indexEntry?, progress? }
        // Status transitions are linear (Claimed -> Solving -> Extracting ->
        // Uploading -> Done); Failed is reachable from any active state.
        // heartbeat:true with no status is a pure keepalive.
        //
        // A repeated Done from the watcher that owns the job is a 200 with no
        // state change, so a worker that lost the first response can retry
        // its terminal report safely. Every other report on a terminal job,
        // and any report from a watcher that does not own the job, is a 409.
        //
        // indexEntry (htsolver jobs only) is the board's library index entry;
        // it is upserted into enginesolutions-index.json with its
        // coordinates forced to the job's own. It is written BEFORE the
        // report's state change is saved, so a failed index write (503)
        // leaves the job where it was and the report retryable.
        // --------------------------------------------------------------------
        [HttpPatch("{id:guid}")]
        public async Task<IActionResult> Report(Guid id, [FromBody] SolveJobReportRequest req, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");

            var job = await _db.SolveJobs.FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job == null)
                return NotFound();

            var repeatedDone = job.Status == SolveJobStatus.Done
                && req.Status == SolveJobStatus.Done
                && job.WatcherId != null
                && job.WatcherId == req.WatcherId;

            // A requeued-and-reclaimed job must reject the crashed claimer's
            // late reports: its WatcherId was cleared (or reassigned) by the
            // stale sweep, so the old claimer no longer matches.
            if (!repeatedDone &&
                (SolveJobStatus.Terminal.Contains(job.Status) || job.WatcherId != req.WatcherId))
                return Conflict(new { status = job.Status, watcherId = job.WatcherId });

            if (!repeatedDone && req.Status != null && !IsValidTransition(job.Status, req.Status))
                return Conflict(new { status = job.Status, rejected = req.Status });

            var indexResult = await UpsertIndexEntryAsync(job, req, ct);
            if (indexResult != null)
                return indexResult;

            if (repeatedDone)
                return Ok(new { ok = true, status = job.Status });

            var now = DateTimeOffset.UtcNow;
            job.LastHeartbeatUtc = now;

            if (req.Status != null)
            {
                job.Status = req.Status;
                if (req.Status == SolveJobStatus.Failed)
                    job.Error = Truncate(req.Error, 2000) ?? "unspecified watcher error";
                if (SolveJobStatus.Terminal.Contains(req.Status))
                    job.CompletedAtUtc = now;
            }

            // Coordinates set at insert are authoritative for htsolver jobs: the
            // index entry is forced to them, so letting a report move them
            // would let a later report index another board. Pio keeps today's
            // behaviour (its Done report restates the same values).
            var coordinatesLocked = job.Solver == SolveJobSolver.HtSolver
                && job.ResultStacks != null && job.ResultNodeName != null && job.Board != null;
            if (!coordinatesLocked)
            {
                if (req.ResultStacks != null) job.ResultStacks = Truncate(req.ResultStacks, 200);
                if (req.ResultNodeName != null) job.ResultNodeName = Truncate(req.ResultNodeName, 200);
                if (req.Board != null) job.Board = Truncate(req.Board, 12);
            }

            ApplyProgress(job, req.Progress);

            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true, status = job.Status });
        }

        /// <summary>
        /// Record a report's solve progress on the job. A report without one
        /// leaves the last measurement in place (most reports are stage
        /// changes and plain keepalives). A measurement that is not a real
        /// number is dropped whole rather than stored as a zero, which would
        /// read as a perfectly solved tree.
        /// </summary>
        private static void ApplyProgress(SolveJob job, SolveJobProgressReport? progress)
        {
            if (progress?.Iteration is not { } iteration || progress.ExploitablePct is not { } pct)
                return;
            if (iteration < 0 || !double.IsFinite(pct) || pct < 0)
                return;

            job.ProgressIteration = iteration;
            job.ProgressExploitablePct = pct;
            job.ProgressTargetPct = progress.TargetPct is { } target && double.IsFinite(target) && target > 0
                ? target
                : null;
        }

        /// <summary>
        /// Upsert the report's index entry for an htsolver job. Null when there
        /// was nothing to do or it succeeded; otherwise the error response.
        /// Ignored for Pio jobs: the Pio watcher writes its own index.
        /// </summary>
        private async Task<IActionResult?> UpsertIndexEntryAsync(
            SolveJob job, SolveJobReportRequest req, CancellationToken ct)
        {
            if (req.IndexEntry is not { } raw || raw.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
                return null;
            if (job.Solver != SolveJobSolver.HtSolver)
                return null;
            if (raw.ValueKind != JsonValueKind.Object)
                return BadRequest("indexEntry must be an object.");
            if (string.IsNullOrEmpty(job.ResultStacks) || string.IsNullOrEmpty(job.ResultNodeName)
                || string.IsNullOrEmpty(job.Board))
                return BadRequest("This job has no library coordinates to index.");

            var entry = EngineSolutionsIndex.SanitizeEntry(
                raw, job.ResultStacks, job.ResultNodeName, job.Board, job.Solver);
            try
            {
                await _engineIndex.UpsertAsync(entry, ct);
                return null;
            }
            catch (EngineIndexConflictException ex)
            {
                return StatusCode(503, ex.Message);
            }
        }

        // --------------------------------------------------------------------
        // Helpers
        // --------------------------------------------------------------------

        /// <summary>
        /// Jobs whose claimer stopped heartbeating go back to Queued, or to
        /// Failed once they have used up their attempts. Runs inline on every
        /// claim (the watchers poll constantly), so no hosted service needed.
        /// Covers every solver: a requeued job keeps its Solver, so it goes
        /// back to the queue it came from. Idempotent; a race between two
        /// sweeps is benign.
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
                // The next attempt starts from iteration zero.
                job.ProgressIteration = null;
                job.ProgressExploitablePct = null;
                job.ProgressTargetPct = null;
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
        /// Atomic queue-pop of one solver's next job. On SQL Server this is a
        /// single UPDATE with UPDLOCK/READPAST so concurrent claimers can never
        /// take the same row; the solver is a SQL parameter, never spliced into
        /// the text. The EF InMemory provider (unit tests) cannot run raw SQL,
        /// so it falls back to a non-atomic read-modify-write with the same
        /// filter, which is fine single-threaded.
        /// </summary>
        private async Task<SolveJob?> ClaimNextAsync(string watcherId, string solver)
        {
            if (_db.Database.IsRelational())
            {
                var claimed = await _db.SolveJobs.FromSqlRaw(@"
WITH next AS (
    SELECT TOP (1) *
    FROM SolveJobs WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE Status = 'Queued' AND Solver = {1}
    ORDER BY Priority DESC, CreatedAtUtc ASC
)
UPDATE next
SET Status = 'Claimed',
    ClaimedAtUtc = SYSUTCDATETIME(),
    LastHeartbeatUtc = SYSUTCDATETIME(),
    AttemptCount = AttemptCount + 1,
    WatcherId = {0}
OUTPUT inserted.*;", watcherId, solver)
                    .AsNoTracking()
                    .ToListAsync();
                return claimed.FirstOrDefault();
            }

            var job = await _db.SolveJobs
                .Where(j => j.Status == SolveJobStatus.Queued && j.Solver == solver)
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

        /// <summary>
        /// The board's library index entry (htsolver jobs only), upserted into
        /// enginesolutions-index.json. Whitelisted field by field; its
        /// coordinates are replaced by the job's own.
        /// </summary>
        public JsonElement? IndexEntry { get; set; }

        /// <summary>
        /// How far a running solve has got. Optional on every report; the
        /// htsolver worker sends it on keepalives while the job is Solving.
        /// </summary>
        public SolveJobProgressReport? Progress { get; set; }
    }

    public class SolveJobProgressReport
    {
        public int? Iteration { get; set; }

        /// <summary>How exploitable the strategy is now, as a percent of the pot.</summary>
        public double? ExploitablePct { get; set; }

        /// <summary>The accuracy the solve stops at, in the same unit.</summary>
        public double? TargetPct { get; set; }
    }
}
