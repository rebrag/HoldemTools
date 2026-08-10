using Azure.Storage.Files.DataLake;
using Azure.Storage.Queues;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
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
        private readonly QueueClient _queue;
        private readonly ILogger<NodeRequestsController> _logger;

        public NodeRequestsController(
            IConfiguration configuration,
            QueueClient queue,
            ILogger<NodeRequestsController> logger)
        {
            string? connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            _dataLakeServiceClient = new DataLakeServiceClient(connectionString);
            _queue = queue;
            _logger = logger;
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

            string fileName = $"{now:HHmmss}_{rand}.json";
            var file = dir.GetFileClient(fileName);
            string json = JsonSerializer.Serialize(payload);
            await file.UploadAsync(BinaryData.FromString(json).ToStream(), overwrite: true);

            // Push notification for the watcher, enqueued strictly AFTER the
            // blob write so the only reachable failure shape is
            // blob-without-message, which the watcher's reconcile listing
            // picks up within its interval. The message carries the payload
            // so the watcher can process it without downloading the blob.
            try
            {
                var message = new NodeRequestMessage
                {
                    Path = $"{dirPath}/{fileName}",
                    Stacks = payload.Stacks,
                    NodeName = payload.NodeName,
                    Board = payload.Board,
                    NodeId = payload.NodeId,
                };
                await _queue.SendMessageAsync(JsonSerializer.Serialize(message));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Noderequest enqueue failed for {Path}; watcher will discover it via reconcile listing.",
                    $"{dirPath}/{fileName}");
            }

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

        // Queue message: blob payload plus its path. Sent as raw UTF-8 JSON -
        // both this client and the Python watcher use the SDK default of no
        // Base64 encoding, and the two must stay in agreement.
        public class NodeRequestMessage
        {
            [JsonPropertyName("path")] public string? Path { get; set; }
            [JsonPropertyName("stacks")] public string? Stacks { get; set; }
            [JsonPropertyName("node_name")] public string? NodeName { get; set; }
            [JsonPropertyName("board")] public string? Board { get; set; }
            [JsonPropertyName("node_id")] public string? NodeId { get; set; }
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
