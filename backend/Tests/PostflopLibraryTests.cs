// Tests/PostflopLibraryTests.cs
using System;
using System.Linq;
using System.Security.Claims;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    /// <summary>
    /// The per-viewer solved-flops library: what the index overlay labels,
    /// what it hides, and the hide/unhide endpoints behind it. All DB-only -
    /// the overlay never touches ADLS, which is what lets it be tested here.
    /// </summary>
    public class PostflopLibraryTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static SolutionsController Controller(AppDbContext db, string uid)
        {
            var identity = new ClaimsIdentity(new[]
            {
                new Claim("user_id", uid),
                new Claim("sub", uid),
            }, authenticationType: "TestAuth");
            return new SolutionsController(db)
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
                },
            };
        }

        /// <summary>An index blob with one entry per (stacks, node, board) triple.</summary>
        private static string IndexJson(params (string stacks, string node, string board)[] entries) =>
            new JsonObject
            {
                ["schema"] = 3,
                ["entries"] = new JsonArray(entries.Select(e => (JsonNode)new JsonObject
                {
                    ["stacks"] = e.stacks,
                    ["node_name"] = e.node,
                    ["board"] = e.board,
                    ["flop_nodes"] = 12,
                    ["cfr_available"] = true,
                }).ToArray()),
            }.ToJsonString();

        private static SolveJob DoneHandSolve(
            string uid, string stacks, string node, string board, int? handHistoryId)
            => new()
            {
                Id = Guid.NewGuid(),
                UserId = uid,
                Type = SolveJobType.GameTree,
                BlobPath = $"gametrees/{node}.json",
                Folder = stacks,
                LineKey = "Call-Call",
                ActingPos = "BB",
                Board = board,
                HasSeatMeta = true,
                HandHistoryId = handHistoryId,
                Status = SolveJobStatus.Done,
                ResultStacks = stacks,
                ResultNodeName = node,
                CreatedAtUtc = DateTimeOffset.UtcNow,
            };

        private static JsonArray Entries(JsonNode index) => (JsonArray)index["entries"]!;

        private static string Str(JsonNode entry, string prop) =>
            entry[prop]?.GetValue<string>() ?? "";

        // ---------------- index overlay ----------------

        [Fact]
        public async Task Overlay_LabelsSimBoards()
        {
            using var db = NewDb();
            var json = IndexJson(("40-27.5", "node-a", "4hJh5s"));

            var index = await PostflopLibraryOverlay.ApplyAsync(db, "user-1", json);

            var entry = Assert.Single(Entries(index));
            Assert.Equal("sim", Str(entry!, "source"));
            Assert.Null(entry!["hand_history_id"]);
        }

        [Fact]
        public async Task Overlay_LabelsOwnHandHistoryBoard_WithItsHand()
        {
            using var db = NewDb();
            var job = DoneHandSolve("user-1", "750SB_2000BB", "node-a", "4hJh5s", handHistoryId: 42);
            db.SolveJobs.Add(job);
            await db.SaveChangesAsync();

            var index = await PostflopLibraryOverlay.ApplyAsync(
                db, "user-1", IndexJson(("750SB_2000BB", "node-a", "4hJh5s")));

            var entry = Assert.Single(Entries(index));
            Assert.Equal("handHistory", Str(entry!, "source"));
            Assert.Equal(42, entry!["hand_history_id"]!.GetValue<int>());
            Assert.Equal(job.Id.ToString(), Str(entry!, "solve_job_id"));
        }

        [Fact]
        public async Task Overlay_HidesOtherUsersHandHistoryBoards()
        {
            using var db = NewDb();
            db.SolveJobs.Add(DoneHandSolve("someone-else", "750SB_2000BB", "node-a", "4hJh5s", 7));
            await db.SaveChangesAsync();

            var index = await PostflopLibraryOverlay.ApplyAsync(
                db, "user-1",
                IndexJson(("750SB_2000BB", "node-a", "4hJh5s"), ("40-27.5", "node-b", "AsKdQc")));

            // Only the shared sim board survives - the other user's recorded
            // hand carries their names, stacks and hole cards.
            var entry = Assert.Single(Entries(index));
            Assert.Equal("node-b", Str(entry!, "node_name"));
        }

        [Fact]
        public async Task Overlay_KeepsHandHistoryBoardsWithNoJobRow_AsSim()
        {
            // Boards solved before the SolveJobs table existed have no row, so
            // there is no provenance to attach and nothing to filter on.
            using var db = NewDb();

            var index = await PostflopLibraryOverlay.ApplyAsync(
                db, "user-1", IndexJson(("750SB_2000BB", "legacy-node", "4hJh5s")));

            Assert.Equal("sim", Str(Assert.Single(Entries(index))!, "source"));
        }

        [Fact]
        public async Task Overlay_DropsBoardsTheViewerHid()
        {
            using var db = NewDb();
            db.HiddenSolutions.Add(new HiddenSolution
            {
                Id = Guid.NewGuid(),
                UserId = "user-1",
                Stacks = "40-27.5",
                NodeName = "node-a",
                Board = "4hJh5s",
                HiddenAtUtc = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();

            var json = IndexJson(("40-27.5", "node-a", "4hJh5s"), ("40-27.5", "node-b", "AsKdQc"));

            var mine = await PostflopLibraryOverlay.ApplyAsync(db, "user-1", json);
            Assert.Equal("node-b", Str(Assert.Single(Entries(mine))!, "node_name"));

            // Hiding is per viewer: nobody else's library changes.
            var theirs = await PostflopLibraryOverlay.ApplyAsync(db, "user-2", json);
            Assert.Equal(2, Entries(theirs).Count);
        }

        // ---------------- hide / unhide ----------------

        [Fact]
        public async Task Hide_IsIdempotent_AndUnhideRestores()
        {
            using var db = NewDb();
            var controller = Controller(db, "user-1");
            var body = new SolutionsController.SolutionRef
            {
                Stacks = "40-27.5",
                NodeName = "node-a",
                Board = "4hJh5s",
            };

            Assert.IsType<NoContentResult>(await controller.Hide(body));
            Assert.IsType<NoContentResult>(await controller.Hide(body));
            Assert.Single(db.HiddenSolutions.ToList());

            Assert.IsType<NoContentResult>(await controller.Unhide(body));
            Assert.Empty(db.HiddenSolutions.ToList());

            // Unhiding something that was never hidden is not an error.
            Assert.IsType<NoContentResult>(await controller.Unhide(body));
        }

        [Fact]
        public async Task Hide_RejectsIncompleteCoordinates()
        {
            using var db = NewDb();
            var controller = Controller(db, "user-1");

            var result = await controller.Hide(new SolutionsController.SolutionRef
            {
                Stacks = "40-27.5",
                NodeName = "",
                Board = "4hJh5s",
            });

            Assert.IsType<BadRequestObjectResult>(result);
            Assert.Empty(db.HiddenSolutions.ToList());
        }

        [Fact]
        public async Task Hide_IsScopedToTheCaller()
        {
            using var db = NewDb();
            var body = new SolutionsController.SolutionRef
            {
                Stacks = "40-27.5",
                NodeName = "node-a",
                Board = "4hJh5s",
            };

            await Controller(db, "user-1").Hide(body);
            await Controller(db, "user-2").Hide(body);

            Assert.Equal(2, db.HiddenSolutions.Count());

            await Controller(db, "user-1").Unhide(body);
            var left = Assert.Single(db.HiddenSolutions.ToList());
            Assert.Equal("user-2", left.UserId);
        }

        // ---------------- provenance on the job row ----------------

        [Fact]
        public async Task Submit_StoresHandHistoryId()
        {
            using var db = NewDb();
            var (job, _) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "user-1", "gametrees/x.json", "750SB_2000BB", "Call-Call", "BB",
                isIcm: false, board: "4hJh5s", hasSeatMeta: true, handHistoryId: 42);

            Assert.Equal(42, job.HandHistoryId);
            Assert.Equal(42, db.SolveJobs.Single().HandHistoryId);
        }

        [Fact]
        public async Task Submit_LeavesHandHistoryIdNull_ForSimUploads()
        {
            using var db = NewDb();
            var (job, _) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "user-1", "gametrees/x.json", "40-27.5", "Call-Call", "BB",
                isIcm: false, board: "4hJh5s", hasSeatMeta: false);

            Assert.Null(job.HandHistoryId);
        }
    }
}
