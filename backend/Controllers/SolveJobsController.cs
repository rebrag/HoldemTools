// Controllers/SolveJobsController.cs
using Microsoft.AspNetCore.Authorization;
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
    /// User-facing solve-job status. The watcher-facing claim/report endpoints
    /// live in SolveJobsWatcherController under the same route prefix.
    /// </summary>
    [ApiController]
    [Route("api/solvejobs")]
    [Authorize]
    public class SolveJobsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IConfiguration _config;

        public SolveJobsController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
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

            // Both counts are per solver: each solver has its own watcher, so
            // a job only ever waits behind jobs of its own solver.
            int? queuePosition = null;
            if (job.Status == SolveJobStatus.Queued)
            {
                var ahead = await _db.SolveJobs.CountAsync(j =>
                    j.Solver == job.Solver &&
                    j.Status == SolveJobStatus.Queued &&
                    (j.Priority > job.Priority ||
                     (j.Priority == job.Priority && j.CreatedAtUtc < job.CreatedAtUtc)));
                queuePosition = ahead + 1;
            }

            var active = SolveJobStatus.Active.ToArray();
            var activeAhead = await _db.SolveJobs.CountAsync(j =>
                j.Solver == job.Solver && active.Contains(j.Status));

            var dto = ToDto(job, queuePosition, activeAhead);
            // Only worth a query while someone is waiting on the answer.
            if (!SolveJobStatus.Terminal.Contains(job.Status))
                dto.TypicalSeconds = await SolveJobTimings.TypicalSecondsAsync(_db, job.Solver, job.HasSeatMeta);

            Response.Headers.CacheControl = "no-cache";
            return Ok(dto);
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

        // --------------------------------------------------------------------
        // POST api/solvejobs/reroute   (admin)   body: { from, to }
        // Moves every still-Queued job of one solver to the other. A queued
        // row does not follow a Solve:Solver:* flip on its own, so this is how
        // a backlog follows the switch (or is pulled back on rollback). A job
        // moves to htsolver only when its upload carried a valid engine tree
        // and it is not ICM - the same eligibility the upload route applies -
        // and the rest are reported as skipped. Claimed and later jobs are
        // never touched: their watcher already owns them.
        // --------------------------------------------------------------------
        [HttpPost("reroute")]
        public async Task<IActionResult> Reroute([FromBody] RerouteRequest req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();
            if (!this.IsAdmin(_config))
                return Forbid();

            var from = SolveJobSolver.Normalize(req.From);
            var to = SolveJobSolver.Normalize(req.To);
            if (from == null || to == null)
                return BadRequest("from and to must each be \"pio\" or \"htsolver\".");
            if (from == to)
                return BadRequest("from and to must differ.");

            var toHt = to == SolveJobSolver.HtSolver;
            var candidates = _db.SolveJobs
                .Where(j => j.Solver == from && j.Status == SolveJobStatus.Queued);
            var eligible = candidates.Where(j => !toHt || (j.HasEngineTree && !j.IsIcm));

            int moved;
            if (_db.Database.IsRelational())
            {
                // One UPDATE whose WHERE re-checks Status = Queued, so a job a
                // watcher claims mid-request is never moved under it.
                moved = await eligible.ExecuteUpdateAsync(s => s.SetProperty(j => j.Solver, to));
            }
            else
            {
                // EF InMemory (tests) has no ExecuteUpdate; same filter.
                var rows = await eligible.ToListAsync();
                foreach (var job in rows) job.Solver = to;
                await _db.SaveChangesAsync();
                moved = rows.Count;
            }
            var skipped = await candidates.CountAsync();

            return Ok(new RerouteResponse { From = from, To = to, Moved = moved, Skipped = skipped });
        }

        public class RerouteRequest
        {
            public string? From { get; set; }
            public string? To { get; set; }
        }

        public class RerouteResponse
        {
            public string From { get; set; } = "";
            public string To { get; set; } = "";
            public int Moved { get; set; }
            public int Skipped { get; set; }
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
            Solver = job.Solver,
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
            public string Solver { get; set; } = SolveJobSolver.Pio;
            public int? QueuePosition { get; set; }
            public int? ActiveAhead { get; set; }
            // Median claim-to-Done seconds of recent solves of this solver and
            // kind (SolveJobTimings); null when there is no history yet, and
            // on a job that is already finished.
            public int? TypicalSeconds { get; set; }
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
