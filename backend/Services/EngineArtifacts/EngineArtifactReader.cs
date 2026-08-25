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

    public ArtifactHeader Header { get; private set; } = null!;
    public ArtifactMetadata Metadata { get; private set; } = null!;
    public IReadOnlyList<ArtifactNodeRecord> Nodes { get; private set; } = null!;
    public IReadOnlyList<ushort[]> HandDicts { get; private set; } = null!;
    public IReadOnlyCollection<uint> DecisionNodeIds => _index.Keys;

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
    }

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
