using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;

namespace PokerRangeAPI2.Services.EngineArtifacts;

/// <summary>
/// Dev-only local directory of engine-exported solutions, laid out exactly
/// like the blob container (piosolutions/..., piosolutions-index.json).
/// Enabled by setting Engine:LocalSolutionsDir - never set it on a deployed
/// instance; production always reads ADLS only. When enabled, FilesController
/// checks this directory before ADLS so the frontend cannot tell an engine
/// solve from a Pio one.
/// </summary>
public sealed class EngineLocalSolutions
{
    private readonly string? _root;

    public EngineLocalSolutions(IConfiguration configuration)
    {
        var dir = configuration["Engine:LocalSolutionsDir"];
        _root = string.IsNullOrWhiteSpace(dir) ? null : Path.GetFullPath(dir);
    }

    public bool Enabled => _root != null;
    public string? Root => _root;

    /// <summary>Resolve a container-relative path, refusing escapes.</summary>
    private string? Resolve(string relativePath)
    {
        if (_root == null) return null;
        var full = Path.GetFullPath(Path.Combine(_root, relativePath));
        if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase)) return null;
        return full;
    }

    public string? TryReadText(string relativePath)
    {
        var path = Resolve(relativePath);
        return path != null && File.Exists(path) ? File.ReadAllText(path) : null;
    }

    public byte[]? TryReadBytes(string relativePath)
    {
        var path = Resolve(relativePath);
        return path != null && File.Exists(path) ? File.ReadAllBytes(path) : null;
    }

    /// <summary>
    /// Merge locally exported index entries into the shared blob index JSON
    /// (local entries win on the (stacks, node_name, board) key).
    /// </summary>
    public string MergeIndex(string? blobIndexJson)
    {
        var localJson = TryReadText("piosolutions-index.json");
        if (localJson == null) return blobIndexJson ?? """{"schema":2,"entries":[]}""";
        return MergeIndexJson(blobIndexJson, localJson);
    }

    /// <summary>
    /// Pure JSON merge of two solutions indexes: overlay entries win on the
    /// (stacks, node_name, board) key. Also used to fold the engine solutions
    /// index blob into the shared piosolutions index at read time.
    /// </summary>
    public static string MergeIndexJson(string? baseJson, string overlayJson)
    {
        if (baseJson == null) return overlayJson;

        var merged = JsonNode.Parse(baseJson)!.AsObject();
        var overlay = JsonNode.Parse(overlayJson)!.AsObject();
        var entries = merged["entries"]?.AsArray() ?? new JsonArray();

        static string Key(JsonObject e) =>
            $"{e["stacks"]}|{e["node_name"]}|{e["board"]}";

        var overlayKeys = overlay["entries"]!.AsArray()
            .Select(e => Key(e!.AsObject())).ToHashSet();
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            if (overlayKeys.Contains(Key(entries[i]!.AsObject()))) entries.RemoveAt(i);
        }
        foreach (var entry in overlay["entries"]!.AsArray().ToArray())
        {
            entry!.Parent!.AsArray().Remove(entry);
            entries.Add(entry);
        }
        merged["entries"] = entries;
        return merged.ToJsonString();
    }
}
