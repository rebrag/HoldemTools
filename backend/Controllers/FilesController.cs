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
        // NEW: GET api/files/{folder}/metadata – parsed, typed metadata summary
        // Returns: { name, ante, isIcm, icmCount }
        // --------------------------------------------------------------------
        [HttpGet("{folderName}/metadata")]
        public async Task<ActionResult<FolderMetadataDto>> GetFolderMetadata(string folderName)
        {
            var meta = await TryReadFolderMetadata(folderName);
            if (meta == null)
                return NotFound($"metadata.json not found in folder '{folderName}'.");

            return Ok(meta);
        }

        // --------------------------------------------------------------------
        // NEW: GET api/files/foldersWithMetadata – list of folders with metadata summary
        // Skips folders that do not contain metadata.json unless includeMissing=true
        // --------------------------------------------------------------------
        [HttpGet("foldersWithMetadata")]
        public async Task<ActionResult<List<FolderWithMetadataDto>>> GetFoldersWithMetadata(
            [FromQuery] bool includeMissing = false)
        {
            var results = new List<FolderWithMetadataDto>();
            var folders = await GetFolderListInternal();

            foreach (var folder in folders)
            {
                var meta = await TryReadFolderMetadata(folder);
                if (meta != null)
                {
                    results.Add(new FolderWithMetadataDto
                    {
                        Folder = folder,
                        Metadata = meta,
                        HasMetadata = true
                    });
                }
                else if (includeMissing)
                {
                    results.Add(new FolderWithMetadataDto
                    {
                        Folder = folder,
                        Metadata = null,
                        HasMetadata = false
                    });
                }
            }

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
                IcmCount = icmCount
            };
        }
    }

    // ========= DTOs =========

    public sealed class FolderMetadataDto
    {
        public string Name { get; set; } = "";
        public double Ante { get; set; }
        public bool IsIcm { get; set; }
        public int IcmCount { get; set; }
    }

    public sealed class FolderWithMetadataDto
    {
        public string Folder { get; set; } = "";
        public bool HasMetadata { get; set; }
        public FolderMetadataDto? Metadata { get; set; }
    }
}
