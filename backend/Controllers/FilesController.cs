using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Files.DataLake;
using Azure.Storage.Files.DataLake.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Services;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class FilesController : ControllerBase
    {
        private readonly DataLakeServiceClient _dataLakeServiceClient;
        private readonly BlobServiceClient _blobServiceClient;
        private readonly string _containerName;
        private readonly IMemoryCache _cache;
        private readonly AppDbContext _db;
        // Dev-only: when Engine:LocalSolutionsDir is set (never in prod),
        // engine-exported solutions are served from the local directory ahead
        // of ADLS so /solutions renders them with zero frontend changes.
        private readonly PokerRangeAPI2.Services.EngineArtifacts.EngineLocalSolutions _engineLocal;

        public FilesController(IConfiguration configuration, IMemoryCache cache, AppDbContext db,
            PokerRangeAPI2.Services.EngineArtifacts.EngineLocalSolutions engineLocal)
        {
            _cache = cache;
            _db = db;
            _engineLocal = engineLocal;

            // 1) Read configuration (user-secrets / env vars / appsettings.*.json)
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            // 2) Create SDK clients
            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
            _blobServiceClient = new BlobServiceClient(connectionString);
        }

        // --------------------------------------------------------------------
        // GET api/files/folders – top-level folders (from Data Lake)
        // --------------------------------------------------------------------
        [HttpGet("folders")]
        public async Task<ActionResult<List<string>>> GetFolderList()
        {
            var folderNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            DataLakeFileSystemClient fileSystem = _dataLakeServiceClient.GetFileSystemClient(_containerName);
            await foreach (PathItem item in fileSystem.GetPathsAsync())
            {
                if (item.IsDirectory == true)
                {
                    string firstSegment = item.Name.Split('/')[0];
                    folderNames.Add(firstSegment);
                }
            }

            return Ok(folderNames.OrderBy(s => s).ToList());
        }

        // --------------------------------------------------------------------
        // GET api/files/listJSONs/{folder} – all files inside a folder
        // --------------------------------------------------------------------
        [HttpGet("listJSONs/{folderName}")]
        public async Task<ActionResult<List<string>>> FilesInFolder(string folderName)
        {
            var fileNames = new List<string>();

            DataLakeDirectoryClient dir = _dataLakeServiceClient
                .GetFileSystemClient(_containerName)
                .GetDirectoryClient(folderName);

            await foreach (PathItem item in dir.GetPathsAsync())
            {
                if (item.IsDirectory == false)
                {
                    string shortName = Path.GetFileName(item.Name);
                    fileNames.Add(shortName);
                }
            }

            return Ok(fileNames);
        }

        // --------------------------------------------------------------------
        // GET api/files/{folder}/{file} – raw file fetch (sim JSONs)
        // --------------------------------------------------------------------
        [HttpGet("{folderName}/{fileName}")]
        public async Task<IActionResult> GrabData(string folderName, string fileName)
        {
            BlobClient blob = _blobServiceClient
                .GetBlobContainerClient(_containerName)
                .GetBlobClient($"{folderName}/{fileName}");

            if (!await blob.ExistsAsync())
                return NotFound($"File not found: {fileName}");

            BlobDownloadResult result = await blob.DownloadContentAsync();
            // result.Content is BinaryData; convert to string for JSON/text files:
            return Ok(result.Content.ToString());
        }

        // --------------------------------------------------------------------
        // GET api/files/piosolutions/{stacks}/{node}/{board}/{nodeId}.json
        // Per-node postflop solution doc. Tries the v2 board-folder layout
        // first, then falls back to the legacy flat "{board}-{suffix}.json".
        // --------------------------------------------------------------------
        [Authorize]
        [HttpGet("piosolutions/{stacks}/{node}/{board}/{nodeId}.json")]
        public async Task<IActionResult> GetPioSolution(
            string stacks,
            string node,
            string board,
            string nodeId)
        {
            // nodeId can be "r:0", "r:0:1", or already "r.0.1".
            var nodeSuffix = (nodeId ?? "root").Replace(":", ".");

            var localDoc = _engineLocal.TryReadText(
                $"piosolutions/{stacks}/{node}/{board}/{nodeSuffix}.json");
            if (localDoc != null) return Ok(localDoc);

            var container = _blobServiceClient.GetBlobContainerClient(_containerName);

            // v2: piosolutions/{stacks}/{node}/{board}/{suffix}.json
            string v2Path = $"piosolutions/{stacks}/{node}/{board}/{nodeSuffix}.json";
            BlobClient blob = container.GetBlobClient(v2Path);

            if (!await blob.ExistsAsync())
            {
                // legacy: piosolutions/{stacks}/{node}/{board}-{suffix}.json
                string legacyPath = $"piosolutions/{stacks}/{node}/{board}-{nodeSuffix}.json";
                blob = container.GetBlobClient(legacyPath);
                if (!await blob.ExistsAsync())
                    return NotFound($"Pio solution not found: {v2Path}");
            }

            BlobDownloadResult result = await blob.DownloadContentAsync();
            return Ok(result.Content.ToString());
        }

        // --------------------------------------------------------------------
        // GET api/files/piosolutions/{stacks}/{node}/{board}/manifest
        // Per-board manifest (streets map, seats, preflop context). Not cached:
        // the frontend polls this while a solve is pending; 404 = not solved.
        // --------------------------------------------------------------------
        [Authorize]
        [HttpGet("piosolutions/{stacks}/{node}/{board}/manifest")]
        public async Task<IActionResult> GetPioSolutionManifest(
            string stacks,
            string node,
            string board)
        {
            string blobPath = $"piosolutions/{stacks}/{node}/{board}/manifest.json";

            var localManifest = _engineLocal.TryReadText(blobPath);
            if (localManifest != null)
            {
                Response.Headers.CacheControl = "no-cache";
                return Ok(localManifest);
            }

            BlobClient blob = _blobServiceClient
                .GetBlobContainerClient(_containerName)
                .GetBlobClient(blobPath);

            if (!await blob.ExistsAsync())
                return NotFound($"Manifest not found: {blobPath}");

            BlobDownloadResult result = await blob.DownloadContentAsync();
            Response.Headers.CacheControl = "no-cache";
            return Ok(result.Content.ToString());
        }

        // --------------------------------------------------------------------
        // GET api/files/piosolutions/{stacks}/{node}/{board}/streets/{seed}.json
        // One gzipped street bundle (all decision nodes of one street). The
        // blob is stored pre-gzipped; serve the bytes as-is with
        // Content-Encoding so the browser inflates it natively. The response
        // compression middleware skips responses that already carry a
        // Content-Encoding header, so there is no double compression.
        // --------------------------------------------------------------------
        [Authorize]
        [HttpGet("piosolutions/{stacks}/{node}/{board}/streets/{seed}.json")]
        public async Task<IActionResult> GetPioStreetBundle(
            string stacks,
            string node,
            string board,
            string seed)
        {
            var seedSuffix = (seed ?? "r.0").Replace(":", ".");
            string blobPath = $"piosolutions/{stacks}/{node}/{board}/streets/{seedSuffix}.json.gz";

            var localBundle = _engineLocal.TryReadBytes(blobPath);
            if (localBundle != null)
            {
                Response.Headers.ContentEncoding = "gzip";
                Response.Headers.CacheControl = "no-cache";  // dev loop: re-import must show up
                return File(localBundle, "application/json");
            }

            BlobClient blob = _blobServiceClient
                .GetBlobContainerClient(_containerName)
                .GetBlobClient(blobPath);

            if (!await blob.ExistsAsync())
                return NotFound($"Street bundle not found: {blobPath}");

            BlobDownloadResult result = await blob.DownloadContentAsync();
            Response.Headers.ContentEncoding = "gzip";
            Response.Headers.CacheControl = "public, max-age=86400";
            return File(result.Content.ToArray(), "application/json");
        }

        // --------------------------------------------------------------------
        // GET api/files/piosolutionsIndex
        // The caller's solved-flops library: the shared index blob
        // (piosolutions-index.json) with a per-viewer overlay applied - see
        // PostflopLibraryOverlay for what is labelled and what is dropped.
        //
        // Only the blob is server-cached (10s, to absorb poll bursts); the
        // overlay is recomputed per request, since it is viewer-specific and
        // must reflect a hide made a second ago. no-cache to the browser: a
        // just-solved board must show up on the next fetch, and a max-age here
        // would compound with the server TTL into minutes of staleness.
        // --------------------------------------------------------------------
        [Authorize]
        [HttpGet("piosolutionsIndex")]
        public async Task<IActionResult> GetPioSolutionsIndex()
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            const string cacheKey = "piosolutions:index";

            if (!_cache.TryGetValue(cacheKey, out string? json) || json == null)
            {
                var indexBlob = _blobServiceClient
                    .GetBlobContainerClient(_containerName)
                    .GetBlobClient("piosolutions-index.json");

                if (await indexBlob.ExistsAsync())
                {
                    BlobDownloadResult result = await indexBlob.DownloadContentAsync();
                    json = result.Content.ToString();
                }
                else if (!_engineLocal.Enabled)
                {
                    return NotFound("piosolutions-index.json not found. No postflop solutions indexed yet.");
                }

                _cache.Set(cacheKey, json ?? "", new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(10)
                });
            }

            // Fold in htsolver-published solves (enginesolutions-index.json,
            // written by the publish endpoint - kept separate from the Pio
            // watcher's index so the two writers never race). Same 10s cache.
            const string engineCacheKey = "enginesolutions:index";
            if (!_cache.TryGetValue(engineCacheKey, out string? engineJson))
            {
                var engineBlob = _blobServiceClient
                    .GetBlobContainerClient(_containerName)
                    .GetBlobClient("enginesolutions-index.json");
                engineJson = await engineBlob.ExistsAsync()
                    ? (await engineBlob.DownloadContentAsync()).Value.Content.ToString()
                    : "";
                _cache.Set(engineCacheKey, engineJson, new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(10)
                });
            }
            if (!string.IsNullOrEmpty(engineJson))
            {
                json = PokerRangeAPI2.Services.EngineArtifacts.EngineLocalSolutions
                    .MergeIndexJson(string.IsNullOrEmpty(json) ? null : json, engineJson);
            }

            if (_engineLocal.Enabled)
            {
                // Merge locally exported engine solves into the shared index
                // (uncached: the dev loop re-imports and expects to see it).
                json = _engineLocal.MergeIndex(string.IsNullOrEmpty(json) ? null : json);
            }
            if (string.IsNullOrEmpty(json))
            {
                return NotFound("piosolutions-index.json not found. No postflop solutions indexed yet.");
            }

            var library = await PostflopLibraryOverlay.ApplyAsync(_db, uid, json);

            Response.Headers.CacheControl = "no-cache";
            return Ok(library);
        }


        // --------------------------------------------------------------------
        // GET api/files/{folder}/metadata – parsed, typed metadata summary
        // Returns: { name, ante, isIcm, icmCount, seats, tags, icmPayouts }
        // (still reads that folder's metadata.json directly)
        // --------------------------------------------------------------------
        [HttpGet("{folderName}/metadata")]
        public async Task<ActionResult<FolderMetadataDto>> GetFolderMetadata(string folderName)
        {
            var meta = await TryReadFolderMetadata(folderName);
            if (meta == null)
                return NotFound($"metadata.json not found in folder '{folderName}'.");

            int seats = CountNumericChunks(folderName);
            var tags = new List<string>();

            if (seats == 2)
                tags.Add("HU");

            if (IsFinalTable(meta))
                tags.Add("FT");

            if (meta.IsIcm)
                tags.Add("ICM");

            meta.Seats = seats;
            meta.Tags = tags.ToArray();

            return Ok(meta);
        }

        // --------------------------------------------------------------------
        // GET api/files/foldersWithMetadata
        // NOW: single source of truth from sim-index.json
        // --------------------------------------------------------------------
        [HttpGet("foldersWithMetadata")]
        public async Task<ActionResult<List<FolderWithMetadataDto>>> GetFoldersWithMetadata(
            [FromQuery] bool includeMissing = false) // kept for compatibility, but ignored
        {
            const string cacheKey = "foldersWithMetadata:index";

            if (_cache.TryGetValue(cacheKey, out List<FolderWithMetadataDto>? cached) && cached != null)
            {
                return Ok(cached);
            }

            var container = _blobServiceClient.GetBlobContainerClient(_containerName);
            var indexBlob = container.GetBlobClient("sim-index.json");

            if (!await indexBlob.ExistsAsync())
            {
                return NotFound("sim-index.json not found in storage. Please run the SimIndexBuilder tool.");
            }

            BlobDownloadResult result = await indexBlob.DownloadContentAsync();
            string json = result.Content.ToString();

            List<FolderWithMetadataDto>? entries;
            try
            {
                entries = JsonSerializer.Deserialize<List<FolderWithMetadataDto>>(
                    json,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
            }
            catch (JsonException ex)
            {
                return BadRequest($"Failed to parse sim-index.json: {ex.Message}");
            }

            entries ??= new List<FolderWithMetadataDto>();

            // Normalize ordering (just in case)
            var ordered = entries
                .OrderBy(e => e.Folder, StringComparer.OrdinalIgnoreCase)
                .ToList();

            _cache.Set(cacheKey, ordered, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
            });

            return Ok(ordered);
        }

        // ========= Helpers =========

        /// <summary>
        /// Reads and parses {folder}/metadata.json and returns a normalized DTO, or null if not found.
        /// Handles icm as array, the string "none", or missing.
        /// </summary>
        private async Task<FolderMetadataDto?> TryReadFolderMetadata(string folderName)
        {
            BlobClient blob = _blobServiceClient
                .GetBlobContainerClient(_containerName)
                .GetBlobClient($"{folderName}/metadata.json");

            if (!await blob.ExistsAsync())
                return null;

            BlobDownloadResult result = await blob.DownloadContentAsync();
            using JsonDocument doc = JsonDocument.Parse(result.Content.ToString());

            string? name = null;
            double? ante = null;
            bool isIcm = false;
            int icmCount = 0;
            double[]? icmPayouts = null;

            JsonElement root = doc.RootElement;

            if (root.TryGetProperty("name", out var nameProp) && nameProp.ValueKind == JsonValueKind.String)
            {
                name = nameProp.GetString();
            }

            if (root.TryGetProperty("ante", out var anteProp))
            {
                // Accept number or numeric-looking string
                if (anteProp.ValueKind == JsonValueKind.Number && anteProp.TryGetDouble(out var anteVal))
                    ante = anteVal;
                else if (anteProp.ValueKind == JsonValueKind.String &&
                         double.TryParse(anteProp.GetString(), out var anteParsed))
                    ante = anteParsed;
            }

            if (root.TryGetProperty("icm", out var icmProp))
            {
                if (icmProp.ValueKind == JsonValueKind.Array)
                {
                    icmCount = icmProp.GetArrayLength();
                    isIcm = icmCount > 0;

                    var list = new List<double>(icmCount);
                    foreach (var el in icmProp.EnumerateArray())
                    {
                        if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var val))
                        {
                            list.Add(val);
                        }
                    }
                    icmPayouts = list.ToArray();
                }
                else if (icmProp.ValueKind == JsonValueKind.String &&
                         string.Equals(icmProp.GetString(), "none", StringComparison.OrdinalIgnoreCase))
                {
                    isIcm = false;
                    icmCount = 0;
                }
                else
                {
                    // Any other non-array value counts as "not ICM"
                    isIcm = false;
                    icmCount = 0;
                }
            }
            else
            {
                // No "icm" key present
                isIcm = false;
                icmCount = 0;
            }

            return new FolderMetadataDto
            {
                Name = name ?? folderName,
                Ante = ante ?? 0,
                IsIcm = isIcm,
                IcmCount = icmCount,
                IcmPayouts = icmPayouts,
                Seats = 0,                   // filled by callers when needed
                Tags = Array.Empty<string>() // filled by callers when needed
            };
        }

        private static int CountNumericChunks(string folderName)
        {
            if (string.IsNullOrWhiteSpace(folderName)) return 0;

            var parts = folderName.Split('_', StringSplitOptions.RemoveEmptyEntries);
            int count = 0;

            foreach (var part in parts)
            {
                var digits = new string(part.TakeWhile(char.IsDigit).ToArray());
                if (digits.Length == 0) continue;
                if (int.TryParse(digits, out _))
                {
                    count++;
                }
            }

            return count;
        }

        /// <summary>
        /// A sim/solution is FT-only if metadata.Name contains "FT" (case-insensitive).
        /// ICM-only sims are NOT considered FT.
        /// </summary>
        private static bool IsFinalTable(FolderMetadataDto? meta)
        {
            if (meta is null) return false;

            var name = meta.Name ?? string.Empty;
            return name.IndexOf("FT", StringComparison.OrdinalIgnoreCase) >= 0;
        }
    }

    // ========= DTOs =========

    public sealed class FolderMetadataDto
    {
        public string Name { get; set; } = "";
        public double Ante { get; set; }
        public bool IsIcm { get; set; }
        public int IcmCount { get; set; }

        // Derived info
        public int Seats { get; set; }
        public string[] Tags { get; set; } = Array.Empty<string>();

        // Optional: full payout structure for ICM sims
        public double[]? IcmPayouts { get; set; }
    }

    public sealed class FolderWithMetadataDto
    {
        public string Folder { get; set; } = "";
        public bool HasMetadata { get; set; }
        public FolderMetadataDto? Metadata { get; set; }
    }
}
