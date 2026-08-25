using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokerRangeAPI2.Services.EngineArtifacts;

/// <summary>
/// Converts a solved engine artifact (.hta) into the schema-4 JSON documents
/// the existing /solutions viewer consumes: manifest.json, one street bundle
/// (rivers-only solves are a single street seeded at r.0), and an upsert into
/// piosolutions-index.json. The output directory is laid out exactly like the
/// blob container, so the same files upload to ADLS unchanged in a later pass.
///
/// The reference for every shape here is watcher/extraction.py (schema 4) and
/// the TypeScript contracts in frontend/src/lib/solver/postflop*.ts. Known
/// gaps vs. Pio-extracted docs, all tolerated by the frontend types: per-combo
/// equity and matchups are null (the artifact stores no equities), and
/// seat_stats.equity is null.
/// </summary>
public sealed class EngineSolutionExporter
{
    public sealed record ExportResult(string Stacks, string NodeName, string Board, string ManifestPath);

    public async Task<ExportResult> ExportAsync(string artifactPath, string outputDir,
                                                CancellationToken ct = default)
    {
        using var source = new FileArtifactByteSource(artifactPath);
        var reader = await EngineArtifactReader.OpenAsync(source, ct);

        var meta = reader.Metadata;
        if (meta.Mode != "nash")
            throw new InvalidOperationException(
                "Only Nash-mode artifacts can be exported: a QRE solve is not comparable to " +
                "the viewer's equilibrium semantics yet.");
        if (reader.HandDicts.Count != 2)
            throw new InvalidOperationException(
                "Only 2-seat artifacts can be exported: the /solutions viewer is OOP/IP.");
        if (meta.HandUniverse != "nlhe_combos_1326")
            throw new InvalidOperationException("Only NLHE artifacts can be exported.");
        if (!reader.HandDicts[0].SequenceEqual(reader.HandDicts[1]))
            throw new InvalidOperationException("Seat hand dictionaries are expected to match.");

        var config = meta.Root.GetProperty("config");
        var chipScale = meta.ChipScale;
        var seats = meta.Root.GetProperty("seats").EnumerateArray()
            .Select(s => s.GetString() ?? "").ToArray();
        var oopSeat = seats[0];
        var ipSeat = seats[1];
        var players = config.GetProperty("players").EnumerateArray().ToArray();
        var stacksChips = players.Select(p => p.GetProperty("stack").GetInt64()).ToArray();
        var board = string.Concat(meta.Board.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var effectiveStack = meta.Root.GetProperty("effective_stack").GetInt64();

        var stacksLabel = string.Join("_",
            seats.Select((s, i) => $"{(long)Math.Round(stacksChips[i] / chipScale)}{s}"));
        var nodeName = $"engine_{meta.ConfigHash[..10]}_line=Engine Solve_pos={oopSeat}_icm=0";
        var nowUtc = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'");

        // Colon-form node ids ("r:0:b1650:c") from the node table.
        var colonIds = BuildColonIds(reader.Nodes);
        var handOrder = reader.HandDicts[0].Select(id => EngineCards.ComboToString(id)).ToArray();

        var bundleNodes = new JsonObject();
        var bundleMeta = new JsonObject();
        var evByNode = new Dictionary<uint, ArtifactNodeData>();
        foreach (var record in reader.Nodes)
        {
            var suffix = colonIds[record.NodeId].Replace(':', '.');
            if (record.IsDecision)
            {
                var data = await reader.ReadNodeAsync(record.NodeId, ct);
                evByNode[record.NodeId] = data;
                bundleNodes[suffix] = BuildNodeDoc(reader, record, data, colonIds, board,
                                                  oopSeat, ipSeat, effectiveStack, chipScale);
                bundleMeta[suffix] = new JsonObject
                {
                    ["type"] = record.Actor == 0 ? "OOP_DEC" : "IP_DEC",
                    ["street"] = "river",
                    ["actions"] = new JsonArray(ChildLabels(reader.Nodes, record)
                        .Select(l => (JsonNode)l).ToArray()),
                    ["extracted"] = true,
                };
            }
            else
            {
                bundleMeta[suffix] = new JsonObject { ["type"] = "terminal" };
            }
        }

        var bundle = new JsonObject
        {
            ["schema"] = 4,
            ["kind"] = "street_bundle",
            ["hand_order"] = new JsonArray(handOrder.Select(h => (JsonNode)h).ToArray()),
            ["seed"] = "r:0",
            ["seed_suffix"] = "r.0",
            ["street"] = "river",
            ["board"] = board,
            ["stacks"] = stacksLabel,
            ["node_name"] = nodeName,
            ["created_utc"] = nowUtc,
            ["nodes"] = bundleNodes,
            ["meta"] = bundleMeta,
        };

        var evChips = meta.Root.GetProperty("ev_chips");
        var manifest = new JsonObject
        {
            ["schema"] = 4,
            ["board"] = board,
            ["stacks"] = stacksLabel,
            ["node_name"] = nodeName,
            ["created_utc"] = nowUtc,
            ["updated_utc"] = nowUtc,
            ["preflop"] = new JsonObject
            {
                ["folder"] = null,
                // The library label drops the first element (watcher lines
                // start with "Root"), so keep a leading "Root" here too.
                ["line"] = new JsonArray("Root", "Engine Solve"),
                ["alive_positions"] = new JsonArray(seats.Select(s => (JsonNode)s).ToArray()),
                ["acting_pos"] = oopSeat,
                ["icm"] = false,
                ["gametree_path"] = null,
            },
            ["seats"] = new JsonObject { ["oop"] = oopSeat, ["ip"] = ipSeat },
            ["seat_meta"] = null,
            ["hand_bb"] = null,
            // chip_scale absent = the legacy "100 chips per bb" convention,
            // which also makes the viewer render EVs with the bb suffix.
            ["chip_scale"] = chipScale == 100.0 ? null : (JsonNode?)chipScale,
            ["stacks_map"] = new JsonObject(seats.Select((s, i) =>
                new KeyValuePair<string, JsonNode?>(s, JsonValue.Create(stacksChips[i])))),
            ["pot_chips"] = meta.Pot,
            ["effective_stack_chips"] = effectiveStack,
            ["summary"] = new JsonObject
            {
                ["ev_oop"] = evChips[0].GetDouble(),
                ["ev_ip"] = evChips[1].GetDouble(),
                // Pio's "exploitable for" is the per-player average gain;
                // NashConv sums both seats.
                ["exploitable"] = meta.FinalNashConv / 2.0,
                ["mes_oop"] = null,
                ["mes_ip"] = null,
            },
            ["engine"] = new JsonObject
            {
                ["solver"] = "htsolver",
                ["config_hash"] = meta.ConfigHash,
                ["iterations"] = meta.Iterations,
                ["nashconv"] = meta.FinalNashConv,
                ["mode"] = meta.Mode,
            },
            ["cfr"] = new JsonObject { ["file"] = "", ["available"] = false, ["size_bytes"] = null },
            ["streets"] = new JsonObject
            {
                ["r.0"] = new JsonObject
                {
                    ["street"] = "river",
                    ["file"] = "streets/r.0.json.gz",
                    ["extracted"] = true,
                    ["node_count"] = evByNode.Count,
                    ["updated_utc"] = nowUtc,
                },
            },
        };

        var boardDir = Path.Combine(outputDir, "piosolutions", stacksLabel, nodeName, board);
        Directory.CreateDirectory(Path.Combine(boardDir, "streets"));
        var manifestPath = Path.Combine(boardDir, "manifest.json");
        await File.WriteAllTextAsync(manifestPath, manifest.ToJsonString(), ct);
        await WriteGzipJsonAsync(Path.Combine(boardDir, "streets", "r.0.json.gz"),
                                 bundle.ToJsonString(), ct);
        await UpsertIndexAsync(outputDir, stacksLabel, nodeName, board, seats, nowUtc,
                               evByNode.Count, ct);
        return new ExportResult(stacksLabel, nodeName, board, manifestPath);
    }

    private static Dictionary<uint, string> BuildColonIds(IReadOnlyList<ArtifactNodeRecord> nodes)
    {
        var ids = new Dictionary<uint, string> { [nodes[0].NodeId] = "r:0" };
        foreach (var node in nodes)
        {
            if (node.NodeId == nodes[0].NodeId) continue;
            ids[node.NodeId] = ids[node.ParentId] + ":" + ActionLabel(node);
        }
        return ids;
    }

    private static string ActionLabel(ArtifactNodeRecord node) => node.ActionKind switch
    {
        1 => "f",
        2 => "c",
        3 => $"b{node.ActionAmount}",  // hand-cumulative postflop chips: the bNNN convention
        _ => throw new InvalidDataException($"Unexpected action kind {node.ActionKind}"),
    };

    private static List<string> ChildLabels(IReadOnlyList<ArtifactNodeRecord> nodes,
                                            ArtifactNodeRecord node)
    {
        var labels = new List<string>();
        for (var c = 0; c < node.NumChildren; c++)
            labels.Add(ActionLabel(nodes[(int)node.FirstChild + c]));
        return labels;
    }

    private JsonObject BuildNodeDoc(EngineArtifactReader reader, ArtifactNodeRecord record,
                                    ArtifactNodeData data, Dictionary<uint, string> colonIds,
                                    string board, string oopSeat, string ipSeat,
                                    long effectiveStack, double chipScale)
    {
        var nodes = reader.Nodes;
        var labels = ChildLabels(nodes, record);
        var actor = data.Actor;
        var actorRole = actor == 0 ? "oop" : "ip";

        // Dense per-hand views (dictionary position -> value) for aggregation.
        var dictSize = reader.HandDicts[0].Length;
        var reach = new float?[2][];
        var evCond = new float?[2][];
        for (var s = 0; s < 2; s++)
        {
            reach[s] = new float?[dictSize];
            evCond[s] = new float?[dictSize];
            var seat = data.Seats[s];
            for (var i = 0; i < seat.Idx.Length; i++)
            {
                reach[s][seat.Idx[i]] = seat.Reach[i];
                evCond[s][seat.Idx[i]] = seat.Ev[i];
            }
        }

        // 169-class aggregation, range-weighted with plain-mean fallback -
        // the same rule as watcher/extraction.py.
        var classes = new Dictionary<string, ClassAgg>();
        var actorSeat = data.Seats[actor];
        for (var i = 0; i < actorSeat.Idx.Length; i++)
        {
            var comboId = reader.HandDicts[actor][(int)actorSeat.Idx[i]];
            var cls = EngineCards.ComboClass(comboId);
            if (!classes.TryGetValue(cls, out var agg))
                classes[cls] = agg = new ClassAgg(labels.Count);
            var w = actorSeat.Reach[i];
            agg.Weight += w;
            agg.Count += 1;
            agg.EvSum += w * actorSeat.Ev[i];
            for (var k = 0; k < labels.Count; k++)
            {
                var p = data.Strategy[i * labels.Count + k];
                agg.FreqSum[k] += w * p;
                agg.FreqPlain[k] += p;
                agg.ActionEvSum[k] += w * data.ActionEv[i * labels.Count + k];
            }
        }

        // Per-seat class EV/weight for root_169.ev and the class list.
        var seatClassEv = new Dictionary<string, (double W, double Ev)>[2];
        for (var s = 0; s < 2; s++)
        {
            seatClassEv[s] = new Dictionary<string, (double, double)>();
            var seat = data.Seats[s];
            for (var i = 0; i < seat.Idx.Length; i++)
            {
                var cls = EngineCards.ComboClass(reader.HandDicts[s][(int)seat.Idx[i]]);
                var cur = seatClassEv[s].TryGetValue(cls, out var v) ? v : (0.0, 0.0);
                seatClassEv[s][cls] = (cur.Item1 + seat.Reach[i],
                                       cur.Item2 + seat.Reach[i] * seat.Ev[i]);
            }
        }

        var handClasses = Enumerable.Range(0, 169).Select(EngineCards.ClassName).ToArray();

        var actions = new JsonObject();
        for (var k = 0; k < labels.Count; k++)
        {
            var perClass = new JsonObject();
            foreach (var cls in handClasses)
            {
                if (classes.TryGetValue(cls, out var agg))
                {
                    var freq = agg.Weight > 0 ? agg.FreqSum[k] / agg.Weight
                                              : agg.FreqPlain[k] / agg.Count;
                    var ev = agg.Weight > 0 ? agg.ActionEvSum[k] / agg.Weight : (double?)null;
                    perClass[cls] = new JsonArray(Math.Round(freq, 4),
                                                  ev is null ? null : Math.Round(ev.Value, 2));
                }
                else
                {
                    perClass[cls] = new JsonArray(0.0, null);
                }
            }
            actions[labels[k]] = perClass;
        }

        var matrix = new JsonArray();
        for (var k = 0; k < labels.Count; k++)
        {
            var row = new JsonArray();
            foreach (var cls in handClasses)
            {
                row.Add(classes.TryGetValue(cls, out var agg)
                            ? Math.Round(agg.Weight > 0 ? agg.FreqSum[k] / agg.Weight
                                                        : agg.FreqPlain[k] / agg.Count, 4)
                            : 0.0);
            }
            matrix.Add(row);
        }
        JsonArray SeatEv(int s) => new(handClasses.Select(cls =>
            seatClassEv[s].TryGetValue(cls, out var v) && v.W > 0
                ? (JsonNode?)Math.Round(v.Ev / v.W, 2)
                : null).ToArray());

        // combos block: fixed-point sparse arrays over each seat's idx into
        // the bundle's hand_order (scales match watcher COMBO_SCALE; equity
        // and matchups are null - the artifact stores no equities).
        JsonObject SeatBlock(int s)
        {
            var seat = data.Seats[s];
            return new JsonObject
            {
                ["idx"] = new JsonArray(seat.Idx.Select(i => (JsonNode)(int)i).ToArray()),
                ["w"] = new JsonArray(seat.Reach.Select(w =>
                    (JsonNode?)(int)Math.Round(w * 1000)).ToArray()),
                ["eq"] = null,
                ["ev"] = new JsonArray(seat.Ev.Select(e =>
                    (JsonNode?)(int)Math.Round(e * 100)).ToArray()),
                ["mu"] = null,
            };
        }
        var comboStrategy = new JsonArray();
        var comboActionEv = new JsonArray();
        for (var k = 0; k < labels.Count; k++)
        {
            var srow = new JsonArray();
            var erow = new JsonArray();
            for (var i = 0; i < actorSeat.Idx.Length; i++)
            {
                srow.Add((int)Math.Round(data.Strategy[i * labels.Count + k] * 1000));
                erow.Add((int)Math.Round(data.ActionEv[i * labels.Count + k] * 100));
            }
            comboStrategy.Add(srow);
            comboActionEv.Add(erow);
        }

        JsonObject? SeatStats(int s)
        {
            var seat = data.Seats[s];
            if (seat.Idx.Length == 0) return null;
            double w = 0, evSum = 0;
            for (var i = 0; i < seat.Idx.Length; i++)
            {
                w += seat.Reach[i];
                evSum += seat.Reach[i] * seat.Ev[i];
            }
            return new JsonObject
            {
                ["combos"] = Math.Round(w, 2),
                ["equity"] = null,
                ["ev"] = w > 0 ? Math.Round(evSum / w, 2) : 0,
            };
        }

        return new JsonObject
        {
            ["schema"] = 4,
            ["board"] = board,
            ["position"] = actor == 0 ? "OOP" : "IP",
            ["hero_pos"] = actor == 0 ? oopSeat : ipSeat,
            ["villain_pos"] = actor == 0 ? ipSeat : oopSeat,
            ["alive_positions"] = new JsonArray(oopSeat, ipSeat),
            ["bb"] = (long)Math.Round(effectiveStack / chipScale),
            ["street"] = "river",
            ["pio_node_type"] = actor == 0 ? "OOP_DEC" : "IP_DEC",
            ["pot"] = new JsonArray(record.Commit[0], record.Commit[1], record.Pot),
            ["node_id"] = colonIds[record.NodeId],
            ["node_suffix"] = colonIds[record.NodeId].Replace(':', '.'),
            ["parent_id"] = record.ParentId == 0xFFFFFFFF
                ? null
                : colonIds[record.ParentId],
            ["children"] = new JsonObject(Enumerable.Range(0, record.NumChildren).Select(c =>
                new KeyValuePair<string, JsonNode?>(
                    ActionLabel(reader.Nodes[(int)record.FirstChild + c]),
                    colonIds[reader.Nodes[(int)record.FirstChild + c].NodeId]))),
            ["actions"] = actions,
            ["root_169"] = new JsonObject
            {
                ["hand_classes"] = new JsonArray(handClasses.Select(c => (JsonNode)c).ToArray()),
                ["strategy"] = new JsonObject
                {
                    ["actions"] = new JsonArray(labels.Select(l => (JsonNode)l).ToArray()),
                    ["matrix"] = matrix,
                },
                ["ev"] = new JsonObject { ["oop"] = SeatEv(0), ["ip"] = SeatEv(1) },
            },
            ["combos"] = new JsonObject
            {
                ["actor"] = actorRole,
                ["actions"] = new JsonArray(labels.Select(l => (JsonNode)l).ToArray()),
                ["scale"] = new JsonObject
                {
                    ["w"] = 1000, ["eq"] = 1000, ["ev"] = 100, ["mu"] = 100, ["s"] = 1000,
                },
                ["oop"] = SeatBlock(0),
                ["ip"] = SeatBlock(1),
                ["strategy"] = comboStrategy,
                ["action_ev"] = comboActionEv,
            },
            ["seat_stats"] = new JsonObject { ["oop"] = SeatStats(0), ["ip"] = SeatStats(1) },
            ["global_freq"] = GlobalFreq(reader, data),
        };
    }

    /// <summary>
    /// Probability this node is reached under the average profile: the
    /// card-disjoint product weight of both seats' node reach, normalized by
    /// the same quantity at the root (inclusion-exclusion over shared cards).
    /// </summary>
    private static double GlobalFreq(EngineArtifactReader reader, ArtifactNodeData data)
    {
        double PairWeight(ArtifactSeatData a, ArtifactSeatData b)
        {
            var dict = reader.HandDicts[0];
            var totalB = 0.0;
            var perCard = new double[52];
            for (var i = 0; i < b.Idx.Length; i++)
            {
                var (hi, lo) = EngineCards.ComboCards(dict[(int)b.Idx[i]]);
                totalB += b.Reach[i];
                perCard[hi] += b.Reach[i];
                perCard[lo] += b.Reach[i];
            }
            var reachB = new double[dict.Length];
            for (var i = 0; i < b.Idx.Length; i++) reachB[b.Idx[i]] = b.Reach[i];
            var z = 0.0;
            for (var i = 0; i < a.Idx.Length; i++)
            {
                var (hi, lo) = EngineCards.ComboCards(dict[(int)a.Idx[i]]);
                z += a.Reach[i] * (totalB - perCard[hi] - perCard[lo] + reachB[a.Idx[i]]);
            }
            return z;
        }

        var rootData = reader.ReadNodeAsync(reader.Nodes[0].NodeId).GetAwaiter().GetResult();
        var rootZ = PairWeight(rootData.Seats[0], rootData.Seats[1]);
        if (rootZ <= 0) return 0;
        return Math.Round(PairWeight(data.Seats[0], data.Seats[1]) / rootZ, 4);
    }

    private sealed class ClassAgg
    {
        public ClassAgg(int actions)
        {
            FreqSum = new double[actions];
            FreqPlain = new double[actions];
            ActionEvSum = new double[actions];
        }
        public double Weight;
        public int Count;
        public double EvSum;
        public double[] FreqSum;
        public double[] FreqPlain;
        public double[] ActionEvSum;
    }

    private static async Task WriteGzipJsonAsync(string path, string json, CancellationToken ct)
    {
        await using var file = File.Create(path);
        await using var gzip = new GZipStream(file, CompressionLevel.Optimal);
        await gzip.WriteAsync(Encoding.UTF8.GetBytes(json), ct);
    }

    private async Task UpsertIndexAsync(string outputDir, string stacks, string nodeName,
                                        string board, string[] seats, string nowUtc,
                                        int nodeCount, CancellationToken ct)
    {
        var indexPath = Path.Combine(outputDir, "piosolutions-index.json");
        JsonObject index;
        if (File.Exists(indexPath))
        {
            index = JsonNode.Parse(await File.ReadAllTextAsync(indexPath, ct))!.AsObject();
        }
        else
        {
            index = new JsonObject { ["schema"] = 2, ["entries"] = new JsonArray() };
        }
        var entries = index["entries"]!.AsArray();
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            var e = entries[i]!.AsObject();
            if (e["stacks"]?.GetValue<string>() == stacks &&
                e["node_name"]?.GetValue<string>() == nodeName &&
                e["board"]?.GetValue<string>() == board)
            {
                entries.RemoveAt(i);
            }
        }
        entries.Add(new JsonObject
        {
            ["stacks"] = stacks,
            ["node_name"] = nodeName,
            ["board"] = board,
            ["preflop_line"] = new JsonArray("Root", "Engine Solve"),
            ["alive_positions"] = new JsonArray(seats.Select(s => (JsonNode)s).ToArray()),
            ["icm"] = false,
            ["created_utc"] = nowUtc,
            ["flop_nodes"] = nodeCount,
            ["turn_streets"] = 0,
            ["cfr_available"] = false,
        });
        index["updated_utc"] = nowUtc;
        await File.WriteAllTextAsync(indexPath, index.ToJsonString(), ct);
    }
}
