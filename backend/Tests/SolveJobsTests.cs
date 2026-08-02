// Tests/SolveJobsTests.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    // Exercises the SolveJobs queue against the real controller logic backed by
    // an EF Core in-memory database. The raw-SQL claim path (UPDLOCK/READPAST)
    // cannot run on InMemory; ClaimNextAsync's non-relational fallback covers
    // the same state machine, and the SQL path is verified by the live watcher
    // simulation (see the plan's verification steps).
    public class SolveJobsTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static IConfiguration Config(Dictionary<string, string?>? values = null) =>
            new ConfigurationBuilder().AddInMemoryCollection(values ?? new()).Build();

        private static SolveJobsController UserController(AppDbContext db, string uid)
        {
            var controller = new SolveJobsController(db);
            var identity = new ClaimsIdentity(new[]
            {
                new Claim("user_id", uid),
                new Claim("sub", uid),
            }, authenticationType: "TestAuth");
            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) },
            };
            return controller;
        }

        private static SolveJobsWatcherController WatcherController(
            AppDbContext db, int? timeoutSeconds = null, int? maxAttempts = null)
        {
            var values = new Dictionary<string, string?>();
            if (timeoutSeconds.HasValue)
                values["Watcher:ClaimTimeoutSeconds"] = timeoutSeconds.Value.ToString();
            if (maxAttempts.HasValue)
                values["Watcher:MaxAttempts"] = maxAttempts.Value.ToString();
            var controller = new SolveJobsWatcherController(db, Config(values));
            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            };
            return controller;
        }

        private static Task<(SolveJob job, bool deduped)> Submit(
            AppDbContext db,
            string uid = "user-1",
            string board = "4hJh5s",
            string folder = "40-27.5-25",
            string lineKey = "Call-Call",
            string actingPos = "BB",
            bool isIcm = false,
            bool hasSeatMeta = false,
            string blobPath = "gametrees/2026/08/02/u/x.json") =>
            GameTreesController.CreateOrDedupeJobAsync(
                db, uid, blobPath, folder, lineKey, actingPos, isIcm, board, hasSeatMeta);

        // ---------------- board parsing + submission ----------------

        [Fact]
        public void ParseBoard_MatchesWatcherPattern()
        {
            Assert.Equal("4hJh5s", GameTreesController.ParseBoard("stuff #Board#4h Jh 5s\nmore"));
            Assert.Null(GameTreesController.ParseBoard("no board marker here"));
            // Rank/suit outside the alphabet must not match.
            Assert.Null(GameTreesController.ParseBoard("#Board#1h Jh 5s"));
        }

        [Fact]
        public async Task Submit_CreatesQueuedJob()
        {
            using var db = NewDb();
            var (job, deduped) = await Submit(db);

            Assert.False(deduped);
            var stored = Assert.Single(db.SolveJobs.ToList());
            Assert.Equal(SolveJobStatus.Queued, stored.Status);
            Assert.Equal("4hJh5s", stored.Board);
            Assert.Equal(job.Id, stored.Id);
            Assert.Equal(0, stored.AttemptCount);
        }

        [Fact]
        public async Task Submit_DedupesIdenticalActiveSimJob_AcrossUsers()
        {
            using var db = NewDb();
            var (first, _) = await Submit(db, uid: "user-1");
            var (second, deduped) = await Submit(db, uid: "user-2");

            Assert.True(deduped);
            Assert.Equal(first.Id, second.Id);
            Assert.Single(db.SolveJobs.ToList());
        }

        [Fact]
        public async Task Submit_DoesNotDedupe_WhenSeatMetaPresent()
        {
            using var db = NewDb();
            await Submit(db, hasSeatMeta: true);
            var (_, deduped) = await Submit(db, hasSeatMeta: true);

            Assert.False(deduped);
            Assert.Equal(2, db.SolveJobs.Count());
        }

        [Fact]
        public async Task Submit_DoesNotDedupe_AgainstTerminalJob()
        {
            using var db = NewDb();
            var (first, _) = await Submit(db);
            first.Status = SolveJobStatus.Done;
            await db.SaveChangesAsync();

            var (second, deduped) = await Submit(db);

            Assert.False(deduped);
            Assert.NotEqual(first.Id, second.Id);
        }

        [Fact]
        public async Task Submit_DoesNotDedupe_DifferentBoard()
        {
            using var db = NewDb();
            await Submit(db, board: "4hJh5s");
            var (_, deduped) = await Submit(db, board: "AsKd2c");

            Assert.False(deduped);
            Assert.Equal(2, db.SolveJobs.Count());
        }

        // ---------------- user-facing status ----------------

        [Fact]
        public async Task GetJob_OwnerSeesDto_WithQueuePosition()
        {
            using var db = NewDb();
            var (first, _) = await Submit(db, board: "AsKd2c");
            var (second, _) = await Submit(db, board: "4hJh5s");

            var result = await UserController(db, "user-1").GetJob(second.Id);

            var ok = Assert.IsType<OkObjectResult>(result);
            var dto = Assert.IsType<SolveJobsController.SolveJobStatusResponse>(ok.Value);
            Assert.Equal(SolveJobStatus.Queued, dto.Status);
            Assert.Equal(2, dto.QueuePosition); // first submitted is ahead
            Assert.Equal(0, dto.ActiveAhead);
            Assert.Equal("4hJh5s", dto.Board);
            _ = first;
        }

        [Fact]
        public async Task GetJob_HigherPriorityJumpsTheLine()
        {
            using var db = NewDb();
            var (older, _) = await Submit(db, board: "AsKd2c");
            var (newer, _) = await Submit(db, board: "4hJh5s");
            newer.Priority = 10;
            await db.SaveChangesAsync();

            var olderDto = Assert.IsType<SolveJobsController.SolveJobStatusResponse>(
                Assert.IsType<OkObjectResult>(await UserController(db, "user-1").GetJob(older.Id)).Value);
            var newerDto = Assert.IsType<SolveJobsController.SolveJobStatusResponse>(
                Assert.IsType<OkObjectResult>(await UserController(db, "user-1").GetJob(newer.Id)).Value);

            Assert.Equal(1, newerDto.QueuePosition);
            Assert.Equal(2, olderDto.QueuePosition);
        }

        [Fact]
        public async Task GetJob_SimJob_VisibleToOtherUsers()
        {
            // Sim jobs dedupe across users, so the deduped submitter must be
            // able to poll a job they do not own.
            using var db = NewDb();
            var (job, _) = await Submit(db, uid: "user-1", hasSeatMeta: false);

            var result = await UserController(db, "user-2").GetJob(job.Id);

            Assert.IsType<OkObjectResult>(result);
        }

        [Fact]
        public async Task GetJob_SeatMetaJob_HiddenFromOtherUsers()
        {
            using var db = NewDb();
            var (job, _) = await Submit(db, uid: "user-1", hasSeatMeta: true);

            Assert.IsType<OkObjectResult>(await UserController(db, "user-1").GetJob(job.Id));
            Assert.IsType<NotFoundResult>(await UserController(db, "user-2").GetJob(job.Id));
        }

        [Fact]
        public async Task GetMyJobs_ScopedToCaller_NewestFirst()
        {
            using var db = NewDb();
            await Submit(db, uid: "user-1", board: "AsKd2c");
            await Submit(db, uid: "user-2", board: "4hJh5s");

            var ok = Assert.IsType<OkObjectResult>(await UserController(db, "user-1").GetMyJobs());
            var list = Assert.IsAssignableFrom<
                System.Collections.Generic.IEnumerable<SolveJobsController.SolveJobStatusResponse>>(ok.Value).ToList();

            var dto = Assert.Single(list);
            Assert.Equal("AsKd2c", dto.Board);
        }

        // ---------------- claim ----------------

        [Fact]
        public async Task Claim_EmptyQueue_Returns204()
        {
            using var db = NewDb();
            var result = await WatcherController(db).Claim(new SolveJobClaimRequest { WatcherId = "w1" });
            Assert.IsType<NoContentResult>(result);
        }

        [Fact]
        public async Task Claim_TakesOldestQueuedJob_AndMarksIt()
        {
            using var db = NewDb();
            var (first, _) = await Submit(db, board: "AsKd2c");
            await Submit(db, board: "4hJh5s");

            var result = await WatcherController(db).Claim(new SolveJobClaimRequest { WatcherId = "w1" });

            Assert.IsType<OkObjectResult>(result);
            var claimed = db.SolveJobs.Single(j => j.Id == first.Id);
            Assert.Equal(SolveJobStatus.Claimed, claimed.Status);
            Assert.Equal("w1", claimed.WatcherId);
            Assert.Equal(1, claimed.AttemptCount);
            Assert.NotNull(claimed.ClaimedAtUtc);
            Assert.NotNull(claimed.LastHeartbeatUtc);
        }

        // ---------------- report / transitions ----------------

        private static async Task<SolveJob> ClaimedJob(AppDbContext db, string watcherId = "w1")
        {
            var (job, _) = await Submit(db);
            await WatcherController(db).Claim(new SolveJobClaimRequest { WatcherId = watcherId });
            return db.SolveJobs.Single(j => j.Id == job.Id);
        }

        [Fact]
        public async Task Report_FullChain_Accepted()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            var watcher = WatcherController(db);

            foreach (var status in new[]
            {
                SolveJobStatus.Solving,
                SolveJobStatus.Extracting,
                SolveJobStatus.Uploading,
                SolveJobStatus.Done,
            })
            {
                var result = await watcher.Report(job.Id, new SolveJobReportRequest
                {
                    WatcherId = "w1",
                    Status = status,
                });
                Assert.IsType<OkObjectResult>(result);
            }

            var final = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Done, final.Status);
            Assert.NotNull(final.CompletedAtUtc);
        }

        [Fact]
        public async Task Report_SkippingAStage_Rejected()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);

            var result = await WatcherController(db).Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Status = SolveJobStatus.Extracting, // skips Solving
            });

            Assert.IsType<ConflictObjectResult>(result);
            Assert.Equal(SolveJobStatus.Claimed, db.SolveJobs.Single(j => j.Id == job.Id).Status);
        }

        [Fact]
        public async Task Report_BackwardsTransition_Rejected()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            var watcher = WatcherController(db);
            await watcher.Report(job.Id, new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Solving });

            var result = await watcher.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Status = SolveJobStatus.Claimed,
            });

            Assert.IsType<ConflictObjectResult>(result);
        }

        [Fact]
        public async Task Report_WrongWatcherId_Gets409()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db, watcherId: "w1");

            var result = await WatcherController(db).Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w2",
                Status = SolveJobStatus.Solving,
            });

            Assert.IsType<ConflictObjectResult>(result);
        }

        [Fact]
        public async Task Report_TerminalJob_Gets409()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            job.Status = SolveJobStatus.Done;
            await db.SaveChangesAsync();

            var result = await WatcherController(db).Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Heartbeat = true,
            });

            Assert.IsType<ConflictObjectResult>(result);
        }

        [Fact]
        public async Task Report_UnknownJob_Gets404()
        {
            using var db = NewDb();
            var result = await WatcherController(db).Report(Guid.NewGuid(), new SolveJobReportRequest
            {
                WatcherId = "w1",
                Heartbeat = true,
            });
            Assert.IsType<NotFoundResult>(result);
        }

        [Fact]
        public async Task Report_Heartbeat_BumpsTimestamp_WithoutStatusChange()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            var before = job.LastHeartbeatUtc;
            await Task.Delay(10);

            var result = await WatcherController(db).Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Heartbeat = true,
            });

            Assert.IsType<OkObjectResult>(result);
            var after = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Claimed, after.Status);
            Assert.True(after.LastHeartbeatUtc > before);
        }

        [Fact]
        public async Task Report_Failed_StoresErrorAndCompletes()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            var watcher = WatcherController(db);
            await watcher.Report(job.Id, new SolveJobReportRequest { WatcherId = "w1", Status = SolveJobStatus.Solving });

            var result = await watcher.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Status = SolveJobStatus.Failed,
                Error = "PioViewer window not found",
            });

            Assert.IsType<OkObjectResult>(result);
            var failed = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Failed, failed.Status);
            Assert.Equal("PioViewer window not found", failed.Error);
            Assert.NotNull(failed.CompletedAtUtc);
        }

        [Fact]
        public async Task Report_Done_StoresResultCoordinates()
        {
            using var db = NewDb();
            var job = await ClaimedJob(db);
            var watcher = WatcherController(db);
            foreach (var status in new[] { SolveJobStatus.Solving, SolveJobStatus.Extracting, SolveJobStatus.Uploading })
                await watcher.Report(job.Id, new SolveJobReportRequest { WatcherId = "w1", Status = status });

            await watcher.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Status = SolveJobStatus.Done,
                ResultStacks = "40-27.5-25",
                ResultNodeName = "line_Call-Call_pos=BB_icm=0",
                Board = "4hJh5s",
            });

            var done = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal("40-27.5-25", done.ResultStacks);
            Assert.Equal("line_Call-Call_pos=BB_icm=0", done.ResultNodeName);
        }

        // ---------------- stale-claim requeue ----------------

        [Fact]
        public async Task StaleClaim_RequeuedOnNextClaim_ThenFailedAfterMaxAttempts()
        {
            using var db = NewDb();
            var (job, _) = await Submit(db);
            var watcher = WatcherController(db, timeoutSeconds: 300, maxAttempts: 2);

            // First claim, then the watcher "crashes": age the heartbeat.
            await watcher.Claim(new SolveJobClaimRequest { WatcherId = "w1" });
            var row = db.SolveJobs.Single(j => j.Id == job.Id);
            row.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-10);
            await db.SaveChangesAsync();

            // Next claim sweeps the stale row back to Queued and re-claims it.
            var second = await watcher.Claim(new SolveJobClaimRequest { WatcherId = "w2" });
            Assert.IsType<OkObjectResult>(second);
            row = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Claimed, row.Status);
            Assert.Equal("w2", row.WatcherId);
            Assert.Equal(2, row.AttemptCount);

            // Crash again: attempts are used up, so the sweep fails the job.
            row.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-10);
            await db.SaveChangesAsync();
            var third = await watcher.Claim(new SolveJobClaimRequest { WatcherId = "w3" });
            Assert.IsType<NoContentResult>(third);
            row = db.SolveJobs.Single(j => j.Id == job.Id);
            Assert.Equal(SolveJobStatus.Failed, row.Status);
            Assert.Equal("watcher timed out", row.Error);
            Assert.NotNull(row.CompletedAtUtc);
        }

        [Fact]
        public async Task StaleClaim_LateReportFromCrashedWatcher_Rejected()
        {
            using var db = NewDb();
            var (job, _) = await Submit(db);
            var watcher = WatcherController(db);

            await watcher.Claim(new SolveJobClaimRequest { WatcherId = "w1" });
            var row = db.SolveJobs.Single(j => j.Id == job.Id);
            row.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-10);
            await db.SaveChangesAsync();

            // Requeued and reclaimed by w2...
            await watcher.Claim(new SolveJobClaimRequest { WatcherId = "w2" });

            // ...so w1's late report must bounce.
            var result = await watcher.Report(job.Id, new SolveJobReportRequest
            {
                WatcherId = "w1",
                Status = SolveJobStatus.Solving,
            });
            Assert.IsType<ConflictObjectResult>(result);
        }
    }
}
