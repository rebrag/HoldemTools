// Tests/SolveJobRoutingTests.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    /// <summary>
    /// One SolveJobs queue routed by solver: upload-time selection, the two
    /// claim routes, per-solver dedupe and queue position, coordinates at
    /// insert, idempotent Done, the index entry on reports, and re-route.
    /// </summary>
    public class SolveJobRoutingTests
    {
        private const string AdminEmail = "admin@example.com";

        private static AppDbContext NewDb() =>
            new(new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString()).Options);

        private static IConfiguration Config(string? handHistory = null, string? sim = null)
        {
            var values = new Dictionary<string, string?> { ["Admin:Emails:0"] = AdminEmail };
            if (handHistory != null) values["Solve:Solver:HandHistory"] = handHistory;
            if (sim != null) values["Solve:Solver:Sim"] = sim;
            return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        }

        private static ControllerContext Context(string uid, string? email = null)
        {
            var claims = new List<Claim> { new("user_id", uid), new("sub", uid) };
            if (email != null) claims.Add(new Claim("email", email));
            return new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth")),
                },
            };
        }

        private static GameTreesController Uploader(
            AppDbContext db, IConfiguration config, FakeGameTreeBlobStore blobs,
            string uid = "user-1", bool admin = false) =>
            new(config, db, blobs) { ControllerContext = Context(uid, admin ? AdminEmail : null) };

        private static SolveJobsWatcherController Watcher(AppDbContext db, IEngineSolutionsIndex? index = null) =>
            new(db, Config(), index ?? EngineIndexFactory.New())
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
            };

        private static SolveJobsController Status(AppDbContext db, string uid = "user-1", bool admin = false) =>
            new(db, Config()) { ControllerContext = Context(uid, admin ? AdminEmail : null) };

        private const string TreeText = "#Board#Qh Jh Th\n#Pot#81\n#EffectiveStacks#583";

        private static GameTreeUploadRequest Upload(
            bool handHistory = false, bool icm = false, JsonNode? tree = null, string? solver = null,
            string folder = "40-27.5-25") => new()
        {
            Folder = folder,
            Line = new[] { "Call", "Call" },
            ActingPos = "BB",
            IsICM = icm,
            Text = TreeText,
            AlivePositions = new[] { "SB", "BTN" },
            Seats = handHistory
                ? new List<SeatMetaDto> { new() { Pos = "SB", Name = "Alice", StackChips = 58300, Hero = true } }
                : null,
            EngineTree = tree == null ? null : JsonDocument.Parse(tree.ToJsonString()).RootElement,
            Solver = solver,
        };

        private static JsonObject ValidTree() => EngineTreeValidatorTests.ValidTree();

        private static async Task<(IActionResult result, SolveJob? job)> Post(
            AppDbContext db, IConfiguration config, GameTreeUploadRequest req,
            bool admin = false, FakeGameTreeBlobStore? blobs = null, string uid = "user-1")
        {
            var result = await Uploader(db, config, blobs ?? new FakeGameTreeBlobStore(), uid, admin)
                .UploadGameTree(req);
            if (result is not OkObjectResult ok) return (result, null);
            var jobId = (Guid)ok.Value!.GetType().GetProperty("jobId")!.GetValue(ok.Value)!;
            return (result, db.SolveJobs.Single(j => j.Id == jobId));
        }

        private static string ResponseSolver(IActionResult result) =>
            (string)((OkObjectResult)result).Value!.GetType().GetProperty("solver")!.GetValue(((OkObjectResult)result).Value)!;

        // ---------------- solver selection at upload ----------------

        [Theory]
        [InlineData(true, false)]
        [InlineData(true, true)]
        [InlineData(false, false)]
        [InlineData(false, true)]
        public async Task DefaultConfig_IsAlwaysPio(bool handHistory, bool withTree)
        {
            using var db = NewDb();
            var (result, job) = await Post(db, Config(), Upload(handHistory, tree: withTree ? ValidTree() : null));

            Assert.Equal(SolveJobSolver.Pio, job!.Solver);
            Assert.Equal(SolveJobSolver.Pio, ResponseSolver(result));
            Assert.Equal(withTree, job.HasEngineTree);
        }

        [Fact]
        public async Task HtSolverConfig_ValidTree_NonIcm_RoutesNonAdminToHtSolver()
        {
            using var db = NewDb();
            var blobs = new FakeGameTreeBlobStore();
            var (result, job) = await Post(db, Config(handHistory: "htsolver"),
                Upload(handHistory: true, tree: ValidTree()), admin: false, blobs: blobs);

            Assert.Equal(SolveJobSolver.HtSolver, job!.Solver);
            Assert.Equal(SolveJobSolver.HtSolver, ResponseSolver(result));
            Assert.True(job.HasEngineTree);

            // The blob records the route and the REBUILT tree.
            var payload = JsonNode.Parse(Assert.Single(blobs.Uploads).Bytes)!;
            Assert.Equal("htsolver", payload["Solver"]!.GetValue<string>());
            Assert.Equal(ValidTree().ToJsonString(), payload["EngineTree"]!.ToJsonString());
        }

        [Fact]
        public async Task HtSolverConfig_IsPerUploadKind()
        {
            using var db = NewDb();
            var config = Config(handHistory: "htsolver"); // Sim left at pio
            var (_, sim) = await Post(db, config, Upload(handHistory: false, tree: ValidTree()));
            Assert.Equal(SolveJobSolver.Pio, sim!.Solver);

            var (_, simHt) = await Post(db, Config(sim: "htsolver"), Upload(handHistory: false, tree: ValidTree()));
            Assert.Equal(SolveJobSolver.HtSolver, simHt!.Solver);
        }

        [Fact]
        public async Task HtSolverConfig_WithoutTree_FallsBackToPio()
        {
            using var db = NewDb();
            var (_, job) = await Post(db, Config(handHistory: "htsolver"), Upload(handHistory: true));
            Assert.Equal(SolveJobSolver.Pio, job!.Solver);
            Assert.False(job.HasEngineTree);
        }

        [Fact]
        public async Task Icm_IsAlwaysPio_EvenForAnAdminOverride()
        {
            using var db = NewDb();
            var (_, byConfig) = await Post(db, Config(handHistory: "htsolver"),
                Upload(handHistory: true, icm: true, tree: ValidTree()));
            Assert.Equal(SolveJobSolver.Pio, byConfig!.Solver);

            var (_, byAdmin) = await Post(db, Config(),
                Upload(handHistory: true, icm: true, tree: ValidTree(), solver: "htsolver"), admin: true);
            Assert.Equal(SolveJobSolver.Pio, byAdmin!.Solver);
        }

        [Fact]
        public async Task AdminOverride_Works_BothWays()
        {
            using var db = NewDb();
            var (_, toHt) = await Post(db, Config(),
                Upload(handHistory: true, tree: ValidTree(), solver: "htsolver"), admin: true);
            Assert.Equal(SolveJobSolver.HtSolver, toHt!.Solver);

            var (_, toPio) = await Post(db, Config(handHistory: "htsolver"),
                Upload(handHistory: true, tree: ValidTree(), solver: "pio"), admin: true);
            Assert.Equal(SolveJobSolver.Pio, toPio!.Solver);
        }

        [Fact]
        public async Task NonAdminOverride_IsIgnored()
        {
            using var db = NewDb();
            var (_, job) = await Post(db, Config(),
                Upload(handHistory: true, tree: ValidTree(), solver: "htsolver"), admin: false);
            Assert.Equal(SolveJobSolver.Pio, job!.Solver);

            var (_, kept) = await Post(db, Config(handHistory: "htsolver"),
                Upload(handHistory: true, tree: ValidTree(), solver: "pio"), admin: false);
            Assert.Equal(SolveJobSolver.HtSolver, kept!.Solver);
        }

        [Fact]
        public async Task InvalidTree_Is400_OnlyOnTheHtSolverRoute()
        {
            var bad = ValidTree();
            bad["board"] = "As Kd Qc"; // disagrees with the text's #Board#

            using var db = NewDb();
            var blobs = new FakeGameTreeBlobStore();
            var (rejected, _) = await Post(db, Config(handHistory: "htsolver"),
                Upload(handHistory: true, tree: bad), blobs: blobs);
            Assert.IsType<BadRequestObjectResult>(rejected);
            Assert.Empty(blobs.Uploads);          // nothing written for a rejected upload
            Assert.Empty(db.SolveJobs.ToList());

            // On the Pio route the bad tree is dropped and the upload proceeds.
            var (accepted, job) = await Post(db, Config(), Upload(handHistory: true, tree: bad), blobs: blobs);
            Assert.IsType<OkObjectResult>(accepted);
            Assert.Equal(SolveJobSolver.Pio, job!.Solver);
            Assert.False(job.HasEngineTree);
            var payload = JsonNode.Parse(Assert.Single(blobs.Uploads).Bytes)!;
            Assert.Null(payload["EngineTree"]);
            Assert.Equal("pio", payload["Solver"]!.GetValue<string>());
        }

        [Fact]
        public void ChooseSolver_UnknownConfigValue_IsPio()
        {
            var config = Config(handHistory: "gpu-solver");
            var routing = GameTreesController.ChooseSolver(config, hasSeatMeta: true, isIcm: false,
                engineTreePresent: true, engineTreeValid: true, requestedSolver: null, isAdmin: false);
            Assert.Equal(SolveJobSolver.Pio, routing.Solver);
        }

        // ---------------- coordinates at insert ----------------

        [Fact]
        public async Task CoordinatesAtInsert_MatchWhatTheWatcherReports()
        {
            using var db = NewDb();
            var blobs = new FakeGameTreeBlobStore();
            var (_, job) = await Post(db, Config(), Upload(handHistory: true, folder: "750SB_2000BB"), blobs: blobs);

            // parse_gametree_path: stacks = the folder= segment, node_name =
            // the file stem.
            var path = Assert.Single(blobs.Uploads).Path;
            Assert.Equal(job!.BlobPath, path);
            var parts = path.Split('/');
            Assert.Equal("750SB_2000BB", job.ResultStacks);
            Assert.Equal($"folder={job.ResultStacks}", parts[^2]);
            Assert.Equal(parts[^1][..^".json".Length], job.ResultNodeName);
            Assert.Matches(@"^\d{6}_line=Call-Call_pos=BB_icm=0$", job.ResultNodeName);
            Assert.Equal(SolveJobStatus.Queued, job.Status); // coordinates do not mean solved
        }

        [Theory]
        [InlineData("gametrees/2026/11/16/uid/folder=40-27.5-25/101500_line=Call_pos=BB_icm=0.json",
                    "40-27.5-25", "101500_line=Call_pos=BB_icm=0")]
        [InlineData("gametrees/2026/11/16/uid/x.json", "nostacks", "x")]
        [InlineData("gametrees/2026/11/16/uid/folder=a/folder=b/n.json", "a", "n")]
        [InlineData("gametrees/folder=s/", "s", "nonode")]
        public void GameTreeCoordinates_MirrorParseGametreePath(string path, string stacks, string node)
        {
            Assert.Equal((stacks, node), GameTreeCoordinates.FromBlobPath(path));
        }

        // ---------------- dedupe per solver ----------------

        [Fact]
        public async Task Dedupe_IsPerSolver()
        {
            using var db = NewDb();
            var (pio, _) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "u1", "gametrees/a.json", "40", "Call", "BB", false, "QhJhTh", false,
                solver: SolveJobSolver.Pio);
            var (ht, htDeduped) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "u2", "gametrees/b.json", "40", "Call", "BB", false, "QhJhTh", false,
                solver: SolveJobSolver.HtSolver);
            var (ht2, ht2Deduped) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "u3", "gametrees/c.json", "40", "Call", "BB", false, "QhJhTh", false,
                solver: SolveJobSolver.HtSolver);

            Assert.False(htDeduped);
            Assert.NotEqual(pio.Id, ht.Id);
            Assert.True(ht2Deduped);
            Assert.Equal(ht.Id, ht2.Id);
        }

        // ---------------- claim routing ----------------

        private static async Task<SolveJob> Queue(AppDbContext db, string solver, string board, int priority = 0)
        {
            var (job, _) = await GameTreesController.CreateOrDedupeJobAsync(
                db, "user-1", $"gametrees/u/folder=40/{board}.json", "40", "Call", "BB", false, board,
                hasSeatMeta: true, solver: solver, hasEngineTree: true);
            job.Priority = priority;
            await db.SaveChangesAsync();
            return job;
        }

        private static string? ClaimedSolver(IActionResult result) =>
            result is OkObjectResult ok
                ? (string)ok.Value!.GetType().GetProperty("solver")!.GetValue(ok.Value)!
                : null;

        [Fact]
        public async Task PioClaim_NeverReturnsAnHtSolverJob()
        {
            using var db = NewDb();
            // The htsolver job is older AND higher priority: it would win
            // any unfiltered claim.
            await Queue(db, SolveJobSolver.HtSolver, "QhJhTh", priority: 10);
            var pio = await Queue(db, SolveJobSolver.Pio, "AsKdQc");

            var first = await Watcher(db).Claim(new SolveJobClaimRequest { WatcherId = "pio-box" });
            Assert.Equal(SolveJobSolver.Pio, ClaimedSolver(first));
            Assert.Equal(SolveJobStatus.Claimed, db.SolveJobs.Single(j => j.Id == pio.Id).Status);

            Assert.IsType<NoContentResult>(
                await Watcher(db).Claim(new SolveJobClaimRequest { WatcherId = "pio-box" }));
            Assert.Equal(SolveJobStatus.Queued,
                db.SolveJobs.Single(j => j.Solver == SolveJobSolver.HtSolver).Status);
        }

        [Fact]
        public async Task HtSolverClaim_NeverReturnsAPioJob()
        {
            using var db = NewDb();
            await Queue(db, SolveJobSolver.Pio, "AsKdQc", priority: 10);
            var ht = await Queue(db, SolveJobSolver.HtSolver, "QhJhTh");

            var first = await Watcher(db).ClaimHtSolver(new SolveJobClaimRequest { WatcherId = "m13001" });
            Assert.Equal(SolveJobSolver.HtSolver, ClaimedSolver(first));
            Assert.Equal("m13001", db.SolveJobs.Single(j => j.Id == ht.Id).WatcherId);

            Assert.IsType<NoContentResult>(
                await Watcher(db).ClaimHtSolver(new SolveJobClaimRequest { WatcherId = "m13001" }));
            Assert.Equal(SolveJobStatus.Queued, db.SolveJobs.Single(j => j.Solver == SolveJobSolver.Pio).Status);
        }

        [Fact]
        public async Task StaleHtSolverClaim_GoesBackToTheHtSolverQueue()
        {
            using var db = NewDb();
            var ht = await Queue(db, SolveJobSolver.HtSolver, "QhJhTh");
            await Watcher(db).ClaimHtSolver(new SolveJobClaimRequest { WatcherId = "m13001" });
            db.SolveJobs.Single(j => j.Id == ht.Id).LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-10);
            await db.SaveChangesAsync();

            // A Pio claim runs the sweep but must not pick the requeued job up.
            Assert.IsType<NoContentResult>(await Watcher(db).Claim(new SolveJobClaimRequest { WatcherId = "pio" }));
            var row = db.SolveJobs.Single(j => j.Id == ht.Id);
            Assert.Equal(SolveJobStatus.Queued, row.Status);
            Assert.Equal(SolveJobSolver.HtSolver, row.Solver);
        }

        // ---------------- reports ----------------

        private static async Task<SolveJob> WalkToUploading(AppDbContext db, SolveJobsWatcherController w,
                                                            string solver, string watcherId)
        {
            var job = await Queue(db, solver, "QhJhTh");
            if (solver == SolveJobSolver.HtSolver)
                await w.ClaimHtSolver(new SolveJobClaimRequest { WatcherId = watcherId });
            else
                await w.Claim(new SolveJobClaimRequest { WatcherId = watcherId });
            foreach (var s in new[] { SolveJobStatus.Solving, SolveJobStatus.Extracting, SolveJobStatus.Uploading })
                Assert.IsType<OkObjectResult>(await w.Report(job.Id,
                    new SolveJobReportRequest { WatcherId = watcherId, Status = s }));
            return job;
        }

        [Fact]
        public async Task RepeatedDone_FromTheOwner_Is200_WithNoStateChange()
        {
            using var db = NewDb();
            var w = Watcher(db);
            var job = await WalkToUploading(db, w, SolveJobSolver.HtSolver, "m13001");

            Assert.IsType<OkObjectResult>(await w.Report(job.Id,
                new SolveJobReportRequest { WatcherId = "m13001", Status = SolveJobStatus.Done }));
            var completed = db.SolveJobs.Single(j => j.Id == job.Id).CompletedAtUtc;
            var heartbeat = db.SolveJobs.Single(j => j.Id == job.Id).LastHeartbeatUtc;
            await Task.Delay(5);

            Assert.IsType<OkObjectResult>(await w.Report(job.Id,
                new SolveJobReportRequest { WatcherId = "m13001", Status = SolveJobStatus.Done, Error = "x" }));
            var row = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Done, row.Status);
            Assert.Equal(completed, row.CompletedAtUtc);
            Assert.Equal(heartbeat, row.LastHeartbeatUtc);
            Assert.Null(row.Error);
        }

        [Fact]
        public async Task TerminalRules_OtherwiseUnchanged()
        {
            using var db = NewDb();
            var w = Watcher(db);
            var job = await WalkToUploading(db, w, SolveJobSolver.Pio, "w1");
            await w.Report(job.Id, new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Done });

            // Done from another watcher, Failed after Done, a heartbeat after Done: all 409.
            Assert.IsType<ConflictObjectResult>(await w.Report(job.Id,
                new SolveJobReportRequest { WatcherId = "w2", Status = SolveJobStatus.Done }));
            Assert.IsType<ConflictObjectResult>(await w.Report(job.Id,
                new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Failed }));
            Assert.IsType<ConflictObjectResult>(await w.Report(job.Id,
                new SolveJobReportRequest { WatcherId = "w1", Heartbeat = true }));

            // A Failed job stays 409 even for a Done from its owner.
            var failed = await WalkToUploading(db, w, SolveJobSolver.Pio, "w1");
            await w.Report(failed.Id, new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Failed });
            Assert.IsType<ConflictObjectResult>(await w.Report(failed.Id,
                new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Done }));
        }

        private static JsonElement Entry(string stacks = "elsewhere", string node = "other", string board = "AsKdQc") =>
            JsonDocument.Parse(new JsonObject
            {
                ["stacks"] = stacks,
                ["node_name"] = node,
                ["board"] = board,
                ["preflop_line"] = new JsonArray("Root", "Call"),
                ["alive_positions"] = new JsonArray("SB", "BTN"),
                ["icm"] = false,
                ["created_utc"] = "2026-11-16T10:00:00+00:00",
                ["flop_nodes"] = 8,
                ["turn_streets"] = 196,
                ["cfr_available"] = true,
                ["solver"] = "pio",
                ["hand_history_id"] = 99,          // not whitelisted
                ["owner"] = "someone-else",        // not whitelisted
            }.ToJsonString()).RootElement;

        [Fact]
        public async Task IndexEntry_OnAnHtSolverReport_IsUpserted_WithTheJobsOwnCoordinates()
        {
            using var db = NewDb();
            var store = new InMemoryEngineIndexBlobStore();
            var w = Watcher(db, EngineIndexFactory.New(store));
            var job = await WalkToUploading(db, w, SolveJobSolver.HtSolver, "m13001");

            Assert.IsType<OkObjectResult>(await w.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "m13001",
                Status = SolveJobStatus.Done,
                IndexEntry = Entry(),
                // An attempt to move the job's coordinates is ignored too.
                ResultStacks = "elsewhere",
                ResultNodeName = "other",
                Board = "AsKdQc",
            }));

            var entry = Assert.Single(store.Entries())!.AsObject();
            Assert.Equal(job.ResultStacks, entry["stacks"]!.GetValue<string>());
            Assert.Equal(job.ResultNodeName, entry["node_name"]!.GetValue<string>());
            Assert.Equal("QhJhTh", entry["board"]!.GetValue<string>());
            Assert.Equal("htsolver", entry["solver"]!.GetValue<string>());
            Assert.Equal(196, entry["turn_streets"]!.GetValue<int>());
            Assert.False(entry.ContainsKey("hand_history_id"));
            Assert.False(entry.ContainsKey("owner"));

            var row = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal("QhJhTh", row.Board);
            Assert.NotEqual("elsewhere", row.ResultStacks);
        }

        [Fact]
        public async Task IndexEntry_OnAPioReport_IsIgnored()
        {
            using var db = NewDb();
            var store = new InMemoryEngineIndexBlobStore();
            var w = Watcher(db, EngineIndexFactory.New(store));
            var job = await WalkToUploading(db, w, SolveJobSolver.Pio, "w1");

            Assert.IsType<OkObjectResult>(await w.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1", Status = SolveJobStatus.Done, IndexEntry = Entry(),
            }));
            Assert.Null(store.Json);
        }

        [Fact]
        public async Task IndexEntry_OnARepeatedDone_IsStillUpserted()
        {
            // The worker retries Done when it lost the response; the retry
            // must still land the entry if the first write is what was lost.
            using var db = NewDb();
            var store = new InMemoryEngineIndexBlobStore();
            var w = Watcher(db, EngineIndexFactory.New(store));
            var job = await WalkToUploading(db, w, SolveJobSolver.HtSolver, "m13001");
            await w.Report(job.Id, new SolveJobReportRequest { WatcherId = "m13001", Status = SolveJobStatus.Done });
            Assert.Null(store.Json);

            Assert.IsType<OkObjectResult>(await w.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "m13001", Status = SolveJobStatus.Done, IndexEntry = Entry(),
            }));
            Assert.Single(store.Entries());
        }

        private sealed class AlwaysConflictingIndex : IEngineSolutionsIndex
        {
            public Task UpsertAsync(JsonObject entry, System.Threading.CancellationToken ct) =>
                throw new EngineIndexConflictException("contended");
        }

        [Fact]
        public async Task IndexWriteFailure_Is503_AndLeavesTheJobWhereItWas()
        {
            using var db = NewDb();
            var w = Watcher(db, new AlwaysConflictingIndex());
            var job = await WalkToUploading(db, w, SolveJobSolver.HtSolver, "m13001");

            var result = await w.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "m13001", Status = SolveJobStatus.Done, IndexEntry = Entry(),
            });
            Assert.Equal(503, Assert.IsType<ObjectResult>(result).StatusCode);
            Assert.Equal(SolveJobStatus.Uploading, db.SolveJobs.Single(j => j.Id == job.Id).Status);
        }

        // ---------------- user-facing status ----------------

        [Fact]
        public async Task QueuePosition_AndActiveAhead_CountOnlyTheSameSolver()
        {
            using var db = NewDb();
            await Queue(db, SolveJobSolver.Pio, "AsKdQc");
            await Queue(db, SolveJobSolver.Pio, "2c3d4h");
            var activePio = await Queue(db, SolveJobSolver.Pio, "5c6d7h");
            activePio.Status = SolveJobStatus.Solving;
            activePio.LastHeartbeatUtc = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            var ht = await Queue(db, SolveJobSolver.HtSolver, "QhJhTh");

            var dto = Assert.IsType<SolveJobsController.SolveJobStatusResponse>(
                Assert.IsType<OkObjectResult>(await Status(db).GetJob(ht.Id)).Value);
            Assert.Equal(1, dto.QueuePosition);
            Assert.Equal(0, dto.ActiveAhead);
            Assert.Equal(SolveJobSolver.HtSolver, dto.Solver);

            var pioJob = db.SolveJobs.Single(j => j.Board == "2c3d4h");
            var pioDto = Assert.IsType<SolveJobsController.SolveJobStatusResponse>(
                Assert.IsType<OkObjectResult>(await Status(db).GetJob(pioJob.Id)).Value);
            Assert.Equal(2, pioDto.QueuePosition);
            Assert.Equal(1, pioDto.ActiveAhead);
            Assert.Equal(SolveJobSolver.Pio, pioDto.Solver);
        }

        // ---------------- re-route ----------------

        [Fact]
        public async Task Reroute_IsAdminOnly()
        {
            using var db = NewDb();
            await Queue(db, SolveJobSolver.Pio, "QhJhTh");
            var result = await Status(db, admin: false).Reroute(
                new SolveJobsController.RerouteRequest { From = "pio", To = "htsolver" });
            Assert.IsType<ForbidResult>(result);
            Assert.Equal(SolveJobSolver.Pio, db.SolveJobs.Single().Solver);
        }

        [Fact]
        public async Task Reroute_MovesOnlyQueuedEligibleJobs()
        {
            using var db = NewDb();
            var eligible = await Queue(db, SolveJobSolver.Pio, "QhJhTh");
            var noTree = await Queue(db, SolveJobSolver.Pio, "AsKdQc");
            noTree.HasEngineTree = false;
            var icm = await Queue(db, SolveJobSolver.Pio, "2c3d4h");
            icm.IsIcm = true;
            var running = await Queue(db, SolveJobSolver.Pio, "5c6d7h");
            running.Status = SolveJobStatus.Solving;
            await db.SaveChangesAsync();

            var ok = Assert.IsType<OkObjectResult>(await Status(db, admin: true).Reroute(
                new SolveJobsController.RerouteRequest { From = "pio", To = "htsolver" }));
            var body = Assert.IsType<SolveJobsController.RerouteResponse>(ok.Value);
            Assert.Equal(1, body.Moved);
            Assert.Equal(2, body.Skipped);

            Assert.Equal(SolveJobSolver.HtSolver, db.SolveJobs.Single(j => j.Id == eligible.Id).Solver);
            Assert.Equal(SolveJobSolver.Pio, db.SolveJobs.Single(j => j.Id == noTree.Id).Solver);
            Assert.Equal(SolveJobSolver.Pio, db.SolveJobs.Single(j => j.Id == icm.Id).Solver);
            Assert.Equal(SolveJobSolver.Pio, db.SolveJobs.Single(j => j.Id == running.Id).Solver);

            // Back to Pio needs no engine tree.
            var back = Assert.IsType<SolveJobsController.RerouteResponse>(
                Assert.IsType<OkObjectResult>(await Status(db, admin: true).Reroute(
                    new SolveJobsController.RerouteRequest { From = "htsolver", To = "pio" })).Value);
            Assert.Equal(1, back.Moved);
            Assert.Equal(0, back.Skipped);
        }

        [Theory]
        [InlineData("pio", "pio")]
        [InlineData("pio", "gpu")]
        [InlineData(null, "pio")]
        public async Task Reroute_RejectsBadArguments(string? from, string? to)
        {
            using var db = NewDb();
            Assert.IsType<BadRequestObjectResult>(await Status(db, admin: true).Reroute(
                new SolveJobsController.RerouteRequest { From = from, To = to }));
        }
    }
}
