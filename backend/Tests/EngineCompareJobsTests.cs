using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using Xunit;

namespace HoldemToolsAPI.Tests;

public class EngineCompareJobsTests
{
    private const string AdminEmail = "admin@example.com";

    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString()).Options);

    private static IConfiguration Config() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Admin:Emails:0"] = AdminEmail,
            ["Watcher:ClaimTimeoutSeconds"] = "300",
            ["Watcher:MaxAttempts"] = "2",
        }).Build();

    private static EngineCompareController UserController(AppDbContext db, string uid,
                                                          string? email = null)
    {
        var claims = new List<Claim> { new("user_id", uid), new("sub", uid) };
        if (email != null) claims.Add(new Claim("email", email));
        var controller = new EngineCompareController(db, Config())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth")),
                },
            },
        };
        return controller;
    }

    private static EngineCompareWatcherController WatcherController(AppDbContext db) =>
        new(db, Config());

    private static JsonObject SpotConfig() => new()
    {
        ["schema"] = 1,
        ["game"] = "nlhe",
        ["board"] = "9c 5d Jc 7s 9h",
        ["pot"] = 100,
    };

    [Fact]
    public async Task Create_then_claim_then_walk_to_done()
    {
        using var db = NewDb();
        var create = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(create.Result).Value);
        Assert.Equal("Queued", job.Status);
        Assert.Equal("9c5dJc7s9h", job.Board);
        Assert.Null(job.ClaimedAtUtc);
        Assert.Null(job.Timings); // pre-instrumentation shape: absent, not empty

        var watcher = WatcherController(db);
        var claim = Assert.IsType<OkObjectResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
        Assert.NotNull(claim.Value);
        // The claim body is the ONLY channel to the watcher, so its fields are
        // worth asserting: an option that never reaches it silently does nothing.
        var claimed = claim.Value!.GetType();
        Assert.Equal(true, claimed.GetProperty("disablePio")!.GetValue(claim.Value));
        Assert.Equal(true, claimed.GetProperty("disableCompare")!.GetValue(claim.Value));
        Assert.Equal(true, claimed.GetProperty("disableCrossCheck")!.GetValue(claim.Value));
        Assert.Equal(0.02, claimed.GetProperty("pioAccuracyPct")!.GetValue(claim.Value));

        foreach (var status in new[] { "Running", "Uploading" })
        {
            Assert.IsType<OkObjectResult>(await watcher.Report(job.Id,
                new EngineCompareWatcherController.ReportRequestDto
                {
                    WatcherId = "w1",
                    Status = status,
                }));
        }
        Assert.IsType<OkObjectResult>(await watcher.Report(job.Id,
            new EngineCompareWatcherController.ReportRequestDto
            {
                WatcherId = "w1",
                Status = "Done",
                HtResultBlobPath = "enginecompare/x.ht.htc.gz",
                Timings = new JsonObject
                {
                    ["schema"] = 1,
                    ["engine_solve_s"] = 1.5,
                    ["upload_s"] = 0.25,
                },
            }));

        var stored = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("Done", stored.Status);
        Assert.Equal("enginecompare/x.ht.htc.gz", stored.HtResultBlobPath);
        Assert.Null(stored.PioResultBlobPath); // Pio was disabled for this job
        Assert.NotNull(stored.CompletedAtUtc);
        Assert.Contains("engine_solve_s", stored.TimingsJson);

        // The user-facing poll surfaces the claim timestamp, parsed timings,
        // and which payloads exist.
        var polled = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Get(job.Id)).Result).Value);
        Assert.NotNull(polled.ClaimedAtUtc);
        Assert.NotNull(polled.Timings);
        Assert.Equal(1.5, polled.Timings!["engine_solve_s"]!.GetValue<double>());
        Assert.True(polled.HasHtResult);
        Assert.False(polled.HasPioResult);
        Assert.False(polled.LegacyResult);
    }

    [Fact]
    public async Task Pio_options_round_trip_and_normalize()
    {
        using var db = NewDb();
        // All three off: Pio runs with per-hand extraction and the gate.
        var full = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>((await UserController(db, "uid-1").Create(
                new EngineCompareController.CreateDto
                {
                    Config = SpotConfig(),
                    DisablePio = false,
                    DisableCompare = false,
                    DisableCrossCheck = false,
                })).Result).Value);
        Assert.False(full.DisablePio);
        Assert.False(full.DisableCompare);
        Assert.False(full.DisableCrossCheck);

        // "No Pio" subsumes the other two even when the body says otherwise:
        // neither can run without a Pio process.
        var noPio = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>((await UserController(db, "uid-2").Create(
                new EngineCompareController.CreateDto
                {
                    Config = SpotConfig(),
                    DisablePio = true,
                    DisableCompare = false,
                    DisableCrossCheck = false,
                })).Result).Value);
        Assert.True(noPio.DisablePio);
        Assert.True(noPio.DisableCompare);
        Assert.True(noPio.DisableCrossCheck);

        // Defaults, when the body omits them entirely: the fast engine-only loop.
        var bare = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>((await UserController(db, "uid-3").Create(
                new EngineCompareController.CreateDto { Config = SpotConfig() })).Result).Value);
        Assert.True(bare.DisablePio);
    }

    [Fact]
    public async Task Both_payload_paths_round_trip_to_the_dto()
    {
        using var db = NewDb();
        await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig(), DisablePio = false });
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });
        var id = (await db.EngineCompareJobs.SingleAsync()).Id;

        foreach (var status in new[] { "Running", "Uploading" })
            await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
            { WatcherId = "w1", Status = status });
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Done",
            HtResultBlobPath = "enginecompare/x.ht.htc.gz",
            PioResultBlobPath = "enginecompare/x.pio.htc.gz",
        });

        var polled = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Get(id)).Result).Value);
        Assert.True(polled.HasHtResult);
        Assert.True(polled.HasPioResult);
        Assert.False(polled.LegacyResult);
    }

    [Fact]
    public async Task Result_route_validates_the_solver_name()
    {
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value);

        Assert.IsType<BadRequestObjectResult>(
            await UserController(db, "uid-1").ResultFor(job.Id, "bogus"));
        // A job with no Pio payload 404s for that half rather than 500ing.
        Assert.IsType<NotFoundObjectResult>(
            await UserController(db, "uid-1").ResultFor(job.Id, "pio"));
    }

    [Fact]
    public async Task Pio_accuracy_outside_its_range_is_rejected()
    {
        using var db = NewDb();
        foreach (var bad in new[] { 0.0, -1.0, 10.5 })
        {
            var result = await UserController(db, "uid-1").Create(
                new EngineCompareController.CreateDto
                { Config = SpotConfig(), PioAccuracyPct = bad });
            Assert.IsType<BadRequestObjectResult>(result.Result);
        }
    }

    [Fact]
    public async Task Claim_returns_no_content_when_queue_empty()
    {
        using var db = NewDb();
        var result = await WatcherController(db).Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });
        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task Reports_from_the_wrong_watcher_conflict()
    {
        using var db = NewDb();
        await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });
        var job = await db.EngineCompareJobs.SingleAsync();

        var result = await watcher.Report(job.Id,
            new EngineCompareWatcherController.ReportRequestDto
            {
                WatcherId = "imposter",
                Status = "Running",
                Timings = new JsonObject { ["engine_solve_s"] = 9.9 },
            });
        Assert.IsType<ConflictObjectResult>(result);
        job = await db.EngineCompareJobs.SingleAsync();
        Assert.Null(job.TimingsJson); // rejected report must store nothing
    }

    [Fact]
    public async Task Jobs_are_owner_scoped()
    {
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value);

        // Another user cannot see it: 404, not 403 (no existence leak).
        var other = await UserController(db, "uid-2").Get(job.Id);
        Assert.IsType<NotFoundResult>(other.Result);

        var list = await UserController(db, "uid-2").List();
        var jobs = Assert.IsType<EngineCompareController.JobDto[]>(
            Assert.IsType<OkObjectResult>(list.Result).Value);
        Assert.Empty(jobs);
    }

    [Fact]
    public async Task Publish_mode_is_admin_only()
    {
        using var db = NewDb();
        var denied = await UserController(db, "uid-1", "someone@example.com").Create(
            new EngineCompareController.CreateDto
            {
                Config = SpotConfig(),
                Mode = "publish",
            });
        Assert.IsType<ForbidResult>(denied.Result);

        var allowed = await UserController(db, "uid-1", AdminEmail).Create(
            new EngineCompareController.CreateDto
            {
                Config = SpotConfig(),
                Mode = "publish",
            });
        Assert.IsType<OkObjectResult>(allowed.Result);
    }

    [Fact]
    public async Task Invalid_boards_are_rejected()
    {
        using var db = NewDb();
        var config = SpotConfig();
        config["board"] = "9c 5d"; // 2 cards: not flop, turn, or river
        var result = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = config });
        Assert.IsType<BadRequestObjectResult>(result.Result);

        // Flop boards queue fine for compare mode...
        config["board"] = "9c 5d Jc";
        var flop = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = config });
        Assert.IsType<OkObjectResult>(flop.Result);

        // ...but publish mode stays river-only.
        var publish = await UserController(db, "uid-1", AdminEmail).Create(
            new EngineCompareController.CreateDto { Config = config, Mode = "publish" });
        Assert.IsType<BadRequestObjectResult>(publish.Result);
    }

    [Fact]
    public async Task Stale_claims_are_requeued_then_failed()
    {
        using var db = NewDb();
        await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });

        // Simulate a dead claimer: age the heartbeat past the timeout.
        var job = await db.EngineCompareJobs.SingleAsync();
        job.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-30);
        await db.SaveChangesAsync();

        // Next claim sweeps it back to Queued and re-claims it (attempt 2).
        var reclaim = await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w2" });
        Assert.IsType<OkObjectResult>(reclaim);
        job = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal(2, job.AttemptCount);
        Assert.Equal("w2", job.WatcherId);

        // Age it again: attempts exhausted, so the sweep fails it.
        job.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-30);
        await db.SaveChangesAsync();
        var empty = await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w3" });
        Assert.IsType<NoContentResult>(empty);
        job = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("Failed", job.Status);
    }

    [Fact]
    public async Task Cancelling_a_queued_job_ends_it_immediately()
    {
        // Nothing has run, so there is nothing to save and no watcher to tell.
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value);

        var cancelled = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Cancel(job.Id)).Result).Value);
        Assert.Equal("Cancelled", cancelled.Status);
        Assert.NotNull(cancelled.CancelRequestedAtUtc);
        Assert.NotNull(cancelled.CompletedAtUtc);

        // And no watcher can pick it up afterwards.
        Assert.IsType<NoContentResult>(await WatcherController(db).Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
    }

    [Fact]
    public async Task Cancelling_a_running_job_keeps_it_running_until_the_watcher_acts()
    {
        // The whole point of Stop: the solve stops COOPERATIVELY and the
        // partial result is still uploaded, so the row must stay active - and
        // keep its claim - until the watcher reports back.
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var id = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Id;
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Running",
        });

        var afterCancel = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Cancel(id)).Result).Value);
        Assert.Equal("Running", afterCancel.Status);
        Assert.NotNull(afterCancel.CancelRequestedAtUtc);

        // The watcher learns about it from its next heartbeat, with no extra
        // endpoint to poll.
        var beat = Assert.IsType<OkObjectResult>(await watcher.Report(id,
            new EngineCompareWatcherController.ReportRequestDto
            {
                WatcherId = "w1",
                Heartbeat = true,
            }));
        Assert.Equal(true,
            beat.Value!.GetType().GetProperty("cancelRequested")!.GetValue(beat.Value));

        // It then finishes the job normally, uploading what the solve reached.
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Uploading",
        });
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Cancelled",
            HtResultBlobPath = "enginecompare/x.ht.json.gz",
        });

        var final = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("Cancelled", final.Status);
        Assert.NotNull(final.CompletedAtUtc);
        // A stopped solve is a result, not a failure - this is what the page
        // opens, and what would be missing if Stop had killed the process.
        Assert.Equal("enginecompare/x.ht.json.gz", final.HtResultBlobPath);
        Assert.Null(final.Error);
    }

    [Fact]
    public async Task Cancel_is_idempotent_owner_scoped_and_refused_once_terminal()
    {
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var id = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Id;
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });

        // A stranger cannot stop someone else's solve, and gets the same 404
        // every other route here gives rather than a 403 confirming it exists.
        Assert.IsType<NotFoundResult>((await UserController(db, "uid-2").Cancel(id)).Result);

        var first = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Cancel(id)).Result).Value);
        var second = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Cancel(id)).Result).Value);
        // A double-click must not look like a second, later cancel.
        Assert.Equal(first.CancelRequestedAtUtc, second.CancelRequestedAtUtc);

        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Running",
        });
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Uploading",
        });
        await watcher.Report(id, new EngineCompareWatcherController.ReportRequestDto
        {
            WatcherId = "w1",
            Status = "Cancelled",
        });
        Assert.IsType<ConflictObjectResult>((await UserController(db, "uid-1").Cancel(id)).Result);
    }

    [Fact]
    public async Task A_cancelled_job_whose_watcher_dies_is_not_requeued()
    {
        // Re-queuing would restart a solve nobody wants, and the owner would
        // watch a job they stopped start over.
        using var db = NewDb();
        await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var watcher = WatcherController(db);
        await watcher.Claim(new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" });
        var job = await db.EngineCompareJobs.SingleAsync();
        await UserController(db, "uid-1").Cancel(job.Id);

        job = await db.EngineCompareJobs.SingleAsync();
        job.LastHeartbeatUtc = DateTimeOffset.UtcNow.AddMinutes(-30);
        await db.SaveChangesAsync();

        Assert.IsType<NoContentResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w2" }));
        job = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("Cancelled", job.Status);
        Assert.Equal(1, job.AttemptCount); // never handed out again
    }

    [Fact]
    public async Task A_cancelled_job_can_be_deleted_like_any_finished_one()
    {
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var id = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value).Id;
        // Still queued, so a delete is refused while it could still run...
        Assert.IsType<ConflictObjectResult>(await UserController(db, "uid-1").Delete(id));
        await UserController(db, "uid-1").Cancel(id);
        // ...and allowed once stopping has made it terminal.
        Assert.IsType<NoContentResult>(await UserController(db, "uid-1").Delete(id));
        Assert.Empty(await db.EngineCompareJobs.ToListAsync());
    }
}

