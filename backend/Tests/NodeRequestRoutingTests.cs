// Tests/NodeRequestRoutingTests.cs
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    /// <summary>
    /// POST api/noderequests routes on the board's manifest: htsolver boards go
    /// to their own queue with no blob; Pio boards and boards with no manifest
    /// take exactly the old path (blob, then a push on the Pio queue).
    /// </summary>
    public class NodeRequestRoutingTests
    {
        private sealed record Rig(
            NodeRequestsController Controller, FakeNodeRequestStore Store,
            FakeQueueClient PioQueue, FakeQueueClient HtQueue);

        private static Rig NewRig()
        {
            var store = new FakeNodeRequestStore();
            var pio = new FakeQueueClient();
            var ht = new FakeQueueClient();
            var controller = new NodeRequestsController(
                store, pio, new HtNodeRequestQueue(ht), NullLogger<NodeRequestsController>.Instance)
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(
                            new[] { new Claim("user_id", "user-1") }, "TestAuth")),
                    },
                },
            };
            return new Rig(controller, store, pio, ht);
        }

        private static NodeRequestsController.NodeRequestBody Body() => new()
        {
            Stacks = "40-27.5-25",
            Node = "101500_line=Call_pos=BB_icm=0",
            Board = "QhJhTh",
            NodeId = "r:0:c:c:2s",
        };

        private const string Key = "40-27.5-25/101500_line=Call_pos=BB_icm=0/QhJhTh";

        [Fact]
        public async Task HtSolverBoard_GoesToTheSecondQueue_WithNoBlob()
        {
            var rig = NewRig();
            rig.Store.ManifestSolvers[Key] = "htsolver";

            Assert.IsType<OkObjectResult>(await rig.Controller.QueueNodeRequest(Body()));

            Assert.Empty(rig.Store.Blobs);
            Assert.Empty(rig.PioQueue.Messages);
            using var msg = JsonDocument.Parse(Assert.Single(rig.HtQueue.Messages));
            var root = msg.RootElement;
            Assert.Equal(
                new[] { "stacks", "node_name", "board", "node_id", "requested_utc" },
                root.EnumerateObject().Select(p => p.Name).ToArray());
            Assert.Equal("40-27.5-25", root.GetProperty("stacks").GetString());
            Assert.Equal("101500_line=Call_pos=BB_icm=0", root.GetProperty("node_name").GetString());
            Assert.Equal("QhJhTh", root.GetProperty("board").GetString());
            Assert.Equal("r:0:c:c:2s", root.GetProperty("node_id").GetString());
        }

        [Theory]
        [InlineData(true)]   // a Pio manifest (no engine.solver)
        [InlineData(false)]  // no manifest at all
        public async Task PioOrMissingManifest_TakesTheOldPath(bool hasManifest)
        {
            var rig = NewRig();
            if (hasManifest) rig.Store.ManifestSolvers[Key] = null;

            Assert.IsType<OkObjectResult>(await rig.Controller.QueueNodeRequest(Body()));

            Assert.Empty(rig.HtQueue.Messages);
            var (path, json) = Assert.Single(rig.Store.Blobs);
            Assert.Matches(@"^noderequests/\d{4}/\d{2}/\d{2}/user-1/\d{6}_[0-9a-f]{6}\.json$", path);
            using var blob = JsonDocument.Parse(json);
            Assert.Equal(
                new[] { "stacks", "node_name", "board", "node_id", "requested_utc" },
                blob.RootElement.EnumerateObject().Select(p => p.Name).ToArray());

            using var msg = JsonDocument.Parse(Assert.Single(rig.PioQueue.Messages));
            Assert.Equal(path, msg.RootElement.GetProperty("path").GetString());
            Assert.Equal(
                new[] { "path", "stacks", "node_name", "board", "node_id" },
                msg.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
        }

        [Fact]
        public async Task PioEnqueueFailure_IsStillOk_TheBlobIsTheFallback()
        {
            var rig = NewRig();
            rig.PioQueue.Fail = true;
            Assert.IsType<OkObjectResult>(await rig.Controller.QueueNodeRequest(Body()));
            Assert.Single(rig.Store.Blobs);
        }

        [Fact]
        public async Task HtSolverEnqueueFailure_Is503_AndWritesNoBlob()
        {
            var rig = NewRig();
            rig.Store.ManifestSolvers[Key] = "htsolver";
            rig.HtQueue.Fail = true;

            var result = await rig.Controller.QueueNodeRequest(Body());

            Assert.Equal(503, Assert.IsType<ObjectResult>(result).StatusCode);
            Assert.Empty(rig.Store.Blobs);
            Assert.Empty(rig.PioQueue.Messages);
        }

        [Fact]
        public async Task ManifestReadFailure_Is503_NeverAPioFallback()
        {
            var rig = NewRig();
            rig.Store.ThrowOnRead = true;

            var result = await rig.Controller.QueueNodeRequest(Body());

            Assert.Equal(503, Assert.IsType<ObjectResult>(result).StatusCode);
            Assert.Empty(rig.Store.Blobs);
            Assert.Empty(rig.PioQueue.Messages);
        }

        [Fact]
        public async Task InvalidInput_IsRejectedBeforeAnyStorage()
        {
            var rig = NewRig();
            var body = Body();
            body.NodeId = "r:0;drop";
            Assert.IsType<BadRequestObjectResult>(await rig.Controller.QueueNodeRequest(body));
            Assert.Empty(rig.Store.Blobs);
        }

        [Theory]
        [InlineData("{\"engine\":{\"solver\":\"htsolver\",\"version\":\"1\"}}", "htsolver")]
        [InlineData("{\"engine\":{\"solver\":\"HtSolver\"}}", "htsolver")]
        [InlineData("{\"schema\":4,\"cfr\":{\"available\":true}}", null)]
        [InlineData("{\"engine\":\"htsolver\"}", null)]
        [InlineData("{\"engine\":{\"solver\":7}}", null)]
        [InlineData("not json", null)]
        [InlineData("[]", null)]
        public void ManifestSolver_ReadsOnlyEngineSolver(string manifest, string? expected)
        {
            Assert.Equal(expected, ManifestSolver.Parse(manifest));
        }
    }
}
