using System.Collections.Generic;
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
        Assert.Null(claimed.GetProperty("sampledConfig")!.GetValue(claim.Value));


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
        // A job with no Pio (or sampled) payload 404s for that half rather than 500ing.
        Assert.IsType<NotFoundObjectResult>(
            await UserController(db, "uid-1").ResultFor(job.Id, "pio"));
        Assert.IsType<NotFoundObjectResult>(
            await UserController(db, "uid-1").ResultFor(job.Id, "sampled"));
    }

    private static JsonObject SampledSpotConfig()
    {
        var config = SpotConfig();
        config["algorithm"] = new JsonObject
        {
            ["family"] = "sampled",
            ["sampled"] = new JsonObject { ["seed"] = 1, ["batch"] = 4096, ["lanes"] = 4 },
        };
        config["isomorphism"] = false;
        return config;
    }

    [Fact]
    public async Task Sampled_core_config_rides_the_claim_and_its_payload_the_dto()
    {
        using var db = NewDb();
        var created = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto
            { Config = SpotConfig(), SampledConfig = SampledSpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(created.Result).Value);
        Assert.True(job.RunSampledCore);
        Assert.False(job.HasSampledResult);

        // The claim body is the only channel to the watcher: the second
        // config must reach it verbatim.
        var watcher = WatcherController(db);
        var claim = Assert.IsType<OkObjectResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
        var sampled = claim.Value!.GetType().GetProperty("sampledConfig")!.GetValue(claim.Value);
        Assert.Equal(SampledSpotConfig().ToJsonString(), sampled);

        foreach (var status in new[] { "Running", "Uploading" })
            await watcher.Report(job.Id, new EngineCompareWatcherController.ReportRequestDto
            { WatcherId = "w1", Status = status });
        Assert.IsType<OkObjectResult>(await watcher.Report(job.Id,
            new EngineCompareWatcherController.ReportRequestDto
            {
                WatcherId = "w1",
                Status = "Done",
                HtResultBlobPath = "enginecompare/x.ht.htc.gz",
                SampledResultBlobPath = "enginecompare/x.sampled.htc.gz",
            }));

        var stored = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("enginecompare/x.sampled.htc.gz", stored.SampledResultBlobPath);
        var polled = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Get(job.Id)).Result).Value);
        Assert.True(polled.HasHtResult);
        Assert.True(polled.HasSampledResult);
        Assert.False(polled.HasPioResult);
    }

    [Fact]
    public async Task Sampled_core_config_is_validated()
    {
        using var db = NewDb();
        // Not on the sampled core: that would race the vectorized core against itself.
        Assert.IsType<BadRequestObjectResult>((await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto
            { Config = SpotConfig(), SampledConfig = SpotConfig() })).Result);
        // A different board is a different tree, not a comparison.
        var other = SampledSpotConfig();
        other["board"] = "Ah Kd 7c 4s 2d";
        Assert.IsType<BadRequestObjectResult>((await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto
            { Config = SpotConfig(), SampledConfig = other })).Result);
        // Compare mode only.
        Assert.IsType<BadRequestObjectResult>((await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto
            { Config = SpotConfig(), SampledConfig = SampledSpotConfig(), Mode = "pushfold" })).Result);
    }


    private static JsonObject MultiwayConfig(int seats, bool sampled)
    {
        var players = new JsonArray();
        for (var i = 0; i < seats; i++)
        {
            players.Add(new JsonObject { ["seat"] = $"S{i}", ["stack"] = 200, ["range"] = "AA" });
        }
        var algorithm = new JsonObject { ["update"] = "dcfr" };
        if (sampled) algorithm["family"] = "sampled";
        return new JsonObject
        {
            ["schema"] = 1,
            ["game"] = "nlhe",
            ["board"] = "9c 5d Jc 7s 9h",
            ["pot"] = 100,
            ["players"] = players,
            ["algorithm"] = algorithm,
        };
    }

    [Fact]
    public async Task Multiway_mode_queues_with_a_board_and_a_seat_labelled_row()
    {
        using var db = NewDb();
        var create = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto
            { Config = MultiwayConfig(3, sampled: false), Mode = "multiway" });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(create.Result).Value);
        Assert.Equal("multiway", job.Mode);
        // The label carries the seat count as well as the board: a board alone
        // does not say which of these a row is.
        Assert.Equal("3-way 9c5dJc7s9h", job.Board);

        // Pio cannot build an N-seat postflop tree at all, so the flags are
        // normalized rather than trusted from the client.
        var watcher = WatcherController(db);
        var claim = Assert.IsType<OkObjectResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
        var claimed = claim.Value!.GetType();
        Assert.Equal(true, claimed.GetProperty("disablePio")!.GetValue(claim.Value));
        Assert.Equal(true, claimed.GetProperty("disableCompare")!.GetValue(claim.Value));
    }

    [Fact]
    public async Task Job_labels_fit_the_Board_column()
    {
        // The in-memory provider does NOT enforce column lengths, so every
        // other test here would pass with a label too long for SQL Server -
        // which is exactly what shipped: "3-way 9c5dJc7s9h" is 16 characters
        // into an nvarchar(12), and every multiway turn and river job died on
        // insert with "String or binary data would be truncated" wrapped in a
        // DbUpdateException. A multiway FLOP label is exactly 12 and squeaked
        // through, which is why it looked intermittent.
        //
        // So this reads the limit out of the MODEL rather than hardcoding it,
        // and checks the longest label each mode can produce against it.
        using var db = NewDb();
        var max = db.Model.FindEntityType(typeof(EngineCompareJob))!
                    .FindProperty(nameof(EngineCompareJob.Board))!
                    .GetMaxLength();
        Assert.NotNull(max);

        var ctl = UserController(db, "uid-1");
        var longest = new List<(string mode, JsonObject config)>
        {
            // 9 seats and a 5-card board is the widest a multiway label gets.
            ("multiway", MultiwayConfig(9, sampled: true)),
            ("pushfold", SpotConfig()),
            ("compare", SpotConfig()),
        };
        longest[1].config.Remove("board"); // pushfold takes no board
        var pushfoldPlayers = new JsonArray();
        for (var i = 0; i < 9; i++)
        {
            pushfoldPlayers.Add(new JsonObject
            { ["seat"] = $"S{i}", ["stack"] = 200, ["range"] = "AA" });
        }
        longest[1].config["players"] = pushfoldPlayers;

        foreach (var (mode, config) in longest)
        {
            var result = await ctl.Create(new EngineCompareController.CreateDto
            { Config = config, Mode = mode });
            var job = Assert.IsType<EngineCompareController.JobDto>(
                Assert.IsType<OkObjectResult>(result.Result).Value);
            Assert.NotNull(job.Board);
            Assert.True(job.Board!.Length <= max,
                $"{mode} label \"{job.Board}\" is {job.Board.Length} chars, " +
                $"but Board is nvarchar({max}) - this would throw on insert.");
        }
    }

    [Fact]
    public async Task Multiway_mode_rejects_seat_counts_the_engine_cannot_solve()
    {
        using var db = NewDb();
        var ctl = UserController(db, "uid-1");

        // Heads-up postflop is the compare tab's job; running it here would be
        // the same solve under a second name.
        Assert.IsType<BadRequestObjectResult>((await ctl.Create(
            new EngineCompareController.CreateDto
            { Config = MultiwayConfig(2, sampled: false), Mode = "multiway" })).Result);

        // Past three seats there is no vectorized showdown, so the vectorized
        // core cannot solve this at all. Fail at queue time rather than on the
        // watcher's machine twenty minutes later.
        Assert.IsType<BadRequestObjectResult>((await ctl.Create(
            new EngineCompareController.CreateDto
            { Config = MultiwayConfig(5, sampled: false), Mode = "multiway" })).Result);

        // The same spot on the sampled core is fine.
        Assert.IsType<OkObjectResult>((await ctl.Create(
            new EngineCompareController.CreateDto
            { Config = MultiwayConfig(5, sampled: true), Mode = "multiway" })).Result);

        // Three seats needs no sampled flag: the vectorized sweep still works.
        Assert.IsType<OkObjectResult>((await ctl.Create(
            new EngineCompareController.CreateDto
            { Config = MultiwayConfig(3, sampled: false), Mode = "multiway" })).Result);

        // And it is postflop, so a board is required.
        var noBoard = MultiwayConfig(4, sampled: true);
        noBoard.Remove("board");
        Assert.IsType<BadRequestObjectResult>((await ctl.Create(
            new EngineCompareController.CreateDto { Config = noBoard, Mode = "multiway" })).Result);
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

    /// <summary>Create, claim and walk one job to Done with the lineage the
    /// watcher would report from the artifact's metadata.</summary>
    private static async Task<Guid> SolvedJobAsync(AppDbContext db, string uid, string solveId,
                                                   string? solveKey, long iterations, string blob)
    {
        var create = await UserController(db, uid).Create(
            new EngineCompareController.CreateDto { Config = SpotConfig() });
        var job = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(create.Result).Value);
        var watcher = WatcherController(db);
        Assert.IsType<OkObjectResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
        foreach (var status in new[] { "Running", "Uploading" })
        {
            Assert.IsType<OkObjectResult>(await watcher.Report(job.Id,
                new EngineCompareWatcherController.ReportRequestDto { WatcherId = "w1", Status = status }));
        }
        Assert.IsType<OkObjectResult>(await watcher.Report(job.Id,
            new EngineCompareWatcherController.ReportRequestDto
            {
                WatcherId = "w1",
                Status = "Done",
                HtResultBlobPath = blob,
                SolveId = solveId,
                SolveKey = solveKey,
                Iterations = iterations,
            }));
        return job.Id;
    }

    [Fact]
    public async Task A_lineage_keeps_one_result_and_the_newer_more_converged_one_wins()
    {
        using var db = NewDb();
        var key = new string('1', 64);
        var older = await SolvedJobAsync(db, "uid-1", "abc", key, 1000, "enginecompare/a.json.gz");
        var legacy = await SolvedJobAsync(db, "uid-1", "abc", null, 500, "enginecompare/b.json.gz");
        var otherSpot = await SolvedJobAsync(db, "uid-1", "abc", new string('2', 64), 5000, "enginecompare/c.json.gz");
        var otherUser = await SolvedJobAsync(db, "uid-2", "abc", key, 5000, "enginecompare/d.json.gz");
        var otherLineage = await SolvedJobAsync(db, "uid-1", "xyz", key, 5000, "enginecompare/e.json.gz");

        var newer = await SolvedJobAsync(db, "uid-1", "abc", key, 2000, "enginecompare/f.json.gz");

        var ids = await db.EngineCompareJobs.Select(j => j.Id).ToListAsync();
        // The same solve at a less converged point is gone, and so is the
        // pre-stamp copy with no key - the stale rows this exists to clear.
        Assert.DoesNotContain(older, ids);
        Assert.DoesNotContain(legacy, ids);
        // A different spot that reused the id, another user's job, and another
        // lineage on the same spot are all somebody else's result.
        Assert.Contains(otherSpot, ids);
        Assert.Contains(otherUser, ids);
        Assert.Contains(otherLineage, ids);
        Assert.Contains(newer, ids);

        // A re-export at the SAME iteration count replaces the older copy too:
        // ties go to the newest, so a lineage never shows twice.
        var reexport = await SolvedJobAsync(db, "uid-1", "abc", key, 2000, "enginecompare/g.json.gz");
        ids = await db.EngineCompareJobs.Select(j => j.Id).ToListAsync();
        Assert.DoesNotContain(newer, ids);
        Assert.Contains(reexport, ids);

        // And the lineage rides the DTO, which is what lets the page open a
        // result by solve id instead of queueing one.
        var dto = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(
                (await UserController(db, "uid-1").Get(reexport)).Result).Value);
        Assert.Equal("abc", dto.SolveId);
        Assert.Equal(key, dto.SolveKey);
        Assert.Equal(2000, dto.Iterations);
    }

    [Fact]
    public async Task Identity_backfill_fills_only_what_is_missing_and_is_owner_scoped()
    {
        using var db = NewDb();
        var id = await SolvedJobAsync(db, "uid-1", "abc", null, 1000, "enginecompare/a.json.gz");
        var owner = UserController(db, "uid-1");
        var key = new string('a', 64);

        var dto = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>((await owner.Identity(id,
                new EngineCompareController.IdentityDto
                {
                    SolveId = "zzz",
                    SolveKey = key,
                    Iterations = 9,
                })).Result).Value);
        // The watcher's report is the authority: what it set stays, and only
        // the gap (the key) is filled from the artifact.
        Assert.Equal("abc", dto.SolveId);
        Assert.Equal(key, dto.SolveKey);
        Assert.Equal(1000, dto.Iterations);

        Assert.IsType<NotFoundResult>((await UserController(db, "uid-2").Identity(id,
            new EngineCompareController.IdentityDto { SolveId = "x" })).Result);
        Assert.IsType<BadRequestObjectResult>((await owner.Identity(id,
            new EngineCompareController.IdentityDto { SolveKey = "not-a-sha" })).Result);
        Assert.IsType<BadRequestObjectResult>((await owner.Identity(id,
            new EngineCompareController.IdentityDto { SolveId = "bad id!" })).Result);
    }
}
