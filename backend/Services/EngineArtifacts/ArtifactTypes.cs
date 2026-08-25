using System.Text.Json;

namespace PokerRangeAPI2.Services.EngineArtifacts;

// Typed views over the .hta binary artifact. The byte layout is defined by
// engine/docs/artifact-format.md (format version 1); any change there moves
// this reader, the C++ writer/reader, and the committed fixture together.

public sealed record ArtifactHeader(uint Version, uint Flags, ulong MetaOffset, ulong MetaLength,
                                    ulong IndexOffset, ulong IndexLength)
{
    public bool StrategyU8 => (Flags & 1u) != 0;
    public bool EvF16 => (Flags & 2u) != 0;
    public bool HasRollups => (Flags & 4u) != 0;
}

public sealed record ArtifactNodeRecord(
    uint NodeId, uint ParentId, byte Kind, byte ActionKind, byte Street, byte TerminalKind,
    ushort Actor, ushort NumChildren, uint FirstChild, ushort FoldWinner, short DealtCard,
    long ActionAmount, long Pot, int[] Commit)
{
    public bool IsDecision => Kind == 0;
    public bool IsChance => Kind == 1;
    public bool IsTerminal => Kind == 2;
}

public sealed record ArtifactSeatData(uint[] Idx, float[] Reach, float[] Ev);

/// <summary>
/// Decoded per-node data: sparse per-hand arrays indexed via each seat's
/// hand dictionary, with strategy dequantized and rows renormalized to sum 1.
/// </summary>
public sealed record ArtifactNodeData(
    ushort NumSeats, ushort NumActions, ushort Actor,
    ArtifactSeatData[] Seats,
    float[] Strategy,   // actor rows [hand][action]
    float[] ActionEv,   // actor rows [hand][action]
    float[]? RollupWeight,      // [169] when rollups present
    float[]? RollupEv,          // [169]
    float[][]? RollupFreq);     // [169][action]

public sealed record ArtifactMetadata(JsonElement Root)
{
    public string Mode => Root.GetProperty("mode").GetString() ?? "nash";
    public string Board => Root.TryGetProperty("board", out var b) ? b.GetString() ?? "" : "";
    public double ChipScale => Root.TryGetProperty("chip_scale", out var c) ? c.GetDouble() : 100.0;
    public long Pot => Root.TryGetProperty("pot", out var p) ? p.GetInt64() : 0;
    public ulong Iterations => Root.GetProperty("iterations").GetUInt64();
    public double FinalNashConv => Root.GetProperty("final_nashconv").GetDouble();
    public string HandUniverse => Root.TryGetProperty("hand_universe", out var u) ? u.GetString() ?? "" : "";
    public string ConfigHash => Root.GetProperty("config_hash").GetString() ?? "";
}
