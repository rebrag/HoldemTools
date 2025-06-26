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
            // 1️⃣  Read configuration (user-secrets / env vars / appsettings.*.json)
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException(
                    "AzureStorage:ConnectionString is missing from configuration.");

            // 2️⃣  Create SDK clients
            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
            _blobServiceClient = new BlobServiceClient(connectionString);
        }

        // --------------------------------------------------------------------
        //  GET api/files/folders   – top-level folders
        // --------------------------------------------------------------------
        [HttpGet("folders")]
        public async Task<ActionResult<List<string>>> GetFolderList()
        {
            var folderNames = new HashSet<string>();

            DataLakeFileSystemClient fileSystem = _dataLakeServiceClient
                                                 .GetFileSystemClient(_containerName);
            await foreach (PathItem item in fileSystem.GetPathsAsync())
            {
                if (item.IsDirectory == true)
                {
                    string firstSegment = item.Name.Split('/')[0];
                    folderNames.Add(firstSegment);
                }
            }

            return Ok(folderNames.ToList());
        }

        // --------------------------------------------------------------------
        //  GET api/files/listJSONs/{folder}
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
        //  GET api/files/{folder}/{file}
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
            return Ok(result.Content.ToString());
        }
    }
}
