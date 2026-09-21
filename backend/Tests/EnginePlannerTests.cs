using System.Text.Json.Nodes;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests;

/// <summary>
/// Queue-time planning. MergePlan is pure and tested on a captured plan; the
/// live test runs the real htsolver binary when a dev checkout has built it
/// (engine/build/engine.exe) and is skipped otherwise, so CI without the
/// binary stays green while a developer's run proves the process wiring.
/// </summary>
public class EnginePlannerTests
{
    private static JsonObject ThreeWayRiver() => JsonNode.Parse("""
        {
          "schema": 1, "game": "nlhe", "board": "9c 5d Jc 7s 2h", "pot": 90, "chip_scale": 100,
          "players": [
            {"seat": "OOP", "stack": 200, "range": "AA,KK,QQ,AKs,AKo"},
            {"seat": "MID", "stack": 200, "range": "AA,KK,QQ,AKs,AKo"},
            {"seat": "BTN", "stack": 200, "range": "AA,KK,QQ,AKs,AKo"}],
          "bet_sizing": {"river": {"bets": [50], "raises": [100], "max_raises": 1}},
          "algorithm": {"family": "auto", "sampled": {"seed": 42}},
          "budget": {"iterations": 1000, "target_exploitable_pct": 0.5, "max_seconds": 60},
          "memory_limit_gb": 12, "threads": 0
        }
        """)!.AsObject();

    private static JsonNode SampledPlan() => JsonNode.Parse("""
        {
          "seats": 3, "nodes": 123,
          "recommendation": {
            "family": "sampled", "hero": "pinned", "update": "external",
            "abstraction": {"preset": "monker", "method": "moments", "flop": 30, "turn": 30, "river": 30, "tiers": 4},
            "batch": 4096, "lanes": 16, "iterations": 5000000, "checkpoint_every": 5000000,
            "measure_at_seconds": [30.0], "reason": "test"
          }
        }
        """)!;

    [Fact]
    public void MergePlan_writes_the_sampled_recommendation_and_keeps_the_seed_and_budget()
    {
        var config = ThreeWayRiver();
        var error = EnginePlanner.MergePlan(config, SampledPlan());
        Assert.Null(error);
        Assert.Equal("sampled", config["algorithm"]!["family"]!.GetValue<string>());
        var sampled = config["algorithm"]!["sampled"]!;
        Assert.Equal("pinned", sampled["hero"]!.GetValue<string>());
        Assert.Equal("external", sampled["update"]!.GetValue<string>());
        Assert.Equal(4096, sampled["batch"]!.GetValue<int>());
        Assert.Equal(16, sampled["lanes"]!.GetValue<int>());
        Assert.Equal(42, sampled["seed"]!.GetValue<int>());
        Assert.Equal("monker", sampled["abstraction"]!["preset"]!.GetValue<string>());
        Assert.Equal("bucketed", config["output"]!["export"]!.GetValue<string>());
        var budget = config["budget"]!;
        Assert.Equal(5000000, budget["iterations"]!.GetValue<long>());
        Assert.Equal(5000000, budget["checkpoint_every"]!.GetValue<long>());
        Assert.Equal(60, budget["max_seconds"]!.GetValue<int>());
        Assert.Equal(0.5, budget["target_exploitable_pct"]!.GetValue<double>());
        Assert.Single(budget["measure_at_seconds"]!.AsArray());
    }

    [Fact]
    public void MergePlan_vectorized_recommendation_and_bad_plans()
    {
        var config = ThreeWayRiver();
        var plan = JsonNode.Parse("""{"recommendation": {"family": "vectorized", "iterations": 300, "checkpoint_every": 25}}""")!;
        Assert.Null(EnginePlanner.MergePlan(config, plan));
        Assert.Equal("dcfr", config["algorithm"]!["update"]!.GetValue<string>());
        Assert.Null(config["algorithm"]!["family"]);
        Assert.Null(config["output"]);
        Assert.Equal(300, config["budget"]!["iterations"]!.GetValue<int>());

        Assert.NotNull(EnginePlanner.MergePlan(ThreeWayRiver(), JsonNode.Parse("""{"seats": 3}""")!));
        Assert.NotNull(EnginePlanner.MergePlan(ThreeWayRiver(), JsonNode.Parse("""{"recommendation": {"family": "quantum"}}""")!));
    }

    [Fact]
    public void Store_trims_to_the_recommendation_when_the_plan_is_too_long()
    {
        var plan = SampledPlan();
        Assert.Equal(plan.ToJsonString(), EnginePlanner.Store(plan, 100000));
        var trimmed = JsonNode.Parse(EnginePlanner.Store(plan, 10))!;
        Assert.Equal(3, trimmed["seats"]!.GetValue<int>());
        Assert.NotNull(trimmed["recommendation"]);
    }

    [Fact]
    public async Task PlanAsync_runs_the_real_engine_when_a_dev_checkout_has_built_it()
    {
        var exe = EnginePlanner.FindExe(null);
        if (exe == null) return;  // no binary: nothing to prove on this machine
        var planner = new EnginePlanner(exe);
        Assert.True(planner.Available);

        var config = ThreeWayRiver();
        var (plan, error) = await planner.PlanAsync(config, CancellationToken.None);
        Assert.Null(error);
        Assert.NotNull(plan);
        Assert.Equal(3, plan!["seats"]!.GetValue<int>());
        Assert.True(plan["nodes"]!.GetValue<long>() > 0);
        Assert.NotNull(plan["cores"]!["sampled_pinned_external"]);
        var rec = plan["recommendation"]!;
        Assert.Contains(rec["family"]!.GetValue<string>(), new[] { "vectorized", "sampled" });
        Assert.Null(EnginePlanner.MergePlan(config, plan));

        // A config the engine refuses comes back as the engine's own message.
        var broken = ThreeWayRiver();
        broken["board"] = "9c 5d";
        var (none, refusal) = await planner.PlanAsync(broken, CancellationToken.None);
        Assert.Null(none);
        Assert.NotNull(refusal);
        Assert.Contains("refused", refusal);
    }

    [Fact]
    public async Task PlanAsync_without_a_binary_is_a_clean_no()
    {
        var planner = new EnginePlanner((string?)null);
        Assert.False(planner.Available);
        var (plan, error) = await planner.PlanAsync(ThreeWayRiver(), CancellationToken.None);
        Assert.Null(plan);
        Assert.Null(error);
    }
}
