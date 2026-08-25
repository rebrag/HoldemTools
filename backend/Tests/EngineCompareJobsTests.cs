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

        var watcher = WatcherController(db);
        var claim = Assert.IsType<OkObjectResult>(await watcher.Claim(
            new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
        Assert.NotNull(claim.Value);

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
                ResultBlobPath = "enginecompare/x.json.gz",
            }));

        var stored = await db.EngineCompareJobs.SingleAsync();
        Assert.Equal("Done", stored.Status);
        Assert.Equal("enginecompare/x.json.gz", stored.ResultBlobPath);
        Assert.NotNull(stored.CompletedAtUtc);
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
            });
        Assert.IsType<ConflictObjectResult>(result);
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
        config["board"] = "9c 5d Jc"; // not a river
        var result = await UserController(db, "uid-1").Create(
            new EngineCompareController.CreateDto { Config = config });
        Assert.IsType<BadRequestObjectResult>(result.Result);
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
}
