using System.Text.Json;
using PokerRangeAPI2.Services.EngineArtifacts;
using Xunit;

namespace HoldemToolsAPI.Tests;

/// <summary>
/// Round-trip contract test: the C++ writer and this C# reader must agree.
/// The fixture pair (tiny_river.hta + tiny_river.golden.json, the engine's
/// own dump-json of the same artifact) is committed under Fixtures/engine/.
/// Regenerate both after any artifact format change - the exact commands are
/// documented in engine/configs/fixtures/tiny_river.json.
/// </summary>
public class EngineArtifactReaderTests
{
    private const string ArtifactPath = "Fixtures/engine/tiny_river.hta";
    private const string GoldenPath = "Fixtures/engine/tiny_river.golden.json";
    private const float Tolerance = 1e-4f;

    private static async Task<(EngineArtifactReader Reader, JsonElement Golden)> OpenAsync()
    {
        var source = new FileArtifactByteSource(ArtifactPath);
        var reader = await EngineArtifactReader.OpenAsync(source);
        var golden = JsonDocument.Parse(await File.ReadAllTextAsync(GoldenPath)).RootElement;
        return (reader, golden);
    }

    [Fact]
    public async Task Metadata_matches_the_golden_dump()
    {
        var (reader, golden) = await OpenAsync();
        var goldenMeta = golden.GetProperty("metadata");

        Assert.Equal("nash", reader.Metadata.Mode);
        Assert.Equal(goldenMeta.GetProperty("iterations").GetUInt64(), reader.Metadata.Iterations);
        Assert.Equal(goldenMeta.GetProperty("config_hash").GetString(), reader.Metadata.ConfigHash);
        Assert.Equal(goldenMeta.GetProperty("board").GetString(), reader.Metadata.Board);
        Assert.Equal(goldenMeta.GetProperty("final_nashconv").GetDouble(),
                     reader.Metadata.FinalNashConv, 10);
        Assert.Equal("nlhe_combos_1326", reader.Metadata.HandUniverse);
    }

    [Fact]
    public async Task Node_table_and_hand_dictionaries_match_the_golden_dump()
    {
        var (reader, golden) = await OpenAsync();

        var goldenDicts = golden.GetProperty("hand_dicts");
        Assert.Equal(goldenDicts.GetArrayLength(), reader.HandDicts.Count);
        for (var s = 0; s < reader.HandDicts.Count; s++)
        {
            var goldenHands = goldenDicts[s].EnumerateArray().Select(h => h.GetString()).ToArray();
            var readerHands = reader.HandDicts[s].Select(id => EngineCards.ComboToString(id)).ToArray();
            Assert.Equal(goldenHands, readerHands);
        }

        var goldenNodes = golden.GetProperty("nodes");
        Assert.Equal(goldenNodes.EnumerateObject().Count(), reader.Nodes.Count);
        foreach (var node in reader.Nodes)
        {
            var g = goldenNodes.GetProperty(node.NodeId.ToString());
            Assert.Equal(g.GetProperty("pot").GetInt64(), node.Pot);
            Assert.Equal(g.GetProperty("action_amount").GetInt64(), node.ActionAmount);
            Assert.Equal(g.GetProperty("num_children").GetInt32(), node.NumChildren);
            Assert.Equal(g.GetProperty("commit")[0].GetInt32(), node.Commit[0]);
            Assert.Equal(g.GetProperty("commit")[1].GetInt32(), node.Commit[1]);
            var kind = g.GetProperty("kind").GetString();
            Assert.Equal(kind == "decision" ? 0 : kind == "chance" ? 1 : 2, node.Kind);
        }
    }

    [Fact]
    public async Task Per_node_arrays_match_the_golden_dump()
    {
        var (reader, golden) = await OpenAsync();
        var goldenNodes = golden.GetProperty("nodes");

        Assert.NotEmpty(reader.DecisionNodeIds);
        foreach (var nodeId in reader.DecisionNodeIds)
        {
            var data = await reader.ReadNodeAsync(nodeId);
            var g = goldenNodes.GetProperty(nodeId.ToString()).GetProperty("data");
            Assert.Equal(g.GetProperty("actor").GetInt32(), data.Actor);
            Assert.Equal(g.GetProperty("num_actions").GetInt32(), data.NumActions);

            var goldenSeats = g.GetProperty("seats");
            for (var s = 0; s < data.NumSeats; s++)
            {
                var hands = goldenSeats[s].GetProperty("hands");
                var seat = data.Seats[s];
                Assert.Equal(hands.GetArrayLength(), seat.Idx.Length);
                for (var i = 0; i < seat.Idx.Length; i++)
                {
                    var hand = hands[i];
                    Assert.Equal(hand.GetProperty("hand").GetString(),
                                 EngineCards.ComboToString(reader.HandDicts[s][(int)seat.Idx[i]]));
                    Assert.Equal(hand.GetProperty("reach").GetSingle(), seat.Reach[i], Tolerance);
                    Assert.Equal(hand.GetProperty("ev").GetSingle(), seat.Ev[i], Tolerance);
                    if (s == data.Actor)
                    {
                        var strategy = hand.GetProperty("strategy");
                        var actionEv = hand.GetProperty("action_ev");
                        for (var k = 0; k < data.NumActions; k++)
                        {
                            Assert.Equal(strategy[k].GetSingle(),
                                         data.Strategy[i * data.NumActions + k], Tolerance);
                            Assert.Equal(actionEv[k].GetSingle(),
                                         data.ActionEv[i * data.NumActions + k], Tolerance);
                        }
                    }
                }
            }
        }
    }

    [Fact]
    public async Task Rollups_match_the_golden_dump()
    {
        var (reader, golden) = await OpenAsync();
        Assert.True(reader.Header.HasRollups);
        var goldenNodes = golden.GetProperty("nodes");

        foreach (var nodeId in reader.DecisionNodeIds)
        {
            var data = await reader.ReadNodeAsync(nodeId);
            Assert.NotNull(data.RollupWeight);
            var goldenRollup = goldenNodes.GetProperty(nodeId.ToString())
                .GetProperty("data").GetProperty("rollup_169");
            foreach (var entry in goldenRollup.EnumerateArray())
            {
                var className = entry.GetProperty("class").GetString()!;
                var cls = Enumerable.Range(0, 169).Single(i => EngineCards.ClassName(i) == className);
                Assert.Equal(entry.GetProperty("weight").GetSingle(), data.RollupWeight![cls], Tolerance);
                Assert.Equal(entry.GetProperty("ev").GetSingle(), data.RollupEv![cls], Tolerance);
                var freq = entry.GetProperty("freq");
                for (var k = 0; k < data.NumActions; k++)
                    Assert.Equal(freq[k].GetSingle(), data.RollupFreq![cls][k], Tolerance);
            }
        }
    }
}
