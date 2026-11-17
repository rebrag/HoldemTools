// Services/GameTreeCoordinates.cs
namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// The library coordinates (stacks, node_name) a gametree blob publishes
    /// under. Both watchers derive them from the blob path alone
    /// (watcher/extraction.py parse_gametree_path, with the "nostacks" /
    /// "nonode" fallbacks of watch_adls_and_run_pio_headless.py), so the API
    /// can compute exactly the same values when the job is inserted rather
    /// than waiting for the Done report. Keep the two in lockstep.
    /// </summary>
    public static class GameTreeCoordinates
    {
        public const string NoStacks = "nostacks";
        public const string NoNode = "nonode";

        /// <summary>
        /// "gametrees/yyyy/MM/dd/uid/folder=STACKS/NAME.json" -> ("STACKS", "NAME").
        /// stacks is the first "folder=" segment; node_name is the last
        /// segment minus a ".json" suffix.
        /// </summary>
        public static (string Stacks, string NodeName) FromBlobPath(string blobPath)
        {
            var parts = (blobPath ?? "").Split('/');

            string? stacks = null;
            foreach (var p in parts)
            {
                if (p.StartsWith("folder=", System.StringComparison.Ordinal))
                {
                    stacks = p["folder=".Length..];
                    break;
                }
            }

            var nodeFile = parts.Length > 0 ? parts[^1] : "";
            var nodeName = nodeFile.EndsWith(".json", System.StringComparison.Ordinal)
                ? nodeFile[..^".json".Length]
                : nodeFile;

            // Python's `x or "fallback"`: an empty string falls back too.
            return (string.IsNullOrEmpty(stacks) ? NoStacks : stacks,
                    string.IsNullOrEmpty(nodeName) ? NoNode : nodeName);
        }
    }
}
