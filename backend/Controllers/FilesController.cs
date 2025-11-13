using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Files.DataLake;
using Azure.Storage.Files.DataLake.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
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

        public FilesController(IConfiguration configuration)
        {
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
        // GET api/files/folders – top-level folders
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
        // GET api/files/{folder}/{file} – raw file fetch
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
        // GET api/files/{folder}/metadata – parsed, typed metadata summary
        // Returns: { name, ante, isIcm, icmCount, seats, tags, icmPayouts }
        // --------------------------------------------------------------------
        [HttpGet("{folderName}/metadata")]
        public async Task<ActionResult<FolderMetadataDto>> GetFolderMetadata(string folderName)
        {
            var meta = await TryReadFolderMetadata(folderName);
            if (meta == null)
                return NotFound($"metadata.json not found in folder '{folderName}'.");

            // Enrich with seats + tags here as well, so this endpoint stays useful.
            int seats = CountNumericChunks(folderName);
            var tags = new List<string>();

            if (seats == 2)
                tags.Add("HU");

            if (IsFinalTable(meta, seats))
                tags.Add("FT");

            if (meta.IsIcm)
                tags.Add("ICM");

            meta.Seats = seats;
            meta.Tags = tags.ToArray();

            return Ok(meta);
        }

        // --------------------------------------------------------------------
        // GET api/files/foldersWithMetadata – list of folders with metadata summary
        // Includes tags + seats so frontend can sort & badge instantly.
        // --------------------------------------------------------------------
        [HttpGet("foldersWithMetadata")]
        public async Task<ActionResult<List<FolderWithMetadataDto>>> GetFoldersWithMetadata(
    [FromQuery] bool includeMissing = false)
        {
            var folders = await GetFolderListInternal();

            // Create tasks for all folders at once
            var tasks = folders.Select(async folder =>
            {
                var meta = await TryReadFolderMetadata(folder);
                int seats = CountNumericChunks(folder);

                if (meta != null)
                {
                    var tags = new List<string>();

                    if (seats == 2)
                        tags.Add("HU");

                    if (IsFinalTable(meta, seats))
                        tags.Add("FT");

                    if (meta.IsIcm)
                        tags.Add("ICM");

                    meta.Seats = seats;
                    meta.Tags = tags.ToArray();

                    return new FolderWithMetadataDto
                    {
                        Folder = folder,
                        Metadata = meta,
                        HasMetadata = true
                    };
                }

                if (!includeMissing)
                {
                    // Skip this folder entirely
                    return null;
                }

                return new FolderWithMetadataDto
                {
                    Folder = folder,
                    Metadata = null,
                    HasMetadata = false
                };
            });

            var results = (await Task.WhenAll(tasks))
                .Where(r => r != null)!
                .ToList();

            return Ok(results.OrderBy(r => r.Folder).ToList());
        }


        // ========= Helpers =========

        private async Task<List<string>> GetFolderListInternal()
        {
            var list = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var fs = _dataLakeServiceClient.GetFileSystemClient(_containerName);

            await foreach (PathItem item in fs.GetPathsAsync())
            {
                if (item.IsDirectory == true)
                {
                    string first = item.Name.Split('/')[0];
                    list.Add(first);
                }
            }

            return list.ToList();
        }

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
                Seats = 0,             // filled later
                Tags = Array.Empty<string>() // filled later
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

        private static bool IsFinalTable(FolderMetadataDto meta, int seats)
        {
            if (!string.IsNullOrWhiteSpace(meta.Name) &&
                meta.Name.IndexOf("FT", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }

            // Heuristic: many seats + many payouts
            if (meta.IsIcm && meta.IcmCount >= 6 && seats >= 6)
            {
                return true;
            }

            return false;
        }
    }

    // ========= DTOs =========

    public sealed class FolderMetadataDto
    {
        public string Name { get; set; } = "";
        public double Ante { get; set; }
        public bool IsIcm { get; set; }
        public int IcmCount { get; set; }

        // NEW: derived info
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
