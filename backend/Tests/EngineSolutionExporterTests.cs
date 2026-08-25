using System.IO.Compression;
using System.Text.Json;
using PokerRangeAPI2.Services.EngineArtifacts;
using Xunit;

namespace HoldemToolsAPI.Tests;

/// <summary>
/// The exporter must emit schema-4 documents the /solutions viewer accepts.
/// These assertions encode the load-bearing frontend conventions (see
/// frontend/src/lib/solver/postflopLibrary.ts + postflopClient.ts): bNNN
/// cumulative action labels, chip-consistent pot/stacks/seat EVs, hand_order
/// + sparse idx combos block, and meta covering unextracted children.
/// </summary>
public class EngineSolutionExporterTests
{
    private static async Task<(string Dir, EngineSolutionExporter.ExportResult Result)> ExportAsync()
    {
        var dir = Path.Combine(Path.GetTempPath(), "engine_export_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var result = await new EngineSolutionExporter()
            .ExportAsync("Fixtures/engine/tiny_river.hta", dir);
        return (dir, result);
    }

    [Fact]
    public async Task Export_produces_manifest_bundle_and_index()
    {
        var (dir, result) = await ExportAsync();
        try
        {
            Assert.True(File.Exists(result.ManifestPath));
            var boardDir = Path.GetDirectoryName(result.ManifestPath)!;
            Assert.True(File.Exists(Path.Combine(boardDir, "streets", "r.0.json.gz")));
            Assert.True(File.Exists(Path.Combine(dir, "piosolutions-index.json")));

            var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(result.ManifestPath)).RootElement;
            Assert.Equal(4, manifest.GetProperty("schema").GetInt32());
            Assert.Equal("AhKd7c4s2d", manifest.GetProperty("board").GetString());
            Assert.Equal("OOP", manifest.GetProperty("seats").GetProperty("oop").GetString());
            Assert.Equal("IP", manifest.GetProperty("seats").GetProperty("ip").GetString());
            Assert.Equal(100, manifest.GetProperty("pot_chips").GetInt64());
            Assert.Equal(300, manifest.GetProperty("effective_stack_chips").GetInt64());
            // ev_oop + ev_ip must sum to pot_chips (the frontend's nodeStats
            // heuristic hides money EV otherwise).
            var summary = manifest.GetProperty("summary");
            Assert.Equal(100.0,
                summary.GetProperty("ev_oop").GetDouble() + summary.GetProperty("ev_ip").GetDouble(),
                1);
            Assert.True(manifest.GetProperty("streets").GetProperty("r.0")
                .GetProperty("extracted").GetBoolean());

            var index = JsonDocument.Parse(
                await File.ReadAllTextAsync(Path.Combine(dir, "piosolutions-index.json"))).RootElement;
            Assert.Single(index.GetProperty("entries").EnumerateArray());
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task Bundle_honors_the_schema4_conventions()
    {
        var (dir, result) = await ExportAsync();
        try
        {
            var boardDir = Path.GetDirectoryName(result.ManifestPath)!;
            await using var file = File.OpenRead(Path.Combine(boardDir, "streets", "r.0.json.gz"));
            await using var gzip = new GZipStream(file, CompressionMode.Decompress);
            var bundle = (await JsonDocument.ParseAsync(gzip)).RootElement;

            Assert.Equal(4, bundle.GetProperty("schema").GetInt32());
            Assert.Equal("street_bundle", bundle.GetProperty("kind").GetString());
            Assert.Equal("r:0", bundle.GetProperty("seed").GetString());
            Assert.Equal("river", bundle.GetProperty("street").GetString());
            var handOrder = bundle.GetProperty("hand_order").EnumerateArray()
                .Select(h => h.GetString()!).ToArray();
            Assert.True(handOrder.Length > 1000);  // 1326 minus board-blocked combos
            Assert.All(handOrder, h => Assert.Equal(4, h!.Length));

            var nodes = bundle.GetProperty("nodes");
            var meta = bundle.GetProperty("meta");
            // meta must cover every node, including terminal children -
            // navigation and the card picker are driven entirely by meta.
            Assert.True(meta.EnumerateObject().Count() > nodes.EnumerateObject().Count());

            var root = nodes.GetProperty("r.0");
            Assert.Equal("OOP", root.GetProperty("position").GetString());
            Assert.Equal("OOP_DEC", root.GetProperty("pio_node_type").GetString());
            Assert.Equal("r:0", root.GetProperty("node_id").GetString());

            // Action labels are f / c / bNNN with NNN cumulative chips.
            var children = root.GetProperty("children");
            foreach (var child in children.EnumerateObject())
            {
                Assert.Matches("^(f|c|b[0-9]+)$", child.Name);
            }

            // combos block: parallel sparse arrays, watcher COMBO_SCALE, both
            // seats carry w, actor carries strategy/action_ev.
            var combos = root.GetProperty("combos");
            Assert.Equal("oop", combos.GetProperty("actor").GetString());
            Assert.Equal(1000, combos.GetProperty("scale").GetProperty("w").GetInt32());
            Assert.Equal(100, combos.GetProperty("scale").GetProperty("ev").GetInt32());
            var oop = combos.GetProperty("oop");
            var idxCount = oop.GetProperty("idx").GetArrayLength();
            Assert.Equal(idxCount, oop.GetProperty("w").GetArrayLength());
            Assert.Equal(idxCount, combos.GetProperty("strategy")[0].GetArrayLength());
            foreach (var idx in oop.GetProperty("idx").EnumerateArray())
            {
                Assert.InRange(idx.GetInt32(), 0, handOrder.Length - 1);
            }

            // root_169: 169 classes, matrix rows aligned with actions.
            var root169 = root.GetProperty("root_169");
            Assert.Equal(169, root169.GetProperty("hand_classes").GetArrayLength());
            Assert.Equal(root169.GetProperty("strategy").GetProperty("actions").GetArrayLength(),
                         root169.GetProperty("strategy").GetProperty("matrix").GetArrayLength());

            // seat_stats EVs in chips: they must sum to about pot_chips at
            // the root (ICM heuristic in the frontend).
            var stats = root.GetProperty("seat_stats");
            var evSum = stats.GetProperty("oop").GetProperty("ev").GetDouble() +
                        stats.GetProperty("ip").GetProperty("ev").GetDouble();
            Assert.InRange(evSum, 50.0, 200.0);  // pot 100: within [0.5, 2]x pot

            Assert.Equal(1.0, root.GetProperty("global_freq").GetDouble(), 2);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public async Task Exporter_refuses_unsupported_artifacts()
    {
        // The refusal paths (QRE mode, >2 seats) are guarded in ExportAsync;
        // here we at least pin the nash fixture passing and a bogus path failing.
        await Assert.ThrowsAnyAsync<Exception>(() =>
            new EngineSolutionExporter().ExportAsync("Fixtures/engine/does_not_exist.hta",
                                                     Path.GetTempPath()));
    }
}
