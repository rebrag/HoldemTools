using Azure.Storage.Queues;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    // --------------------------------------------------------------------
    // POST api/noderequests
    // Queues an on-demand street extraction (turn/river card) for the
    // watcher that solved the board; the frontend polls the manifest.
    //
    // Routed by the board's manifest: when manifest.engine.solver is
    // "htsolver" the request goes to the htsolver worker's own Storage Queue
    // and NO blob is written, so the Pio watcher's reconcile listing of
    // noderequests/ can never find it and re-solve the board with Pio. Every
    // other board (Pio manifests carry no engine.solver, and a missing
    // manifest means nothing to route on) takes exactly today's path: blob
    // under noderequests/<today>/, then a push message on the Pio queue.
    // --------------------------------------------------------------------
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class NodeRequestsController : ControllerBase
    {
        private static readonly Regex NodeIdRe = new(@"^r:\d+(:[a-zA-Z0-9]+)*$", RegexOptions.Compiled);
        private static readonly Regex BoardRe = new(@"^([2-9TJQKA][hdcs]){3,5}$", RegexOptions.Compiled);

        private readonly INodeRequestStore _store;
        private readonly QueueClient _queue;
        private readonly HtNodeRequestQueue _htQueue;
        private readonly ILogger<NodeRequestsController> _logger;

        public NodeRequestsController(
            INodeRequestStore store,
            QueueClient queue,
            HtNodeRequestQueue htQueue,
            ILogger<NodeRequestsController> logger)
        {
            _store = store;
            _queue = queue;
            _htQueue = htQueue;
            _logger = logger;
        }

        [HttpPost]
        public async Task<IActionResult> QueueNodeRequest([FromBody] NodeRequestBody req, CancellationToken ct = default)
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

            var now = DateTimeOffset.UtcNow;

            string? solver;
            try
            {
                solver = IsSafeSegment(req.Stacks) && IsSafeSegment(req.Node)
                    ? await _store.ReadManifestSolverAsync(req.Stacks, req.Node, req.Board, ct)
                    : null;
            }
            catch (Exception ex)
            {
                // Storage failing to answer is not "no manifest": treating it
                // as Pio would hand an htsolver board to the Pio watcher.
                _logger.LogWarning(ex, "Manifest read failed for {Stacks}/{Node}/{Board}.",
                    req.Stacks, req.Node, req.Board);
                return StatusCode(503, "Could not read the board's manifest; try again.");
            }

            if (solver == SolveJobSolver.HtSolver)
                return await QueueHtSolverRequestAsync(req, now, ct);

            string rand = Guid.NewGuid().ToString("N")[..6];
            string dirPath = $"noderequests/{now:yyyy/MM/dd}/{Sanitize(uid)}";

            var payload = new NodeRequestBlob
            {
                Stacks = req.Stacks,
                NodeName = req.Node,
                Board = req.Board,
                NodeId = req.NodeId,
                RequestedUtc = now.UtcDateTime.ToString("o"),
            };

            string fileName = $"{now:HHmmss}_{rand}.json";
            string json = JsonSerializer.Serialize(payload);
            await _store.WriteRequestBlobAsync(dirPath, fileName, json);

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

        /// <summary>
        /// htsolver boards: queue-only. There is no blob to fall back on, so a
        /// failed enqueue is a 503 the viewer surfaces, rather than a request
        /// that silently never arrives.
        /// </summary>
        private async Task<IActionResult> QueueHtSolverRequestAsync(
            NodeRequestBody req, DateTimeOffset now, CancellationToken ct)
        {
            var message = new NodeRequestBlob
            {
                Stacks = req.Stacks,
                NodeName = req.Node,
                Board = req.Board,
                NodeId = req.NodeId,
                RequestedUtc = now.UtcDateTime.ToString("o"),
            };
            try
            {
                await _htQueue.SendAsync(JsonSerializer.Serialize(message), ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "htsolver noderequest enqueue failed for {Stacks}/{Node}/{Board} {NodeId}.",
                    req.Stacks, req.Node, req.Board, req.NodeId);
                return StatusCode(503, "Could not queue the request; try again.");
            }
            return Ok(new { ok = true });
        }

        /// <summary>
        /// A client-supplied path segment safe to splice into the manifest's
        /// blob path. Anything else cannot name a published board, so it is
        /// treated as "no manifest" and takes today's path unchanged.
        /// </summary>
        private static bool IsSafeSegment(string s) =>
            s.Length <= 200 && !s.Contains('/') && !s.Contains('\\') && s != "." && s != ".."
            && !s.Contains("..") && !s.Contains('?') && !s.Contains('#');

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

        // Property names match what the Python watcher parses. Also the
        // htsolver queue's message shape (there is no blob path to carry).
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
