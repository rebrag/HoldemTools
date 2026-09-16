using System.Buffers.Binary;
using System.Text.Json;

namespace PokerRangeAPI2.Services.EngineArtifacts;

/// <summary>
/// Reads version-1 .hta engine artifacts directly from a byte source - no
/// native interop. Bootstrap is three range reads (header, metadata, index)
/// plus the node table and hand dictionaries; each node afterwards is one
/// range read, which maps 1:1 onto ADLS Gen2 HTTP Range requests later.
/// </summary>
public sealed class EngineArtifactReader
{
    private const uint FormatVersion = 1;
    private const int HeaderSize = 64;
    private const int NodeRecordSize = 80;
    private const int IndexEntrySize = 24;
    private static readonly byte[] Magic = "HTENGART"u8.ToArray();

    private readonly IArtifactByteSource _source;
    private readonly Dictionary<uint, (ulong Offset, ulong Length)> _index = new();

    // Bucketed artifacts (Header.Bucketed): the bucket maps, per-group row
    // counts, per-decision-node group/map, root reach per seat, and the
    // dense decision index of every node. See engine/docs/artifact-format.md.
    private ushort[] _maps = Array.Empty<ushort>();
    private uint _mapHands;
    private uint[] _groupRows = Array.Empty<uint>();
    private uint[] _nodeGroup = Array.Empty<uint>();
    private uint[] _nodeMap = Array.Empty<uint>();
    private uint[] _decisionIndex = Array.Empty<uint>();
    private float[][] _rootReach = Array.Empty<float[]>();
    private readonly Dictionary<uint, float[]> _strategyCache = new();
    private readonly Dictionary<uint, float[][]> _reachCache = new();
    private const int CacheEntries = 4096;

    public ArtifactHeader Header { get; private set; } = null!;
    public ArtifactMetadata Metadata { get; private set; } = null!;
    public IReadOnlyList<ArtifactNodeRecord> Nodes { get; private set; } = null!;
    public IReadOnlyList<ushort[]> HandDicts { get; private set; } = null!;
    public IReadOnlyCollection<uint> DecisionNodeIds =>
        Header.Bucketed
            ? Nodes.Where(n => n.IsDecision).Select(n => n.NodeId).ToArray()
            : _index.Keys;

    private EngineArtifactReader(IArtifactByteSource source) => _source = source;

    public static async Task<EngineArtifactReader> OpenAsync(IArtifactByteSource source,
                                                             CancellationToken ct = default)
    {
        var reader = new EngineArtifactReader(source);
        await reader.InitializeAsync(ct);
        return reader;
    }

