using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GameTreesController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly AppDbContext _db;
        private readonly IGameTreeBlobStore _blobs;

        public GameTreesController(IConfiguration configuration, AppDbContext db, IGameTreeBlobStore blobs)
        {
            _config = configuration;
            _db = db;
            _blobs = blobs;
        }

        // --------------------------------------------------------------------
        // POST api/gametrees
        // Body: { folder, line[], actingPos, isICM, text, uid?, alivePositions[],
        //         seats?, bigBlind?, chipScale?, handHistoryId?,
        //         engineTree?, solver? }
        // Writes JSON payload to /gametrees/yyyy/MM/dd/uid_or_anon/... and
        // queues a SolveJob routed to one solver (see ChooseSolver).
        // --------------------------------------------------------------------
        [HttpPost]
        [Authorize]
        public async Task<IActionResult> UploadGameTree([FromBody] GameTreeUploadRequest req)
        {
            // Each upload costs minutes of local solver time - signed-in users
            // only, and identity comes from the verified token, never the body.
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            if (string.IsNullOrWhiteSpace(req.Text))
                return BadRequest("Missing game tree text.");

            var now = DateTimeOffset.UtcNow;
            var safeFolder = Sanitize(req.Folder);
            var safePos = Sanitize(req.ActingPos);
            var safeLine = string.Join("-", (req.Line ?? Array.Empty<string>()).Select(Sanitize));
            var board = ParseBoard(req.Text);
            var chipScale = SanitizeChipScale(req.ChipScale);

            // Optional per-seat metadata (hand-history uploads): free-text
            // names are length-capped and sanitized before storage, and hole
            // cards are filtered to valid card codes.
            var seats = req.Seats?.Select(s => new
            {
                Pos = Sanitize(s.Pos),
                Name = TruncateName(s.Name),
                s.StackChips,
                s.Folded,
                s.Hero,
                Cards = SanitizeCards(s.Cards)
            }).ToArray();
            var hasSeatMeta = seats is { Length: > 0 };

            // The engine tree is rebuilt from a whitelist, never stored as sent.
            // It is validated whatever the route, so a valid tree is kept for a
            // later re-route; an invalid one only matters if this upload would
            // go to htsolver (old clients and bad trees never break Pio).
            JsonObject? engineTree = null;
            string? engineTreeError = null;
            if (req.EngineTree is { } rawTree && rawTree.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
            {
                engineTree = EngineTreeValidator.Validate(
                    rawTree, board, chipScale ?? DefaultChipScale, out engineTreeError);
            }

            var routing = ChooseSolver(
                _config, hasSeatMeta, req.IsICM,
                engineTreePresent: engineTree != null || engineTreeError != null,
                engineTreeValid: engineTree != null,
                requestedSolver: req.Solver,
                isAdmin: this.IsAdmin(_config));
            if (routing.RejectInvalidTree)
                return BadRequest($"Invalid engineTree: {engineTreeError}");
            var solver = routing.Solver;

            string dirPath = $"gametrees/{now:yyyy/MM/dd}/{Sanitize(uid)}/folder={safeFolder}";
            string fileName = $"{now:HHmmss}_line={safeLine}_pos={safePos}_icm={(req.IsICM ? 1 : 0)}.json";

            var payload = new
            {
                req.Folder,
                req.Line,
                req.ActingPos,
                req.IsICM,
                req.Text,
                req.AlivePositions,
                Seats = seats,
                req.BigBlind,
                ChipScale = chipScale,
                UploadedAtUtc = now,
                // Which solver this upload was routed to, so a watcher in
                // legacy blob-listing mode can skip anything not its own. The
                // job row's Solver (and the claim response) is authoritative
                // once queued: an admin re-route moves the row, not this field.
                Solver = solver,
                EngineTree = engineTree,
            };

            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
            await _blobs.UploadAsync(dirPath, fileName, bytes);

            // Provenance for the library: only recorded by this user's own
            // hand can be linked, so the id is verified against the caller
            // rather than trusted from the body. Anything else is dropped.
            int? handHistoryId = null;
            if (req.HandHistoryId is int hhId && hhId > 0)
            {
                bool owned = await _db.HandHistories
                    .AnyAsync(h => h.Id == hhId && h.UserId == uid);
                if (owned) handHistoryId = hhId;
            }

            var path = $"{dirPath}/{fileName}";
            var (job, deduped) = await CreateOrDedupeJobAsync(
                _db, uid, path, safeFolder, safeLine, safePos, req.IsICM,
                board, hasSeatMeta: hasSeatMeta,
                handHistoryId: handHistoryId,
                solver: solver,
                hasEngineTree: engineTree != null);

            return Ok(new { ok = true, path, jobId = job.Id, deduped, solver = job.Solver });
        }

        /// <summary>Chips per bb when an upload carries no chip scale (Pio's bb * 100 convention).</summary>
        public const double DefaultChipScale = 100;

        public readonly record struct SolverRouting(string Solver, bool RejectInvalidTree);

        /// <summary>
        /// Which solver an upload goes to. Config Solve:Solver:HandHistory
        /// (uploads with seat meta) or Solve:Solver:Sim (the rest), both
        /// defaulting to pio, picks the route; an admin may override it per
        /// request (a non-admin's solver field is ignored). htsolver is only
        /// ever chosen for a non-ICM upload with an engine tree, so ICM and old
        /// clients always land on Pio. An engine tree that is present but
        /// invalid is a 400 only when the upload would otherwise have gone to
        /// htsolver; on the Pio route it is dropped. Pure, for the tests.
        /// </summary>
        public static SolverRouting ChooseSolver(
            IConfiguration config,
            bool hasSeatMeta,
            bool isIcm,
            bool engineTreePresent,
            bool engineTreeValid,
            string? requestedSolver,
            bool isAdmin)
        {
            var configured = SolveJobSolver.Normalize(
                config[hasSeatMeta ? "Solve:Solver:HandHistory" : "Solve:Solver:Sim"]) ?? SolveJobSolver.Pio;
            var wanted = (isAdmin ? SolveJobSolver.Normalize(requestedSolver) : null) ?? configured;

            if (wanted != SolveJobSolver.HtSolver || isIcm || !engineTreePresent)
                return new SolverRouting(SolveJobSolver.Pio, RejectInvalidTree: false);
            if (!engineTreeValid)
                return new SolverRouting(SolveJobSolver.Pio, RejectInvalidTree: true);
            return new SolverRouting(SolveJobSolver.HtSolver, RejectInvalidTree: false);
        }

        /// <summary>
        /// Insert a Queued SolveJob for this upload, unless an identical
        /// sim-path job for the SAME solver is already queued or being
        /// solved, in which case the caller is handed that job. A duplicate
        /// would cost minutes of a single solver machine to produce a
        /// byte-identical manifest at the same path. Hand-history uploads
        /// (seat meta) are personalized and never dedupe.
        ///
        /// The library coordinates are set here rather than at Done: they are
        /// deterministic from the blob path (GameTreeCoordinates mirrors the
        /// watchers), and having them from the start lets the library overlay
        /// owner-filter a hand-history board the moment any part of it is
        /// published. Static and DB-only so tests can drive it without ADLS.
        /// </summary>
        public static async Task<(SolveJob job, bool deduped)> CreateOrDedupeJobAsync(
            AppDbContext db,
            string uid,
            string blobPath,
            string folder,
            string lineKey,
            string actingPos,
            bool isIcm,
            string? board,
            bool hasSeatMeta,
            int? handHistoryId = null,
            string solver = SolveJobSolver.Pio,
            bool hasEngineTree = false)
        {
            if (!hasSeatMeta && board != null)
            {
                var openStatuses = SolveJobStatus.Active
                    .Concat(new[] { SolveJobStatus.Queued })
                    .ToArray();
                var existing = await db.SolveJobs.FirstOrDefaultAsync(j =>
                    !j.HasSeatMeta &&
                    j.Solver == solver &&
                    j.Board == board &&
                    j.Folder == folder &&
                    j.LineKey == lineKey &&
                    j.ActingPos == actingPos &&
                    j.IsIcm == isIcm &&
                    openStatuses.Contains(j.Status));
                if (existing != null)
                    return (existing, true);
            }

            var (stacks, nodeName) = GameTreeCoordinates.FromBlobPath(blobPath);
            var job = new SolveJob
            {
                Id = Guid.NewGuid(),
                UserId = uid,
                Type = SolveJobType.GameTree,
                BlobPath = blobPath,
                Folder = folder,
                LineKey = lineKey,
                ActingPos = actingPos,
                IsIcm = isIcm,
                Board = board,
                HasSeatMeta = hasSeatMeta,
                HandHistoryId = handHistoryId,
                Solver = solver,
                HasEngineTree = hasEngineTree,
                ResultStacks = Truncate(stacks, 200),
                ResultNodeName = Truncate(nodeName, 200),
                Status = SolveJobStatus.Queued,
                CreatedAtUtc = DateTimeOffset.UtcNow,
            };
            db.SolveJobs.Add(job);
            await db.SaveChangesAsync();
            return (job, false);
        }

        /// <summary>
        /// '#Board#4h Jh 5s' -> '4hJh5s'. Same pattern the watcher uses
        /// (get_board_name in watch_adls_and_run_pio_headless.py), so the job
        /// row and the eventual manifest agree on the board key.
        /// </summary>
        public static string? ParseBoard(string text)
        {
            var m = System.Text.RegularExpressions.Regex.Match(
                text,
                @"#Board#([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])");
            return m.Success
                ? string.Concat(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value)
                : null;
        }

        // --------------------------------------------------------------------
        // Helpers
        // --------------------------------------------------------------------
        private static string Sanitize(string? s)
        {
            if (string.IsNullOrEmpty(s)) return "na";
            var bad = Path.GetInvalidFileNameChars().Concat(new[] { '/', '\\', '?', '#', '%' }).ToHashSet();
            var sb = new StringBuilder(s.Length);
            foreach (var ch in s)
                sb.Append(bad.Contains(ch) ? '_' : ch);
            return sb.ToString();
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

        // Seat names are display-only free text; cap the length but keep the
        // characters (they never become a path segment).
        private static string TruncateName(string? s)
        {
            var name = (s ?? "").Trim();
            return name.Length <= 32 ? name : name[..32];
        }

        // Pio chips per unit of the hand's money. Only the powers of ten the
        // client can pick are accepted; anything else is dropped, which the
        // watcher and the viewer both read as the default bb convention. Scales
        // below 1 exist because Pio caps setup chips at 65535, so a big-stack
        // hand has to be divided down rather than multiplied up.
        private static readonly double[] AllowedChipScales =
            { 0.01, 0.1, 1, 10, 100, 1000, 10000 };

        private static double? SanitizeChipScale(double? scale) =>
            scale.HasValue && AllowedChipScales.Any(s => Math.Abs(s - scale.Value) < 1e-9)
                ? scale
                : null;

        // Hole cards from the recorded hand: keep only valid "As"-style codes
        // (PLO5 hands can carry up to five).
        private static string[]? SanitizeCards(System.Collections.Generic.List<string>? cards)
        {
            if (cards == null) return null;
            var valid = cards
                .Where(c => c != null && System.Text.RegularExpressions.Regex.IsMatch(c, "^[2-9TJQKA][shdc]$"))
                .Take(5)
                .ToArray();
            return valid.Length > 0 ? valid : null;
        }
    }

    // ========= DTO =========
    public class GameTreeUploadRequest
    {
        public string Folder { get; set; } = "";
        public string[] Line { get; set; } = Array.Empty<string>();
        public string ActingPos { get; set; } = "";
        public bool IsICM { get; set; }
        public string Text { get; set; } = "";

        // List of alive positions from the frontend (e.g. ["UTG1","BB"])
        public string[] AlivePositions { get; set; } = Array.Empty<string>();

        // Optional per-seat metadata from hand-history uploads. StackChips is
        // measured at the flop, in Pio chips (bb * 100). Echoed into the
        // solution manifest so the viewer can show real names/stacks/cards.
        public System.Collections.Generic.List<SeatMetaDto>? Seats { get; set; }

        // The hand's big blind in real chips (viewer's chips display).
        public double? BigBlind { get; set; }

        // Pio chips per unit of the hand's money, so the viewer can convert
        // the solved numbers back. Absent means the original bb convention.
        // May be below 1 for hands played for more chips than Pio can hold.
        public double? ChipScale { get; set; }

        // The recorded hand this solve came from. Verified against the caller
        // before it is stored, so the library can offer a replay link.
        public int? HandHistoryId { get; set; }

        // The same spot as Text, as the engine's tree block (contract section
        // 1). Validated and rebuilt by EngineTreeValidator; what lets the
        // upload be solved by htsolver.
        public JsonElement? EngineTree { get; set; }

        // "pio" | "htsolver": a per-request route override, honoured for
        // admins only (so one hand can be solved by both for comparison).
        public string? Solver { get; set; }
    }

    public class SeatMetaDto
    {
        public string Pos { get; set; } = "";
        public string Name { get; set; } = "";
        public int StackChips { get; set; }
        public bool Folded { get; set; }
        public bool Hero { get; set; }
        public System.Collections.Generic.List<string>? Cards { get; set; }
    }
}
