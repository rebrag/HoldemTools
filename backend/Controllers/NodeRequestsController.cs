using Azure.Storage.Files.DataLake;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    // --------------------------------------------------------------------
    // POST api/noderequests
    // Queues an on-demand street extraction (turn/river card) for the local
    // solver watcher. The watcher polls noderequests/<today>/ and uploads the
    // street bundle + manifest update; the frontend polls the manifest.
    // --------------------------------------------------------------------
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class NodeRequestsController : ControllerBase
    {
        private static readonly Regex NodeIdRe = new(@"^r:\d+(:[a-zA-Z0-9]+)*$", RegexOptions.Compiled);
        private static readonly Regex BoardRe = new(@"^([2-9TJQKA][hdcs]){3,5}$", RegexOptions.Compiled);

        private readonly DataLakeServiceClient _dataLakeServiceClient;
        private readonly string _containerName;

        public NodeRequestsController(IConfiguration configuration)
        {
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
        }

        [HttpPost]
        public async Task<IActionResult> QueueNodeRequest([FromBody] NodeRequestBody req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            if (string.IsNullOrWhiteSpace(req.Stacks) || string.IsNullOrWhiteSpace(req.Node))
                return BadRequest("Missing stacks/node.");
            if (string.IsNullOrWhiteSpace(req.Board) || !BoardRe.IsMatch(req.Board))
                return BadRequest("Invalid board.");
            if (string.IsNullOrWhiteSpace(req.NodeId) || !NodeIdRe.IsMatch(req.NodeId))
                return BadRequest("Invalid nodeId.");

            var fs = _dataLakeServiceClient.GetFileSystemClient(_containerName);
            await fs.CreateIfNotExistsAsync();

            var now = DateTimeOffset.UtcNow;
            string rand = Guid.NewGuid().ToString("N")[..6];
            string dirPath = $"noderequests/{now:yyyy/MM/dd}/{Sanitize(uid)}";
            var dir = fs.GetDirectoryClient(dirPath);
            await dir.CreateIfNotExistsAsync();

            var payload = new NodeRequestBlob
            {
                Stacks = req.Stacks,
                NodeName = req.Node,
                Board = req.Board,
                NodeId = req.NodeId,
                RequestedUtc = now.UtcDateTime.ToString("o"),
            };

            var file = dir.GetFileClient($"{now:HHmmss}_{rand}.json");
            string json = JsonSerializer.Serialize(payload);
            await file.UploadAsync(BinaryData.FromString(json).ToStream(), overwrite: true);

            return Ok(new { ok = true });
        }

        private static string Sanitize(string s)
        {
            var sb = new System.Text.StringBuilder(s.Length);
            foreach (var ch in s)
            {
                sb.Append(char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.' ? ch : '_');
            }
            return sb.ToString();
        }

        public class NodeRequestBody
        {
            public string? Stacks { get; set; }
            public string? Node { get; set; }
            public string? Board { get; set; }
            public string? NodeId { get; set; }
        }

        // Property names match what the Python watcher parses.
        public class NodeRequestBlob
        {
            [JsonPropertyName("stacks")] public string? Stacks { get; set; }
            [JsonPropertyName("node_name")] public string? NodeName { get; set; }
            [JsonPropertyName("board")] public string? Board { get; set; }
            [JsonPropertyName("node_id")] public string? NodeId { get; set; }
            [JsonPropertyName("requested_utc")] public string? RequestedUtc { get; set; }
        }
    }
}
