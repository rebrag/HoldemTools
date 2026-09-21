// Services/EnginePlanner.cs
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Queue-time planning with `engine plan`: sizes a job's tree, estimates
    /// every solver core's memory and rate, and picks the core for a config
    /// that asked for algorithm.family "auto". Wraps the htsolver binary; the
    /// controller only decides when to call it.
    /// </summary>
    public class EnginePlanner
    {
        // At most a couple of planners at once: each builds the job's public
        // tree (a gigabyte for the largest 3-way flop) for a few seconds.
        private static readonly SemaphoreSlim PlanGate = new(2, 2);

        private readonly string? _exe;

        public EnginePlanner(IConfiguration config) : this(FindExe(config["Engine:ExePath"])) { }

        public EnginePlanner(string? exePath) { _exe = exePath; }

        /// <summary>True when a binary was found: planning is available.</summary>
        public bool Available => _exe != null;

        /// <summary>Where htsolver is on this instance: the configured path, then
        /// the copy the deploy workflow ships beside the API, then a dev
        /// checkout's build. Null when none exists - planning is then
        /// unavailable and the seat-count rule is the only queue-time check.</summary>
        public static string? FindExe(string? configured)
        {
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;
            var shipped = Path.Combine(AppContext.BaseDirectory, "engine", "engine.exe");
            if (File.Exists(shipped)) return shipped;
            // A dev checkout: walk up from bin/<config>/net8.0 (the API's, or
            // the test project's one level deeper) to the monorepo root.
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            for (var i = 0; i < 7 && dir != null; ++i, dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "engine", "build", "engine.exe");
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        /// <summary>Run `engine plan` on a config. Returns (plan, null) on success,
        /// (null, null) when no binary is available, and (null, error) when the
        /// engine refused the config - that message is the user's, it is what
        /// `engine solve` would have printed twenty minutes later.</summary>
        public async Task<(JsonNode? plan, string? error)> PlanAsync(JsonObject config, CancellationToken ct)
        {
            if (_exe == null) return (null, null);
            var budgetSeconds = config["budget"]?["max_seconds"]?.GetValue<double>() ?? 0.0;
            var targetPct = config["budget"]?["target_exploitable_pct"]?.GetValue<double>() ?? 0.0;
            var dir = Path.Combine(Path.GetTempPath(), "htsolver_plan_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                var path = Path.Combine(dir, "config.json");
                await File.WriteAllTextAsync(path, config.ToJsonString(), ct);
                var psi = new ProcessStartInfo(_exe)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = dir,
                };
                psi.ArgumentList.Add("plan");
                psi.ArgumentList.Add(path);
                if (budgetSeconds > 0)
                {
                    psi.ArgumentList.Add("--time-budget-seconds");
                    psi.ArgumentList.Add(budgetSeconds.ToString(CultureInfo.InvariantCulture));
                }
                if (targetPct > 0)
                {
                    psi.ArgumentList.Add("--target-pct");
                    psi.ArgumentList.Add(targetPct.ToString(CultureInfo.InvariantCulture));
                }
                await PlanGate.WaitAsync(ct);
                try
                {
                    using var proc = Process.Start(psi)
                        ?? throw new InvalidOperationException("could not start the engine");
                    var stdoutTask = proc.StandardOutput.ReadToEndAsync();
                    var stderrTask = proc.StandardError.ReadToEndAsync();
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
                    using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
                    try
                    {
                        await proc.WaitForExitAsync(linked.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        // Too slow for this host, not wrong: the watcher plans on claim.
                        try { proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
                        return (null, null);
                    }
                    var stdout = await stdoutTask;
                    var stderr = await stderrTask;
                    if (proc.ExitCode == 3)
                    {
                        // Out of memory building the tree on THIS host (a 3-way
                        // flop tree is a gigabyte; the App Service plan is not).
                        // Not the user's problem: the watcher plans on claim.
                        return (null, null);
                    }
                    if (proc.ExitCode != 0)
                    {
                        var message = (stderr + "\n" + stdout).Trim();
                        var line = message.Split('\n').Select(l => l.Trim())
                            .FirstOrDefault(l => l.StartsWith("error:", StringComparison.Ordinal)) ?? message;
                        return (null, "the engine refused this config: " + line.Replace("error: ", ""));
                    }
                    try { return (JsonNode.Parse(stdout), null); }
                    catch (System.Text.Json.JsonException)
                    {
                        return (null, "the planner returned something that is not JSON");
                    }
                }
                finally { PlanGate.Release(); }
            }
            finally
            {
                try { Directory.Delete(dir, recursive: true); } catch { /* temp */ }
            }
        }

        /// <summary>Replace algorithm.family "auto" with the plan's recommendation,
        /// and the budget's iteration cadence with the plan's. The budget's target
        /// and max_seconds stay the caller's. A bucketed recommendation also sets
        /// output.export "bucketed" (a 3-way flop tree's per-hand export is a
        /// 160 GB file). Returns an error message when the plan has no usable
        /// recommendation.</summary>
        public static string? MergePlan(JsonObject config, JsonNode plan)
        {
            var rec = plan["recommendation"] as JsonObject;
            if (rec == null) return "the planner produced no recommendation for this config";
            var family = rec["family"]?.GetValue<string>();
            var existingSeed = config["algorithm"]?["sampled"]?["seed"]?.DeepClone();
            if (family == "vectorized")
            {
                config["algorithm"] = new JsonObject { ["update"] = "dcfr" };
            }
            else if (family == "sampled")
            {
                var sampled = new JsonObject
                {
                    ["hero"] = rec["hero"]?.DeepClone() ?? "pinned",
                    ["update"] = rec["update"]?.DeepClone() ?? "external",
                    ["batch"] = rec["batch"]?.DeepClone(),
                    ["lanes"] = rec["lanes"]?.DeepClone(),
                };
                if (existingSeed != null) sampled["seed"] = existingSeed;
                if (rec["abstraction"] is JsonObject abstraction) sampled["abstraction"] = abstraction.DeepClone();
                config["algorithm"] = new JsonObject { ["family"] = "sampled", ["sampled"] = sampled };
                if (rec["abstraction"] is JsonObject)
                {
                    var output = config["output"] as JsonObject ?? new JsonObject();
                    output["export"] = "bucketed";
                    config["output"] = output;
                }
            }
            else
            {
                return "the planner recommended an unknown core: " + family;
            }
            var budget = config["budget"] as JsonObject ?? new JsonObject();
            if (rec["iterations"] != null) budget["iterations"] = rec["iterations"]!.DeepClone();
            if (rec["checkpoint_every"] != null) budget["checkpoint_every"] = rec["checkpoint_every"]!.DeepClone();
            if (rec["measure_at_seconds"] is JsonArray marks) budget["measure_at_seconds"] = marks.DeepClone();
            config["budget"] = budget;
            return null;
        }

        /// <summary>The plan trimmed to what the job row stores when the full
        /// JSON would not fit the column: seats, nodes and the recommendation.</summary>
        public static string Store(JsonNode plan, int maxChars)
        {
            var json = plan.ToJsonString();
            if (json.Length <= maxChars) return json;
            var trimmed = new JsonObject
            {
                ["seats"] = plan["seats"]?.DeepClone(),
                ["nodes"] = plan["nodes"]?.DeepClone(),
                ["recommendation"] = plan["recommendation"]?.DeepClone(),
            };
            return trimmed.ToJsonString();
        }
    }
}
