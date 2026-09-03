using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests;

public class SolveGroupsTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString()).Options);

    private static IConfiguration Config() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Watcher:ClaimTimeoutSeconds"] = "300",
            ["Watcher:MaxAttempts"] = "2",
        }).Build();

    private static ControllerContext ContextFor(string uid) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                new List<Claim> { new("user_id", uid), new("sub", uid) }, "TestAuth")),
        },
    };

    private static SolveGroupsController Groups(AppDbContext db, string uid) =>
        new(db) { ControllerContext = ContextFor(uid) };

    private static EngineCompareController Jobs(AppDbContext db, string uid) =>
        new(db, Config()) { ControllerContext = ContextFor(uid) };

    /// <summary>The config multiwayView.ts buildMultiwayConfig writes for a
    /// 4-way 10bb spot, with an optional hand-sharing team.</summary>
    private static JsonObject PushFoldConfig(int[]? team = null, double[]? stacks = null)
    {
        stacks ??= new[] { 20.0, 20.0, 20.0, 20.0 };
        var seats = new[] { "SB", "BB", "CO", "BTN" };
        var players = new JsonArray();
        for (var i = 0; i < 4; i++)
        {
            players.Add(new JsonObject
            {
                ["seat"] = seats[i],
                ["stack"] = stacks[i],
                ["range"] = "AA,KK",
            });
        }
        var config = new JsonObject
        {
            ["schema"] = 1,
            ["game"] = "nlhe_preflop",
            ["chip_scale"] = 2,
            ["players"] = players,
            ["preflop"] = new JsonObject
            {
                ["small_blind"] = 1,
                ["big_blind"] = 2,
                ["ante"] = 0,
                ["dead"] = 0,
                ["button"] = 3,
                ["action_set"] = "jam_fold",
            },
            ["budget"] = new JsonObject { ["iterations"] = 200000, ["target_nashconv"] = 0.004 },
        };
        if (team != null)
        {
            var partition = new JsonArray { new JsonArray(team.Select(t => (JsonNode)t).ToArray()) };
            foreach (var i in Enumerable.Range(0, 4).Where(i => !team.Contains(i)))
                partition.Add(new JsonArray { i });
            config["agents"] = new JsonObject
            {
                ["partition"] = partition,
                ["awareness"] = "unaware",
                ["baseline_iterations"] = 50000,
            };
        }
        return config;
    }

    private static async Task<Guid> QueuePushFold(AppDbContext db, string uid, int[]? team = null)
    {
        var create = await Jobs(db, uid).Create(new EngineCompareController.CreateDto
        {
            Config = PushFoldConfig(team),
            Mode = EngineCompareJobMode.PushFold,
        });
        return Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>(create.Result).Value).Id;
    }

    [Fact]
    public void Spot_summary_reads_seats_stacks_blinds_and_team()
    {
        var spot = PushFoldSpotSummary.Parse(PushFoldConfig(team: new[] { 3, 0 }).ToJsonString());
        Assert.NotNull(spot);
        Assert.Equal(4, spot!.Players);
        Assert.Equal(new[] { "SB", "BB", "CO", "BTN" }, spot.Seats);
        Assert.Equal(new[] { 20.0, 20.0, 20.0, 20.0 }, spot.Stacks);
        Assert.Equal(1, spot.SmallBlind);
        Assert.Equal(2, spot.BigBlind);
        Assert.Equal(0, spot.Ante);
        Assert.Equal(3, spot.Button);
        // Sorted, whatever order the config listed them in.
        Assert.Equal(new[] { 0, 3 }, spot.TeamSeats);
        Assert.Equal("unaware", spot.Awareness);
        Assert.Equal(200000, spot.RequestedIterations);
    }

    [Fact]
    public void Spot_summary_of_a_baseline_has_no_team()
    {
        var spot = PushFoldSpotSummary.Parse(PushFoldConfig().ToJsonString());
        Assert.NotNull(spot);
        Assert.Null(spot!.TeamSeats);
        Assert.Null(spot.Awareness);
    }

    [Fact]
    public void Spot_summary_is_null_for_a_postflop_config_and_for_garbage()
    {
        Assert.Null(PushFoldSpotSummary.Parse("{\"board\":\"9c5dJc\",\"pot\":100}"));
        Assert.Null(PushFoldSpotSummary.Parse("not json"));
        Assert.Null(PushFoldSpotSummary.Parse(null));
        Assert.Null(PushFoldSpotSummary.Parse(""));
    }

    [Fact]
    public async Task Job_list_carries_the_spot_and_filters_by_mode()
    {
        using var db = NewDb();
        await QueuePushFold(db, "uid-1", team: new[] { 0, 1 });
        await Jobs(db, "uid-1").Create(new EngineCompareController.CreateDto
        {
            Config = new JsonObject { ["board"] = "9c 5d Jc 7s 9h", ["pot"] = 100 },
        });

        var all = Assert.IsType<EngineCompareController.JobDto[]>(
            Assert.IsType<OkObjectResult>((await Jobs(db, "uid-1").List()).Result).Value);
        Assert.Equal(2, all.Length);
        var pushFold = Assert.IsType<EngineCompareController.JobDto[]>(
            Assert.IsType<OkObjectResult>(
                (await Jobs(db, "uid-1").List(mode: "pushfold")).Result).Value);
        var job = Assert.Single(pushFold);
        Assert.NotNull(job.Spot);
        Assert.Equal(new[] { 0, 1 }, job.Spot!.TeamSeats);
        // The compare-mode row never gets a spot: it is not a preflop config.
        Assert.Null(all.Single(j => j.Mode == "compare").Spot);
    }

    [Fact]
    public async Task Create_list_update_delete_round_trip()
    {
        using var db = NewDb();
        var a = await QueuePushFold(db, "uid-1", new[] { 0, 1 });
        var b = await QueuePushFold(db, "uid-1", new[] { 2, 3 });

        var created = Assert.IsType<SolveGroupsController.GroupDto>(
            Assert.IsType<OkObjectResult>((await Groups(db, "uid-1").Create(
                new SolveGroupsController.UpsertDto { Name = "  pairs  ", JobIds = new[] { a, b, a } })).Result).Value);
        Assert.Equal("pairs", created.Name);
        // Order kept, and a repeated solve kept as a repeat.
        Assert.Equal(new[] { a, b, a }, created.JobIds);

        var listed = Assert.IsType<SolveGroupsController.GroupDto[]>(
            Assert.IsType<OkObjectResult>((await Groups(db, "uid-1").List()).Result).Value);
        Assert.Equal(new[] { a, b, a }, Assert.Single(listed).JobIds);

        var updated = Assert.IsType<SolveGroupsController.GroupDto>(
            Assert.IsType<OkObjectResult>((await Groups(db, "uid-1").Update(created.Id,
                new SolveGroupsController.UpsertDto { Name = "across", JobIds = new[] { b, a } })).Result).Value);
        Assert.Equal("across", updated.Name);
        Assert.Equal(new[] { b, a }, updated.JobIds);
        Assert.NotNull(updated.UpdatedAtUtc);
        // Replaced, not appended: the old slots are gone from the table.
        Assert.Equal(2, await db.SolveGroupMembers.CountAsync());

        Assert.IsType<NoContentResult>(await Groups(db, "uid-1").Delete(created.Id));
        Assert.Empty(await db.SolveGroups.ToListAsync());
        Assert.Empty(await db.SolveGroupMembers.ToListAsync());
    }

    [Fact]
    public async Task A_group_only_holds_the_callers_own_push_fold_jobs()
    {
        using var db = NewDb();
        var mine = await QueuePushFold(db, "uid-1");
        var theirs = await QueuePushFold(db, "uid-2");
        var postflop = Assert.IsType<EngineCompareController.JobDto>(
            Assert.IsType<OkObjectResult>((await Jobs(db, "uid-1").Create(
                new EngineCompareController.CreateDto
                {
                    Config = new JsonObject { ["board"] = "9c 5d Jc", ["pot"] = 100 },
                })).Result).Value).Id;

        foreach (var bad in new[] { theirs, postflop, Guid.NewGuid() })
        {
            var result = await Groups(db, "uid-1").Create(
                new SolveGroupsController.UpsertDto { Name = "x", JobIds = new[] { mine, bad } });
            Assert.IsType<BadRequestObjectResult>(result.Result);
        }
        Assert.IsType<BadRequestObjectResult>((await Groups(db, "uid-1").Create(
            new SolveGroupsController.UpsertDto { Name = "   ", JobIds = new[] { mine } })).Result);
        Assert.IsType<BadRequestObjectResult>((await Groups(db, "uid-1").Create(
            new SolveGroupsController.UpsertDto
            {
                Name = "too many",
                JobIds = Enumerable.Repeat(mine, SolveGroupsController.MaxMembers + 1).ToArray(),
            })).Result);
        Assert.Empty(await db.SolveGroups.ToListAsync());

        // An empty group is allowed: it is a name waiting for solves.
        Assert.IsType<OkObjectResult>((await Groups(db, "uid-1").Create(
            new SolveGroupsController.UpsertDto { Name = "empty", JobIds = Array.Empty<Guid>() })).Result);
    }

    [Fact]
    public async Task Groups_are_private_to_their_owner()
    {
        using var db = NewDb();
        var mine = await QueuePushFold(db, "uid-1");
        var group = Assert.IsType<SolveGroupsController.GroupDto>(
            Assert.IsType<OkObjectResult>((await Groups(db, "uid-1").Create(
                new SolveGroupsController.UpsertDto { Name = "g", JobIds = new[] { mine } })).Result).Value);

        Assert.Empty(Assert.IsType<SolveGroupsController.GroupDto[]>(
            Assert.IsType<OkObjectResult>((await Groups(db, "uid-2").List()).Result).Value));
        Assert.IsType<NotFoundResult>((await Groups(db, "uid-2").Update(group.Id,
            new SolveGroupsController.UpsertDto { Name = "stolen" })).Result);
        Assert.IsType<NotFoundResult>(await Groups(db, "uid-2").Delete(group.Id));
        Assert.Equal("g", (await db.SolveGroups.SingleAsync()).Name);
    }

    [Fact]
    public async Task A_superseding_result_takes_over_the_groups_slot()
    {
        using var db = NewDb();
        var uid = "uid-1";
        var first = await QueuePushFold(db, uid, new[] { 0, 1 });
        var other = await QueuePushFold(db, uid, new[] { 2, 3 });
        var watcher = new EngineCompareWatcherController(db, Config());

        async Task Finish(Guid id, string solveId, long iterations)
        {
            var claim = Assert.IsType<OkObjectResult>(await watcher.Claim(
                new EngineCompareWatcherController.ClaimRequestDto { WatcherId = "w1" }));
            Assert.Equal(id, claim.Value!.GetType().GetProperty("id")!.GetValue(claim.Value));
            foreach (var status in new[] { "Running", "Uploading", "Done" })
            {
                Assert.IsType<OkObjectResult>(await watcher.Report(id,
                    new EngineCompareWatcherController.ReportRequestDto
                    {
                        WatcherId = "w1",
                        Status = status,
                        HtResultBlobPath = status == "Done" ? $"enginecompare/{id}.json.gz" : null,
                        SolveId = status == "Done" ? solveId : null,
                        Iterations = status == "Done" ? iterations : null,
                    }));
            }
        }

        await Finish(first, "lineage-a", 1000);
        await Finish(other, "lineage-b", 1000);
        var group = Assert.IsType<SolveGroupsController.GroupDto>(
            Assert.IsType<OkObjectResult>((await Groups(db, uid).Create(
                new SolveGroupsController.UpsertDto { Name = "g", JobIds = new[] { first, other, first } })).Result).Value);

        // The same lineage again, further along: it supersedes `first`.
        var second = await QueuePushFold(db, uid, new[] { 0, 1 });
        await Finish(second, "lineage-a", 5000);

        Assert.Null(await db.EngineCompareJobs.FindAsync(first));
        var after = Assert.IsType<SolveGroupsController.GroupDto[]>(
            Assert.IsType<OkObjectResult>((await Groups(db, uid).List()).Result).Value);
        // Both slots that held the old run now hold the new one, in place.
        Assert.Equal(new[] { second, other, second }, Assert.Single(after).JobIds);
        Assert.Equal(group.Id, after[0].Id);
    }
}