    private async Task InitializeAsync(CancellationToken ct)
    {
        var header = (await _source.ReadRangeAsync(0, HeaderSize, ct)).Span.ToArray();
        if (!header.AsSpan(0, 8).SequenceEqual(Magic))
            throw new InvalidDataException("Not an engine artifact (bad magic).");
        var version = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8));
        if (version != FormatVersion)
            throw new InvalidDataException($"Unsupported artifact format version {version}.");
        Header = new ArtifactHeader(
            version,
            BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(16)),
            BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(24)),
            BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(32)),
            BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(40)),
            BinaryPrimitives.ReadUInt64LittleEndian(header.AsSpan(48)));

        var metaBytes = await _source.ReadRangeAsync((long)Header.MetaOffset, (int)Header.MetaLength, ct);
        Metadata = new ArtifactMetadata(JsonDocument.Parse(metaBytes.ToArray()).RootElement);

        var table = Metadata.Root.GetProperty("sections").GetProperty("node_table");
        var tableOffset = table.GetProperty("offset").GetInt64();
        var recordSize = table.GetProperty("record_size").GetInt32();
        var count = table.GetProperty("count").GetInt32();
        if (recordSize != NodeRecordSize)
            throw new InvalidDataException($"Unexpected node record size {recordSize}.");

        var records = (await _source.ReadRangeAsync(tableOffset, count * recordSize, ct)).ToArray();
        var nodes = new ArtifactNodeRecord[count];
        for (var i = 0; i < count; i++)
            nodes[i] = ParseNodeRecord(records, i * recordSize);
        Nodes = nodes;

        var dicts = new List<ushort[]>();
        foreach (var dict in Metadata.Root.GetProperty("sections").GetProperty("hand_dicts").EnumerateArray())
        {
            var offset = dict.GetProperty("offset").GetInt64();
            var length = dict.GetProperty("length").GetInt32();
            var bytes = (await _source.ReadRangeAsync(offset, length, ct)).ToArray();
            var n = BinaryPrimitives.ReadUInt32LittleEndian(bytes);
            var ids = new ushort[n];
            for (var i = 0; i < n; i++)
                ids[i] = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(4 + i * 2));
            dicts.Add(ids);
        }
        HandDicts = dicts;

        var indexBytes = (await _source.ReadRangeAsync((long)Header.IndexOffset, (int)Header.IndexLength, ct)).ToArray();
        for (var i = 0; i + IndexEntrySize <= indexBytes.Length; i += IndexEntrySize)
        {
            _index[BinaryPrimitives.ReadUInt32LittleEndian(indexBytes.AsSpan(i))] =
                (BinaryPrimitives.ReadUInt64LittleEndian(indexBytes.AsSpan(i + 8)),
                 BinaryPrimitives.ReadUInt64LittleEndian(indexBytes.AsSpan(i + 16)));
        }

        if (Header.Bucketed) await InitializeBucketedAsync(ct);
    }

    private async Task InitializeBucketedAsync(CancellationToken ct)
    {
        _decisionIndex = new uint[Nodes.Count];
        uint d = 0;
        for (var i = 0; i < Nodes.Count; i++)
            _decisionIndex[i] = Nodes[i].IsDecision ? d++ : uint.MaxValue;

        var bm = Metadata.Root.GetProperty("sections").GetProperty("bucket_map");
        var bytes = (await _source.ReadRangeAsync(bm.GetProperty("offset").GetInt64(),
                                                  (int)bm.GetProperty("length").GetInt64(), ct)).ToArray();
        var pos = 0;
        uint U32() { var v = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(pos)); pos += 4; return v; }
        ushort U16() { var v = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(pos)); pos += 2; return v; }
        var numMaps = U32();
        _mapHands = U32();
        _maps = new ushort[numMaps * _mapHands];
        for (var i = 0; i < _maps.Length; i++) _maps[i] = U16();
        var numGroups = U32();
        _groupRows = new uint[numGroups];
        for (var g = 0; g < numGroups; g++) _groupRows[g] = U32();
        var decisions = U32();
        if (decisions != d) throw new InvalidDataException("Bucket map does not match the node table.");
        _nodeGroup = new uint[decisions];
        _nodeMap = new uint[decisions];
        for (var i = 0; i < decisions; i++) { _nodeGroup[i] = U32(); _nodeMap[i] = U32(); }

        var rr = Metadata.Root.GetProperty("sections").GetProperty("root_reach");
        var rbytes = (await _source.ReadRangeAsync(rr.GetProperty("offset").GetInt64(),
                                                   (int)rr.GetProperty("length").GetInt64(), ct)).ToArray();
        var seats = BinaryPrimitives.ReadUInt32LittleEndian(rbytes);
        var hands = BinaryPrimitives.ReadUInt32LittleEndian(rbytes.AsSpan(4));
        _rootReach = new float[seats][];
        var q = 8;
        for (var s = 0; s < seats; s++)
        {
            _rootReach[s] = new float[hands];
            for (var h = 0; h < hands; h++, q += 4)
                _rootReach[s][h] = BinaryPrimitives.ReadSingleLittleEndian(rbytes.AsSpan(q));
        }
    }

    /// <summary>
    /// The expanded [hand][action] strategy of a decision node on a bucketed
    /// artifact: the group's rows read through the node's bucket map.
    /// </summary>
    private async Task<float[]> DenseStrategyAsync(uint nodeId, CancellationToken ct)
    {
        if (_strategyCache.TryGetValue(nodeId, out var cached)) return cached;
        if (_strategyCache.Count >= CacheEntries) _strategyCache.Clear();
        var d = _decisionIndex[nodeId];
        if (d == uint.MaxValue) throw new KeyNotFoundException($"Node {nodeId} is not a decision node.");
        if (!_index.TryGetValue(_nodeGroup[d], out var range))
            throw new InvalidDataException("Bucketed artifact: missing group blob.");
        var blob = (await _source.ReadRangeAsync((long)range.Offset, (int)range.Length, ct)).ToArray();
        var numActions = BinaryPrimitives.ReadUInt16LittleEndian(blob.AsSpan(2));
        var rows = BinaryPrimitives.ReadUInt32LittleEndian(blob.AsSpan(8));
        var pos = 12;
        var rowStrategy = new float[rows * numActions];
        for (var r = 0; r < rows; r++)
        {
            var sum = 0.0f;
            for (var k = 0; k < numActions; k++)
            {
                float p;
                if (Header.StrategyU8) { p = blob[pos] / 255.0f; pos += 1; }
                else { p = BinaryPrimitives.ReadSingleLittleEndian(blob.AsSpan(pos)); pos += 4; }
                rowStrategy[r * numActions + k] = p;
                sum += p;
            }
            for (var k = 0; k < numActions; k++)
                rowStrategy[r * numActions + k] = sum > 0 ? rowStrategy[r * numActions + k] / sum : 1.0f / numActions;
        }
        var mapOffset = (int)(_nodeMap[d] * _mapHands);
        var dense = new float[_mapHands * numActions];
        for (var h = 0; h < _mapHands; h++)
            Array.Copy(rowStrategy, _maps[mapOffset + h] * numActions, dense, h * numActions, numActions);
        _strategyCache[nodeId] = dense;
        return dense;
    }

    /// <summary>
    /// Every seat's reach at a node under the average strategy: the root
    /// ranges times the actor's row at each decision ancestor, zeroed at each
    /// chance edge for hands holding the dealt card. What the per-hand export
    /// pass computes, derived here instead of stored.
    /// </summary>
    private async Task<float[][]> ReachAtAsync(uint nodeId, CancellationToken ct)
    {
        if (nodeId == 0) return _rootReach;
        if (_reachCache.TryGetValue(nodeId, out var cached)) return cached;
        var node = Nodes[(int)nodeId];
        var parent = Nodes[(int)node.ParentId];
        var parentReach = await ReachAtAsync(node.ParentId, ct);
        var reach = parentReach.Select(r => (float[])r.Clone()).ToArray();
        if (parent.IsChance)
        {
            var card = node.DealtCard;
            var nlhe = Metadata.HandUniverse == "nlhe_combos_1326";
            for (var s = 0; s < reach.Length; s++)
            {
                var dict = HandDicts[s];
                for (var h = 0; h < reach[s].Length; h++)
                {
                    if (nlhe)
                    {
                        var (hi, lo) = ComboCards(dict[h]);
                        if (hi == card || lo == card) reach[s][h] = 0.0f;
                    }
                    else if (dict[h] == card) reach[s][h] = 0.0f;
                }
            }
        }
        else if (parent.IsDecision)
        {
            var sigma = await DenseStrategyAsync(node.ParentId, ct);
            var k = (int)(nodeId - parent.FirstChild);
            int actions = parent.NumChildren;
            var mine = reach[parent.Actor];
            for (var h = 0; h < mine.Length; h++) mine[h] *= sigma[h * actions + k];
        }
        if (_reachCache.Count >= CacheEntries) _reachCache.Clear();
        _reachCache[nodeId] = reach;
        return reach;
    }

    /// <summary>
    /// Canonical 1326 combo order: pairs (hi, lo) with hi > lo, sorted by hi
    /// descending then lo descending (engine/docs/artifact-format.md).
    /// </summary>
    private static (int Hi, int Lo) ComboCards(int index)
    {
        var i = index;
        for (var hi = 51; hi >= 1; hi--)
        {
            if (i < hi) return (hi, hi - 1 - i);
            i -= hi;
        }
        throw new ArgumentOutOfRangeException(nameof(index));
    }

    private static int ComboClassIndex(int index)
    {
        var (hi, lo) = ComboCards(index);
        var rankHi = hi / 4;
        var rankLo = lo / 4;
        var suited = hi % 4 == lo % 4;
        // Grid rows/cols are A..2 descending: A = 0.
        var a = 12 - Math.Max(rankHi, rankLo);
        var b = 12 - Math.Min(rankHi, rankLo);
        if (rankHi == rankLo) return a * 13 + a;
        return suited ? a * 13 + b : b * 13 + a;
    }

    private async Task<ArtifactNodeData> ReadBucketedNodeAsync(uint nodeId, CancellationToken ct)
    {
        var node = Nodes[(int)nodeId];
        if (!node.IsDecision)
            throw new KeyNotFoundException($"Node {nodeId} has no blob (not a decision node?).");
        var reach = await ReachAtAsync(nodeId, ct);
        var dense = await DenseStrategyAsync(nodeId, ct);
        var numSeats = (ushort)reach.Length;
        var numActions = node.NumChildren;
        var actor = node.Actor;
        var seats = new ArtifactSeatData[numSeats];
        for (var s = 0; s < numSeats; s++)
        {
            var idx = new List<uint>();
            var r = new List<float>();
            for (var h = 0; h < reach[s].Length; h++)
            {
                if (reach[s][h] > SparseEps) { idx.Add((uint)h); r.Add(reach[s][h]); }
            }
            seats[s] = new ArtifactSeatData(idx.ToArray(), r.ToArray(), new float[idx.Count]);
        }
        var actorIdx = seats[actor].Idx;
        var strategy = new float[actorIdx.Length * numActions];
        for (var i = 0; i < actorIdx.Length; i++)
            Array.Copy(dense, (int)actorIdx[i] * numActions, strategy, i * numActions, numActions);
        var actionEv = new float[strategy.Length];

        float[]? rollupWeight = null;
        float[]? rollupEv = null;
        float[][]? rollupFreq = null;
        if (Metadata.HandUniverse == "nlhe_combos_1326")
        {
            rollupWeight = new float[169];
            rollupEv = new float[169];
            rollupFreq = new float[169][];
            var weight = new double[169];
            var freqSum = new double[169, numActions];
            var freqPlain = new double[169, numActions];
            var plainCount = new int[169];
            var dict = HandDicts[actor];
            for (var h = 0; h < reach[actor].Length; h++)
            {
                var cls = ComboClassIndex(dict[h]);
                double w = reach[actor][h];
                plainCount[cls]++;
                weight[cls] += w;
                for (var k = 0; k < numActions; k++)
                {
                    double p = dense[h * numActions + k];
                    freqSum[cls, k] += w * p;
                    freqPlain[cls, k] += p;
                }
            }
            for (var cls = 0; cls < 169; cls++)
            {
                rollupWeight[cls] = (float)weight[cls];
                rollupFreq[cls] = new float[numActions];
                for (var k = 0; k < numActions; k++)
                {
                    var freq = 0.0;
                    if (weight[cls] > 0) freq = freqSum[cls, k] / weight[cls];
                    else if (plainCount[cls] > 0) freq = freqPlain[cls, k] / plainCount[cls];
                    rollupFreq[cls][k] = (float)(Math.Round(freq * 10000.0) / 10000.0);
                }
            }
        }
        return new ArtifactNodeData(numSeats, numActions, actor, seats, strategy, actionEv,
                                    rollupWeight, rollupEv, rollupFreq);
    }

    private const float SparseEps = 1e-6f;

    private static ArtifactNodeRecord ParseNodeRecord(byte[] records, int start)
    {
        var r = records.AsSpan(start, NodeRecordSize);
        var commit = new int[9];
        for (var s = 0; s < 9; s++)
            commit[s] = BinaryPrimitives.ReadInt32LittleEndian(r[(40 + s * 4)..]);
        return new ArtifactNodeRecord(
            NodeId: BinaryPrimitives.ReadUInt32LittleEndian(r),
            ParentId: BinaryPrimitives.ReadUInt32LittleEndian(r[4..]),
            Kind: r[8], ActionKind: r[9], Street: r[10], TerminalKind: r[11],
            Actor: BinaryPrimitives.ReadUInt16LittleEndian(r[12..]),
            NumChildren: BinaryPrimitives.ReadUInt16LittleEndian(r[14..]),
            FirstChild: BinaryPrimitives.ReadUInt32LittleEndian(r[16..]),
            FoldWinner: BinaryPrimitives.ReadUInt16LittleEndian(r[20..]),
            DealtCard: BinaryPrimitives.ReadInt16LittleEndian(r[22..]),
            ActionAmount: BinaryPrimitives.ReadInt64LittleEndian(r[24..]),
            Pot: BinaryPrimitives.ReadInt64LittleEndian(r[32..]),
            Commit: commit);
    }

    public async Task<ArtifactNodeData> ReadNodeAsync(uint nodeId, CancellationToken ct = default)
    {
        if (Header.Bucketed) return await ReadBucketedNodeAsync(nodeId, ct);
        if (!_index.TryGetValue(nodeId, out var range))
            throw new KeyNotFoundException($"Node {nodeId} has no blob (not a decision node?).");
        var blob = (await _source.ReadRangeAsync((long)range.Offset, (int)range.Length, ct)).ToArray();
        var pos = 0;

        ushort U16() { var v = BinaryPrimitives.ReadUInt16LittleEndian(blob.AsSpan(pos)); pos += 2; return v; }
        uint U32() { var v = BinaryPrimitives.ReadUInt32LittleEndian(blob.AsSpan(pos)); pos += 4; return v; }
        float F32() { var v = BinaryPrimitives.ReadSingleLittleEndian(blob.AsSpan(pos)); pos += 4; return v; }
        float Ev() => Header.EvF16
            ? (float)BitConverter.UInt16BitsToHalf(U16())
            : F32();

        var numSeats = U16();
        var numActions = U16();
        var actor = U16();
        U16(); // reserved

        var counts = new uint[numSeats];
        for (var s = 0; s < numSeats; s++) counts[s] = U32();

        var seats = new ArtifactSeatData[numSeats];
        for (var s = 0; s < numSeats; s++)
        {
            var n = (int)counts[s];
            var idx = new uint[n];
            var reach = new float[n];
            var ev = new float[n];
            for (var i = 0; i < n; i++) idx[i] = U32();
            for (var i = 0; i < n; i++) reach[i] = F32();
            for (var i = 0; i < n; i++) ev[i] = Ev();
            seats[s] = new ArtifactSeatData(idx, reach, ev);
        }

        var actorCount = (int)counts[actor];
        var cells = actorCount * numActions;
        var strategy = new float[cells];
        for (var h = 0; h < actorCount; h++)
        {
            var sum = 0.0f;
            for (var k = 0; k < numActions; k++)
            {
                float p;
                if (Header.StrategyU8) { p = blob[pos] / 255.0f; pos += 1; }
                else p = F32();
                strategy[h * numActions + k] = p;
                sum += p;
            }
            // Quantized rows renormalize to sum 1; all-zero rows become uniform.
            for (var k = 0; k < numActions; k++)
            {
                strategy[h * numActions + k] = sum > 0
                    ? strategy[h * numActions + k] / sum
                    : 1.0f / numActions;
            }
        }
        var actionEv = new float[cells];
        for (var i = 0; i < cells; i++) actionEv[i] = Ev();

        float[]? rollupWeight = null;
        float[]? rollupEv = null;
        float[][]? rollupFreq = null;
        if (Header.HasRollups)
        {
            rollupWeight = new float[169];
            rollupEv = new float[169];
            rollupFreq = new float[169][];
            for (var cls = 0; cls < 169; cls++)
            {
                rollupWeight[cls] = F32();
                rollupEv[cls] = F32();
                rollupFreq[cls] = new float[numActions];
                for (var k = 0; k < numActions; k++)
                    rollupFreq[cls][k] = U16() / 10000.0f;
            }
        }

        return new ArtifactNodeData(numSeats, numActions, actor, seats, strategy, actionEv,
                                    rollupWeight, rollupEv, rollupFreq);
    }
}
