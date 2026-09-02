// Controllers/EngineCompareWatcherController.cs
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage.Blobs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using PokerRangeAPI2.Services.EngineArtifacts;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// Compare-watcher-facing queue endpoints (claim / report / publish),
    /// authenticated by the X-Watcher-Key shared secret. Mirrors
    /// SolveJobsWatcherController's claim + stale-sweep semantics.
    /// </summary>
    [ApiController]
    [Route("api/enginecompare")]
    [WatcherKey]
    public class EngineCompareWatcherController : ControllerBase
    {
        // Serializes upserts of the shared engine solutions index blob.
        private static readonly SemaphoreSlim IndexGate = new(1, 1);
        private const string EngineIndexBlob = "enginesolutions-index.json";

        private readonly AppDbContext _db;
        private readonly IConfiguration _config;
        private readonly int _claimTimeoutSeconds;
        private readonly int _maxAttempts;

        public EngineCompareWatcherController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
            _claimTimeoutSeconds = int.TryParse(config["Watcher:ClaimTimeoutSeconds"], out var t) ? t : 300;
            _maxAttempts = int.TryParse(config["Watcher:MaxAttempts"], out var a) ? a : 2;
        }

        public class ClaimRequestDto
        {
            public string WatcherId { get; set; } = "";
        }

        public class ReportRequestDto
        {
            public string WatcherId { get; set; } = "";
            public string? Status { get; set; }
            public string? Error { get; set; }
            public bool Heartbeat { get; set; }
            public string? ResultBlobPath { get; set; }
            // One blob per solver; the Pio one stays null when Pio did not run.
            public string? HtResultBlobPath { get; set; }
            public string? PioResultBlobPath { get; set; }
            // Per-stage wall times (flat dict of seconds), sent with the
            // terminal report. Stored verbatim; the frontend renders it.
            public JsonObject? Timings { get; set; }
            // The result's lineage, read by the watcher from the artifact's
            // metadata (solve_id, solve_key, iterations) and sent with the
            // terminal report. What supersede-on-report keys on.
            public string? SolveId { get; set; }
            public string? SolveKey { get; set; }
            public long? Iterations { get; set; }
        }

        // POST api/enginecompare/claim   body: { watcherId }
        [HttpPost("claim")]
        public async Task<IActionResult> Claim([FromBody] ClaimRequestDto req)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");
            var watcherId = req.WatcherId.Trim();
            if (watcherId.Length > 64) watcherId = watcherId[..64];

            await RequeueStaleClaimsAsync();

            var job = await ClaimNextAsync(watcherId);
            if (job == null) return NoContent();

            return Ok(new
            {
                id = job.Id,
                mode = job.Mode,
                config = job.ConfigJson,
                pioAccuracyPct = job.PioAccuracyPct,
                disablePio = job.DisablePio,
                disableCompare = job.DisableCompare,
                disableCrossCheck = job.DisableCrossCheck,
                board = job.Board,
                attemptCount = job.AttemptCount,
                createdAtUtc = job.CreatedAtUtc,
            });
        }

        // PATCH api/enginecompare/{id}
        // body: { watcherId, status?, error?, heartbeat?, resultBlobPath? }
        [HttpPatch("{id:guid}")]
        public async Task<IActionResult> Report(Guid id, [FromBody] ReportRequestDto req)
        {
            if (string.IsNullOrWhiteSpace(req.WatcherId))
                return BadRequest("Missing watcherId.");

            var job = await _db.EngineCompareJobs.FirstOrDefaultAsync(j => j.Id == id);
            if (job == null) return NotFound();

            if (EngineCompareJobStatus.Terminal.Contains(job.Status) || job.WatcherId != req.WatcherId)
                return Conflict(new { status = job.Status, watcherId = job.WatcherId });

            var now = DateTimeOffset.UtcNow;
            job.LastHeartbeatUtc = now;

            if (req.Status != null)
            {
                if (!IsValidTransition(job.Status, req.Status))
                    return Conflict(new { status = job.Status, rejected = req.Status });
                job.Status = req.Status;
                if (req.Status == EngineCompareJobStatus.Failed)
                    job.Error = Truncate(req.Error, 2000) ?? "unspecified watcher error";
                // A cancel is not an error, but the watcher may still have
                // something worth saying (how far it got, or that the solve
                // produced nothing to upload). Only when it sends one.
                if (req.Status == EngineCompareJobStatus.Cancelled && req.Error != null)
                    job.Error = Truncate(req.Error, 2000);
                if (EngineCompareJobStatus.Terminal.Contains(req.Status))
                    job.CompletedAtUtc = now;
            }
            if (req.ResultBlobPath != null)
                job.ResultBlobPath = Truncate(req.ResultBlobPath, 512);
            if (req.HtResultBlobPath != null)
                job.HtResultBlobPath = Truncate(req.HtResultBlobPath, 512);
            if (req.PioResultBlobPath != null)
                job.PioResultBlobPath = Truncate(req.PioResultBlobPath, 512);
            if (req.Timings != null)
            {
                // Never truncate: a cut-off JSON string is unparseable, so an
                // oversized dict (should not happen) is dropped whole.
                var timingsJson = req.Timings.ToJsonString();
                if (timingsJson.Length <= 4000) job.TimingsJson = timingsJson;
            }
            if (req.SolveId != null) job.SolveId = Truncate(req.SolveId, 64);
            if (req.SolveKey != null) job.SolveKey = Truncate(req.SolveKey, 64);
            if (req.Iterations != null) job.Iterations = req.Iterations;

            await _db.SaveChangesAsync();

            // A lineage keeps ONE result. Once this job's result is on disk
            // (Done, or Cancelled with an upload - a stopped solve still wrote
            // what it had), every earlier result of the same lineage with no
            // more iterations than this one is the same solve at a less
            // converged point, and goes. The newest wins ties (a re-export of
            // a finished solve replaces the older copy). A job with a
            // different solve key is a different spot that reused the id and
            // is left alone; a job with NO key predates the stamp and is
            // treated as the same lineage - ids are unique per spot now, and
            // those rows are exactly the stale copies this exists to clear.
            if (job.SolveId != null && job.Iterations != null
                && EngineCompareJobStatus.Terminal.Contains(job.Status)
                && job.Status != EngineCompareJobStatus.Failed
                && !string.IsNullOrEmpty(job.HtResultBlobPath))
            {
                var superseded = await _db.EngineCompareJobs
                    .Where(j => j.Id != job.Id
                                && j.UserId == job.UserId
                                && j.SolveId == job.SolveId
                                && (j.SolveKey == null || job.SolveKey == null || j.SolveKey == job.SolveKey)
                                && j.Iterations != null && j.Iterations <= job.Iterations
                                && (j.Status == EngineCompareJobStatus.Done
                                    || j.Status == EngineCompareJobStatus.Cancelled))
                    .ToListAsync();
                if (superseded.Count > 0)
                {
                    var container = EngineCompareJobBlobs.Container(_config);
                    foreach (var old in superseded)
                    {
                        await EngineCompareJobBlobs.DeleteAsync(container, old);
                        _db.EngineCompareJobs.Remove(old);
                    }
                    await _db.SaveChangesAsync();
                }
            }
            // Every report - heartbeats included - answers with whether the
            // owner has asked this job to stop. That is what carries a cancel
            // to the watcher: no extra endpoint to poll, and the signal
            // repeats until the watcher acts on it, so one dropped response
            // costs a heartbeat interval rather than the cancel itself.
            return Ok(new
            {
                ok = true,
                status = job.Status,
                cancelRequested = job.CancelRequestedAtUtc != null,
            });
        }

        // POST api/enginecompare/{id}/publish-artifact  (multipart file ".hta")
        // Publish-mode jobs: the watcher uploads the solved artifact and the
        // API converts it to schema-4 (EngineSolutionExporter), uploads the
        // manifest + street bundle to the solutions container, and upserts the
        // engine solutions index (merged into piosolutionsIndex at read time -
        // the Pio watcher stays the only writer of piosolutions-index.json).
        [HttpPost("{id:guid}/publish-artifact")]
        [RequestSizeLimit(64 * 1024 * 1024)]
        public async Task<IActionResult> PublishArtifact(Guid id, IFormFile artifact,
                                                         [FromForm] string watcherId,
                                                         CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(watcherId)) return BadRequest("Missing watcherId.");
            var job = await _db.EngineCompareJobs.FirstOrDefaultAsync(j => j.Id == id, ct);
            if (job == null) return NotFound();
            if (job.Mode != EngineCompareJobMode.Publish)
                return Conflict("Not a publish-mode job.");
            if (EngineCompareJobStatus.Terminal.Contains(job.Status) || job.WatcherId != watcherId)
                return Conflict(new { status = job.Status, watcherId = job.WatcherId });
            if (artifact == null || artifact.Length == 0)
                return BadRequest("Missing artifact file.");

            var connectionString = _config["AzureStorage:ConnectionString"];
            var containerName = _config["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                return Problem("AzureStorage:ConnectionString is missing from configuration.");
            var container = new BlobServiceClient(connectionString)
                .GetBlobContainerClient(containerName);

            var runDir = Path.Combine(Path.GetTempPath(), "engine_publish_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(runDir);
            try
            {
                var htaPath = Path.Combine(runDir, "solve.hta");
                await using (var file = System.IO.File.Create(htaPath))
                {
                    await artifact.CopyToAsync(file, ct);
                }

                var result = await new EngineSolutionExporter().ExportAsync(htaPath, runDir, ct);

                // Upload everything the exporter produced under piosolutions/.
                var exportRoot = Path.Combine(runDir, "piosolutions");
                foreach (var path in Directory.EnumerateFiles(exportRoot, "*", SearchOption.AllDirectories))
                {
                    var relative = Path.GetRelativePath(runDir, path).Replace('\\', '/');
                    await using var stream = System.IO.File.OpenRead(path);
                    await container.GetBlobClient(relative).UploadAsync(stream, overwrite: true, ct);
                }

                // Upsert this solve's entry into the engine solutions index.
                var localIndex = JsonNode.Parse(
                    await System.IO.File.ReadAllTextAsync(Path.Combine(runDir, "piosolutions-index.json"), ct))!;
                await UpsertEngineIndexAsync(container, localIndex.AsObject(), ct);

                job.ResultStacks = Truncate(result.Stacks, 200);
                job.ResultNodeName = Truncate(result.NodeName, 200);
                job.Board = Truncate(result.Board, 12);
                job.LastHeartbeatUtc = DateTimeOffset.UtcNow;
                await _db.SaveChangesAsync(ct);

                return Ok(new { stacks = result.Stacks, nodeName = result.NodeName, board = result.Board });
            }
            finally
            {
                try { Directory.Delete(runDir, true); } catch { /* best effort */ }
            }
        }

        private static async Task UpsertEngineIndexAsync(BlobContainerClient container,
                                                         JsonObject localIndex, CancellationToken ct)
        {
            await IndexGate.WaitAsync(ct);
            try
            {
                var blob = container.GetBlobClient(EngineIndexBlob);
                JsonObject merged;
                if (await blob.ExistsAsync(ct))
                {
                    var existing = (await blob.DownloadContentAsync(ct)).Value.Content.ToString();
                    merged = JsonNode.Parse(
                        EngineLocalSolutions.MergeIndexJson(existing, localIndex.ToJsonString()))!.AsObject();
                }
                else
                {
                    merged = localIndex;
                }
                merged["updated_utc"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'");
                await blob.UploadAsync(BinaryData.FromString(merged.ToJsonString()), overwrite: true, ct);
            }
            finally
            {
                IndexGate.Release();
            }
        }

        private async Task RequeueStaleClaimsAsync()
        {
            var cutoff = DateTimeOffset.UtcNow.AddSeconds(-_claimTimeoutSeconds);
            var active = EngineCompareJobStatus.Active.ToArray();
            var stale = await _db.EngineCompareJobs
                .Where(j => active.Contains(j.Status) &&
                            (j.LastHeartbeatUtc == null || j.LastHeartbeatUtc < cutoff))
                .ToListAsync();
            if (stale.Count == 0) return;

            var now = DateTimeOffset.UtcNow;
            foreach (var job in stale)
            {
                job.WatcherId = null;
                if (job.CancelRequestedAtUtc != null)
                {
                    // The owner asked it to stop and the watcher went away
                    // without reporting. Re-queuing it would restart a solve
                    // nobody wants; honour the cancel instead.
                    job.Status = EngineCompareJobStatus.Cancelled;
                    job.CompletedAtUtc = now;
                }
                else if (job.AttemptCount >= _maxAttempts)
                {
                    job.Status = EngineCompareJobStatus.Failed;
                    job.Error = "watcher timed out";
                    job.CompletedAtUtc = now;
                }
                else
                {
                    job.Status = EngineCompareJobStatus.Queued;
                }
            }
            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Queue-pop; atomic UPDLOCK/READPAST on SQL Server, read-modify-write
        /// fallback for the InMemory test provider (fine single-threaded).
        /// </summary>
        private async Task<EngineCompareJob?> ClaimNextAsync(string watcherId)
        {
            if (_db.Database.IsRelational())
            {
                var claimed = await _db.EngineCompareJobs.FromSqlRaw(@"
WITH next AS (
    SELECT TOP (1) *
    FROM EngineCompareJobs WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE Status = 'Queued'
    ORDER BY CreatedAtUtc ASC
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

            var job = await _db.EngineCompareJobs
                .Where(j => j.Status == EngineCompareJobStatus.Queued)
                .OrderBy(j => j.CreatedAtUtc)
                .FirstOrDefaultAsync();
            if (job == null) return null;

            var now = DateTimeOffset.UtcNow;
            job.Status = EngineCompareJobStatus.Claimed;
            job.ClaimedAtUtc = now;
            job.LastHeartbeatUtc = now;
            job.AttemptCount += 1;
            job.WatcherId = watcherId;
            await _db.SaveChangesAsync();
            return job;
        }

        private static bool IsValidTransition(string current, string next)
        {
            // Both terminal-from-anywhere: a claim can die at any stage, and
            // a cancel can land at any stage.
            if (next == EngineCompareJobStatus.Failed || next == EngineCompareJobStatus.Cancelled)
                return EngineCompareJobStatus.Active.Contains(current);
            var chain = EngineCompareJobStatus.Chain.ToList();
            var from = chain.IndexOf(current);
            var to = chain.IndexOf(next);
            return from >= 1 && to == from + 1;
        }

        private static string? Truncate(string? s, int max) =>
            s == null ? null : (s.Length <= max ? s : s[..max]);
    }
}
