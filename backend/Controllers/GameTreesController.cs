using Azure.Storage.Blobs;
using Azure.Storage.Files.DataLake;
using Azure.Storage.Files.DataLake.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
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

        public GameTreesController(IConfiguration configuration)
        {
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
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

            // 👇 Include AlivePositions in the stored JSON
            var payload = new
            {
                req.Folder,
                req.Line,
                req.ActingPos,
                req.IsICM,
                req.Text,
                req.AlivePositions,   // 👈 NEW FIELD
                UploadedAtUtc = now
            };

            byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
            using var ms = new MemoryStream(bytes);

            await file.UploadAsync(ms, overwrite: true);

            return Ok(new { ok = true, path = $"{dirPath}/{fileName}" });
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
    }
}
