using Azure.Storage.Blobs;
using Azure.Storage.Files.DataLake;
using Azure.Storage.Files.DataLake.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.IO;
using System.Linq;            // 👈 needed for .Select(...)
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GameTreesController : ControllerBase
    {
        private readonly DataLakeServiceClient _dataLakeServiceClient;
        private readonly string _containerName;
        private readonly AppDbContext _db;

        public GameTreesController(IConfiguration configuration, AppDbContext db)
        {
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
            _db = db;
        }

        // --------------------------------------------------------------------
        // POST api/gametrees
        // Body: { folder, line[], actingPos, isICM, text, uid?, alivePositions[] }
        // Writes JSON payload to /gametrees/yyyy/MM/dd/uid_or_anon/...
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

            var fs = _dataLakeServiceClient.GetFileSystemClient(_containerName);
            await fs.CreateIfNotExistsAsync();

            var now = DateTimeOffset.UtcNow;
            var safeFolder = Sanitize(req.Folder);
            var safePos = Sanitize(req.ActingPos);
            var safeLine = string.Join("-", (req.Line ?? Array.Empty<string>()).Select(Sanitize));

            string dirPath = $"gametrees/{now:yyyy/MM/dd}/{Sanitize(uid)}/folder={safeFolder}";
            DataLakeDirectoryClient dir = fs.GetDirectoryClient(dirPath);
            await dir.CreateIfNotExistsAsync();

            string fileName = $"{now:HHmmss}_line={safeLine}_pos={safePos}_icm={(req.IsICM ? 1 : 0)}.json";
            DataLakeFileClient file = dir.GetFileClient(fileName);

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
                ChipScale = SanitizeChipScale(req.ChipScale),
                UploadedAtUtc = now
            };

            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
            using var ms = new MemoryStream(bytes);

            await file.UploadAsync(ms, overwrite: true);

            var path = $"{dirPath}/{fileName}";
            var (job, deduped) = await CreateOrDedupeJobAsync(
                _db, uid, path, safeFolder, safeLine, safePos, req.IsICM,
                ParseBoard(req.Text), hasSeatMeta: seats is { Length: > 0 });

            return Ok(new { ok = true, path, jobId = job.Id, deduped });
        }

        /// <summary>
        /// Insert a Queued SolveJob for this upload, unless an identical
        /// sim-path job is already queued or being solved, in which case the
        /// caller is handed that job. A duplicate would cost ~10 minutes of the
        /// single Pio machine to produce a byte-identical manifest at the same
        /// path. Hand-history uploads (seat meta) are personalized and never
        /// dedupe. Static and DB-only so tests can drive it without ADLS.
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
            bool hasSeatMeta)
        {
            if (!hasSeatMeta && board != null)
            {
                var openStatuses = SolveJobStatus.Active
                    .Concat(new[] { SolveJobStatus.Queued })
                    .ToArray();
                var existing = await db.SolveJobs.FirstOrDefaultAsync(j =>
                    !j.HasSeatMeta &&
                    j.Board == board &&
                    j.Folder == folder &&
                    j.LineKey == lineKey &&
                    j.ActingPos == actingPos &&
                    j.IsIcm == isIcm &&
                    openStatuses.Contains(j.Status));
                if (existing != null)
                    return (existing, true);
            }

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

        // 👇 NEW: list of alive positions from the frontend (e.g. ["UTG1","BB"])
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
