// Controllers/EngineCompareController.cs
using System;
using System.Linq;
using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Azure.Storage.Blobs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// User-facing endpoints for htsolver jobs. A job is executed by the
    /// compare watcher (watcher/engine_compare_watcher.py) on the machine
    /// that has both solvers; the frontend /compare page submits and polls
    /// here, which works against the deployed API from anywhere.
    /// </summary>
    [ApiController]
    [Route("api/enginecompare")]
    [Authorize]
    public class EngineCompareController : ControllerBase
    {
        private const int MaxConfigBytes = 32 * 1024;

        private readonly AppDbContext _db;
        private readonly IConfiguration _config;

        public EngineCompareController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        public class CreateDto
        {
            public JsonObject Config { get; set; } = new();
            public double PioAccuracyPct { get; set; } = 0.02;
            public string Mode { get; set; } = EngineCompareJobMode.Compare;
            // Default to the fast engine-only loop; see EngineCompareJob.
            public bool DisablePio { get; set; } = true;
            public bool DisableCompare { get; set; } = true;
            public bool DisableCrossCheck { get; set; } = true;
        }

        public class JobDto
        {
            public Guid Id { get; set; }
            public string Mode { get; set; } = "";
            public string? Board { get; set; }
            public string Status { get; set; } = "";
            public string? Error { get; set; }
            public string? ResultStacks { get; set; }
            public string? ResultNodeName { get; set; }
            public DateTimeOffset CreatedAtUtc { get; set; }
            public DateTimeOffset? ClaimedAtUtc { get; set; }
            public DateTimeOffset? CompletedAtUtc { get; set; }
            /// <summary>Set once the owner has asked this job to stop. Still
            /// active until the watcher acts on it, which is what the page
            /// shows as "Stopping".</summary>
            public DateTimeOffset? CancelRequestedAtUtc { get; set; }

            public bool DisablePio { get; set; }
            public bool DisableCompare { get; set; }
            public bool DisableCrossCheck { get; set; }

            /// <summary>Which payloads this job has, so the page knows what to fetch.</summary>
            public bool HasHtResult { get; set; }
            public bool HasPioResult { get; set; }
            /// <summary>A pre-split job: one merged payload the current page cannot read.</summary>
            public bool LegacyResult { get; set; }

            // Per-stage wall times from the watcher (flat dict of seconds);
            // null for jobs that predate the instrumentation.
            public JsonNode? Timings { get; set; }

            /// <summary>The solve lineage of this job's result and the
            /// iterations it reached - what lets the page open a lineage's
            /// result directly (a team's baseline, say) instead of queueing a
            /// solve to re-export it. Null until reported or filled in.</summary>
            public string? SolveId { get; set; }
            public string? SolveKey { get; set; }
            public long? Iterations { get; set; }

            /// <summary>The spot a push/fold job solved, read out of its
            /// stored config: seats, stacks, blinds, button, team. What a list
            /// of "4-way · Done" rows needs to tell them apart. Null for other
            /// modes and for a config the summary cannot read.</summary>
            public PushFoldSpotSummary? Spot { get; set; }

            public static JobDto From(EngineCompareJob job) => new()
            {
                Id = job.Id,
                Mode = job.Mode,
                Board = job.Board,
                Spot = job.Mode == EngineCompareJobMode.PushFold
                    ? PushFoldSpotSummary.Parse(job.ConfigJson)
                    : null,
                Status = job.Status,
                Error = job.Error,
                ResultStacks = job.ResultStacks,
                ResultNodeName = job.ResultNodeName,
                CreatedAtUtc = job.CreatedAtUtc,
                ClaimedAtUtc = job.ClaimedAtUtc,
                CompletedAtUtc = job.CompletedAtUtc,
                CancelRequestedAtUtc = job.CancelRequestedAtUtc,
                Timings = ParseTimings(job.TimingsJson),
                SolveId = job.SolveId,
                SolveKey = job.SolveKey,
                Iterations = job.Iterations,
                DisablePio = job.DisablePio,
                DisableCompare = job.DisableCompare,
                DisableCrossCheck = job.DisableCrossCheck,
                HasHtResult = !string.IsNullOrEmpty(job.HtResultBlobPath),
                HasPioResult = !string.IsNullOrEmpty(job.PioResultBlobPath),
                LegacyResult = !string.IsNullOrEmpty(job.ResultBlobPath)
                               && string.IsNullOrEmpty(job.HtResultBlobPath)
                               && string.IsNullOrEmpty(job.PioResultBlobPath),
            };

            private static JsonNode? ParseTimings(string? json)
            {
                if (string.IsNullOrEmpty(json)) return null;
                try { return JsonNode.Parse(json); }
                catch (System.Text.Json.JsonException) { return null; } // a garbled row must not 500 the poll
            }
        }

        // POST api/enginecompare - queue a job. Publish mode (writes into the
        // shared solutions library) is admin-only while htsolver earns trust.
        [HttpPost]
        public async Task<ActionResult<JobDto>> Create([FromBody] CreateDto request)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();

            if (request.Mode != EngineCompareJobMode.Compare &&
                request.Mode != EngineCompareJobMode.Publish &&
                request.Mode != EngineCompareJobMode.PushFold)
            {
                return BadRequest("mode must be \"compare\", \"publish\" or \"pushfold\"");
            }
            if (request.Mode == EngineCompareJobMode.Publish && !IsAdmin())
                return Forbid();
            var pushFold = request.Mode == EngineCompareJobMode.PushFold;
            if (pushFold)
            {
                // Nothing to compare against: PioSOLVER is heads-up postflop and
                // cannot build this tree at all. Normalize rather than validate,
                // so a stale client flag cannot queue a Pio run that would fail.
                request.DisablePio = true;
            }
            if (request.PioAccuracyPct <= 0 || request.PioAccuracyPct > 10)
                return BadRequest("pioAccuracyPct must be in (0, 10]");
            // "No Pio" subsumes the other two: neither the per-hand extraction
            // nor the gate can run without a Pio process. Normalize here so the
            // stored row is coherent and the watcher never re-derives it.
            if (request.DisablePio)
            {
                request.DisableCompare = true;
                request.DisableCrossCheck = true;
            }

            var configJson = request.Config.ToJsonString();
            if (configJson.Length > MaxConfigBytes)
                return BadRequest($"config too large (max {MaxConfigBytes} bytes)");
            // A preflop solve has no board, and must not be given one: the
            // runout is averaged inside the all-in showdown rather than dealt
            // into the tree, so config.board is refused by the engine itself.
            string? board = null;
            if (pushFold)
            {
                if (request.Config["board"] != null)
                    return BadRequest("pushfold mode takes no config.board");
                var seats = request.Config["players"]?.AsArray().Count ?? 0;
                if (seats < 2 || seats > 9)
                    return BadRequest("pushfold mode needs 2 to 9 players");
                // Board is only ever a list-display label; reuse it to say what
                // the spot was, since a preflop job has nothing else short.
                board = $"{seats}-way";
            }
            else
            {
                var boardText = request.Config["board"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(boardText))
                    return BadRequest("config.board is required");
                board = string.Concat(Regex.Matches(boardText, "[2-9TJQKA][hdcs]",
                    RegexOptions.IgnoreCase).Select(m => m.Value));
                if (board.Length != 6 && board.Length != 8 && board.Length != 10)
                    return BadRequest("config.board must have 3, 4, or 5 cards");
                if (request.Mode == EngineCompareJobMode.Publish && board.Length != 10)
                    return BadRequest("publish mode is river-only for now (see engine/docs/roadmap.md)");
            }

            var job = new EngineCompareJob
            {
                Id = Guid.NewGuid(),
                UserId = uid, // from the token, never the body
                Mode = request.Mode,
                ConfigJson = configJson,
                Board = board,
                PioAccuracyPct = request.PioAccuracyPct,
                DisablePio = request.DisablePio,
                DisableCompare = request.DisableCompare,
                DisableCrossCheck = request.DisableCrossCheck,
                Status = EngineCompareJobStatus.Queued,
                CreatedAtUtc = DateTimeOffset.UtcNow,
            };
            _db.EngineCompareJobs.Add(job);
            await _db.SaveChangesAsync();
            return Ok(JobDto.From(job));
        }

        // GET api/enginecompare?mode=pushfold - the caller's recent jobs,
        // newest first. The mode filter is applied BEFORE the limit, so a
        // page that wants its own hundred rows gets a hundred of its own
        // rather than a hundred shared with the other engine page.
        [HttpGet]
        public async Task<ActionResult<JobDto[]>> List([FromQuery] int limit = 30,
                                                       [FromQuery] string? mode = null)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            limit = Math.Clamp(limit, 1, 100);
            var query = _db.EngineCompareJobs.Where(j => j.UserId == uid);
            if (!string.IsNullOrWhiteSpace(mode)) query = query.Where(j => j.Mode == mode);
            var jobs = await query
                .OrderByDescending(j => j.CreatedAtUtc)
                .Take(limit)
                .ToListAsync();
            return Ok(jobs.Select(JobDto.From).ToArray());
        }

        // GET api/enginecompare/{id} - poll one job. Non-owner gets 404.
        [HttpGet("{id:guid}")]
        public async Task<ActionResult<JobDto>> Get(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();
            return Ok(JobDto.From(job));
        }

        // GET api/enginecompare/{id}/result - the comparison payload. Stored
        // gzipped in ADLS by the watcher; served as-is with Content-Encoding
        // (same shape as the street-bundle endpoint).
        //
        // Current jobs upload a binary .htc payload (watcher/htc_format.py);
        // jobs from before that still hold JSON, so the content type comes
        // from the stored path and both keep working.
        [HttpGet("{id:guid}/result")]
        public async Task<IActionResult> Result(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();
            if (job.Status != EngineCompareJobStatus.Done || string.IsNullOrEmpty(job.ResultBlobPath))
                return NotFound("Job has no result (not done, failed, or publish-mode).");

            var connectionString = _config["AzureStorage:ConnectionString"];
            var containerName = _config["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                return Problem("AzureStorage:ConnectionString is missing from configuration.");
            var blob = new BlobServiceClient(connectionString)
                .GetBlobContainerClient(containerName)
                .GetBlobClient(job.ResultBlobPath);
            if (!await blob.ExistsAsync())
                return NotFound($"Result blob missing: {job.ResultBlobPath}");
            var bytes = await blob.DownloadContentAsync();
            Response.Headers.ContentEncoding = "gzip";
            Response.Headers.CacheControl = "private, max-age=86400"; // results are immutable
            var contentType = job.ResultBlobPath.EndsWith(".json.gz", StringComparison.OrdinalIgnoreCase)
                ? "application/json"
                : "application/octet-stream";
            return File(bytes.Value.Content.ToArray(), contentType);
        }

        // GET api/enginecompare/{id}/result/{solver} - one solver's payload
        // ("ht" or "pio"). Deliberately does NOT require Status == Done: the
        // htsolver half is uploaded before Pio finishes, and a Pio failure
        // must not cost the engine result.
        [HttpGet("{id:guid}/result/{solver}")]
        public async Task<IActionResult> ResultFor(Guid id, string solver)
        {
            if (solver != "ht" && solver != "pio")
                return BadRequest("solver must be \"ht\" or \"pio\"");
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();

            var path = solver == "ht" ? job.HtResultBlobPath : job.PioResultBlobPath;
            if (string.IsNullOrEmpty(path))
                return NotFound($"Job has no {solver} payload.");

            var connectionString = _config["AzureStorage:ConnectionString"];
            var containerName = _config["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                return Problem("AzureStorage:ConnectionString is missing from configuration.");
            var blob = new BlobServiceClient(connectionString)
                .GetBlobContainerClient(containerName)
                .GetBlobClient(path);
            if (!await blob.ExistsAsync())
                return NotFound($"Result blob missing: {path}");
            var bytes = await blob.DownloadContentAsync();
            Response.Headers.ContentEncoding = "gzip";
            Response.Headers.CacheControl = "private, max-age=86400"; // results are immutable
            return File(bytes.Value.Content.ToArray(), "application/octet-stream");
        }

        // POST api/enginecompare/{id}/cancel - stop one of the caller's own
        // jobs, keeping whatever it has solved so far.
        //
        // Two different things, depending on how far the job got:
        //  - Queued: nothing has run and nothing can be saved, so the job goes
        //    straight to Cancelled and a watcher will never claim it.
        //  - Active: the row keeps its status and only records the REQUEST.
        //    The watcher sees it on its next heartbeat response, asks the
        //    engine to stop cooperatively, and the engine writes its
        //    checkpoint and exports the artifact for the iterations it had -
        //    so the job still finishes through Uploading and lands on
        //    Cancelled WITH a result. Flipping the status here instead would
        //    throw all of that away, which is the opposite of what stopping a
        //    long solve is for.
        //
        // Idempotent: asking twice keeps the first request's timestamp, so a
        // double-click cannot look like a second, later cancel.
        [HttpPost("{id:guid}/cancel")]
        public async Task<ActionResult<JobDto>> Cancel(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();
            if (EngineCompareJobStatus.Terminal.Contains(job.Status))
                return Conflict($"This job already finished ({job.Status}).");

            job.CancelRequestedAtUtc ??= DateTimeOffset.UtcNow;
            if (job.Status == EngineCompareJobStatus.Queued)
            {
                job.Status = EngineCompareJobStatus.Cancelled;
                job.CompletedAtUtc = DateTimeOffset.UtcNow;
            }
            await _db.SaveChangesAsync();
            return Ok(JobDto.From(job));
        }

        public class IdentityDto
        {
            public string? SolveId { get; set; }
            public string? SolveKey { get; set; }
            public long? Iterations { get; set; }
        }

        // POST api/enginecompare/{id}/identity - fill in the solve lineage of
        // a job that predates the watcher reporting it. The page reads the
        // artifact's own metadata when it opens a result, so it is the one
        // party that knows; the server only records what it did not have.
        // Fields already set are never changed here - the watcher's report
        // is the authority, this is a backfill - and nothing is superseded
        // or deleted on this path.
        [HttpPost("{id:guid}/identity")]
        public async Task<ActionResult<JobDto>> Identity(Guid id, [FromBody] IdentityDto req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();

            var solveId = req.SolveId?.Trim();
            if (solveId != null && !System.Text.RegularExpressions.Regex.IsMatch(solveId, "^[A-Za-z0-9._-]{1,64}$"))
                return BadRequest("solveId may only use letters, digits, '-', '_' and '.', up to 64 characters.");
            var solveKey = req.SolveKey?.Trim();
            if (solveKey != null && !System.Text.RegularExpressions.Regex.IsMatch(solveKey, "^[0-9a-f]{64}$"))
                return BadRequest("solveKey must be a 64-hex SHA-256.");
            if (req.Iterations is < 0) return BadRequest("iterations cannot be negative.");

            var changed = false;
            if (job.SolveId == null && solveId != null) { job.SolveId = solveId; changed = true; }
            if (job.SolveKey == null && solveKey != null) { job.SolveKey = solveKey; changed = true; }
            if (job.Iterations == null && req.Iterations != null) { job.Iterations = req.Iterations; changed = true; }
            if (changed) await _db.SaveChangesAsync();
            return Ok(JobDto.From(job));
        }

        // DELETE api/enginecompare/{id} - drop one of the caller's own jobs and
        // its result blobs. Ownership is checked the same way every other
        // endpoint here checks it: the row is looked up by (id, uid) from the
        // token, so a non-owner gets 404 rather than a 403 that would confirm
        // the job exists.
        //
        // An ACTIVE job is refused. The watcher may be mid-solve and will PATCH
        // its status when it finishes; deleting the row underneath it turns a
        // normal report into a confusing 404 in the watcher log, and the claim
        // would never be released. Terminal jobs only.
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            var job = await _db.EngineCompareJobs
                .FirstOrDefaultAsync(j => j.Id == id && j.UserId == uid);
            if (job == null) return NotFound();
            if (!EngineCompareJobStatus.Terminal.Contains(job.Status))
                return Conflict("This job is still running. Stop it (or wait for it to finish), "
                                + "then delete it.");

            // Blobs first: a row removed while its blobs survive is a leak with
            // nothing left pointing at it, whereas a blob delete that fails
            // leaves the row intact and the delete retryable.
            await EngineCompareJobBlobs.DeleteAsync(EngineCompareJobBlobs.Container(_config), job);

            _db.EngineCompareJobs.Remove(job);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        private bool IsAdmin()
        {
            // The default JWT inbound claim map renames "email" to
            // ClaimTypes.Email, so check both shapes.
            var email = User.FindFirst("email")?.Value
                ?? User.FindFirst(ClaimTypes.Email)?.Value;
            var uid = this.CurrentUid();
            var adminEmails = _config.GetSection("Admin:Emails").Get<string[]>() ?? Array.Empty<string>();
            var adminUids = _config.GetSection("Admin:Uids").Get<string[]>() ?? Array.Empty<string>();
            return (email != null && adminEmails.Contains(email, StringComparer.OrdinalIgnoreCase))
                || (uid != null && adminUids.Contains(uid, StringComparer.Ordinal));
        }
    }
}
