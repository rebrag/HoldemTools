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

            public static JobDto From(EngineCompareJob job) => new()
            {
                Id = job.Id,
                Mode = job.Mode,
                Board = job.Board,
                Status = job.Status,
                Error = job.Error,
                ResultStacks = job.ResultStacks,
                ResultNodeName = job.ResultNodeName,
                CreatedAtUtc = job.CreatedAtUtc,
                ClaimedAtUtc = job.ClaimedAtUtc,
                CompletedAtUtc = job.CompletedAtUtc,
                Timings = ParseTimings(job.TimingsJson),
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
                request.Mode != EngineCompareJobMode.Publish)
            {
                return BadRequest("mode must be \"compare\" or \"publish\"");
            }
            if (request.Mode == EngineCompareJobMode.Publish && !IsAdmin())
                return Forbid();
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
            var boardText = request.Config["board"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(boardText))
                return BadRequest("config.board is required");
            var board = string.Concat(Regex.Matches(boardText, "[2-9TJQKA][hdcs]",
                RegexOptions.IgnoreCase).Select(m => m.Value));
            if (board.Length != 6 && board.Length != 8 && board.Length != 10)
                return BadRequest("config.board must have 3, 4, or 5 cards");
            if (request.Mode == EngineCompareJobMode.Publish && board.Length != 10)
                return BadRequest("publish mode is river-only for now (see engine/docs/roadmap.md)");

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

        // GET api/enginecompare - the caller's recent jobs, newest first.
        [HttpGet]
        public async Task<ActionResult<JobDto[]>> List([FromQuery] int limit = 30)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid)) return Unauthorized();
            limit = Math.Clamp(limit, 1, 100);
            var jobs = await _db.EngineCompareJobs
                .Where(j => j.UserId == uid)
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
