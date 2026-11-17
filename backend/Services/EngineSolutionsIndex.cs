// Services/EngineSolutionsIndex.cs
using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Models;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Raw access to the enginesolutions-index.json blob with optimistic
    /// concurrency. Behind an interface so the index service is testable
    /// against an in-memory blob, conflicts included.
    /// </summary>
    public interface IEngineIndexBlobStore
    {
        /// <summary>The blob's text and ETag, or (null, null) when it does not exist.</summary>
        Task<(string? Json, string? ETag)> ReadAsync(CancellationToken ct);

        /// <summary>
        /// Write the blob only if it is unchanged since the read that returned
        /// <paramref name="etag"/> (If-Match), or, with a null etag, only if it
        /// still does not exist (If-None-Match: *). False when that condition
        /// fails because another writer got there first.
        /// </summary>
        Task<bool> TryWriteAsync(string json, string? etag, CancellationToken ct);
    }

    public interface IEngineSolutionsIndex
    {
        /// <summary>
        /// Insert or merge one library entry, keyed on (stacks, node_name,
        /// board). The caller passes an entry already built by
        /// <see cref="EngineSolutionsIndex.SanitizeEntry"/>.
        /// </summary>
        Task UpsertAsync(JsonObject entry, CancellationToken ct);
    }

    /// <summary>Thrown when the index could not be written after every retry.</summary>
    public sealed class EngineIndexConflictException : Exception
    {
        public EngineIndexConflictException(string message) : base(message) { }
    }

    /// <summary>
    /// The single writer of enginesolutions-index.json, the htsolver half of
    /// the solved-flops library (merged into piosolutions-index.json at read
    /// time by FilesController, so the Pio watcher stays the only writer of
    /// its own index). Used by both the SolveJobs report path and the
    /// /compare publish path.
    ///
    /// Read-modify-write under an ETag condition with a bounded retry loop:
    /// correct across App Service instances, where an in-process lock is not.
    /// </summary>
    public sealed class EngineSolutionsIndex : IEngineSolutionsIndex
    {
        public const string BlobName = "enginesolutions-index.json";

        /// <summary>The FilesController memory-cache key for this blob's text.</summary>
        public const string CacheKey = "enginesolutions:index";

        public const int MaxAttempts = 8;

        private readonly IEngineIndexBlobStore _store;
        private readonly IMemoryCache _cache;

        public EngineSolutionsIndex(IEngineIndexBlobStore store, IMemoryCache cache)
        {
            _store = store;
            _cache = cache;
        }

        public async Task UpsertAsync(JsonObject entry, CancellationToken ct)
        {
            var key = Key(entry);
            for (var attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                var (json, etag) = await _store.ReadAsync(ct);
                var index = ParseIndex(json);
                var entries = index["entries"]!.AsArray();

                var existing = entries.OfType<JsonObject>().FirstOrDefault(e => Key(e) == key);
                if (existing != null)
                {
                    // Merge, the same rule as the Pio watcher's
                    // upsert_library_index: fields this entry does not carry
                    // survive, fields it carries win.
                    foreach (var (name, value) in entry)
                        existing[name] = value?.DeepClone();
                }
                else
                {
                    entries.Add(entry.DeepClone());
                }
                index["updated_utc"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'");

                if (await _store.TryWriteAsync(index.ToJsonString(), etag, ct))
                {
                    _cache.Remove(CacheKey);
                    return;
                }

                // Lost the race: back off a little (with jitter, so two
                // writers do not collide in lockstep) and re-read.
                if (attempt < MaxAttempts)
                    await Task.Delay(TimeSpan.FromMilliseconds(25 * attempt + Random.Shared.Next(25)), ct);
            }
            throw new EngineIndexConflictException(
                $"{BlobName} kept changing underneath {MaxAttempts} upsert attempts.");
        }

        private static JsonObject ParseIndex(string? json)
        {
            if (json == null)
                return new JsonObject { ["schema"] = 2, ["entries"] = new JsonArray() };

            // A blob that exists but does not parse is never overwritten with a
            // fresh index: that would silently drop every published board.
            JsonObject index;
            try
            {
                index = JsonNode.Parse(json) as JsonObject
                    ?? throw new InvalidOperationException($"{BlobName} is not a JSON object.");
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException($"{BlobName} is not valid JSON.", ex);
            }
            if (index["entries"] is not JsonArray)
                index["entries"] = new JsonArray();
            return index;
        }

        private static string Key(JsonObject e) =>
            $"{Str(e, "stacks")}\n{Str(e, "node_name")}\n{Str(e, "board")}";

        private static string Str(JsonObject e, string prop) =>
            e[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

        // ---------------- entry whitelist ----------------

        private static readonly Regex LabelRe = new(@"^[A-Za-z0-9+]{1,16}$", RegexOptions.Compiled);
        private const int MaxListItems = 32;
        private const int MaxItemChars = 64;

        /// <summary>
        /// Rebuild a library entry from a whitelist. stacks, node_name and
        /// board are FORCED to the caller's own coordinates (the job's), so a
        /// watcher can never write another board's entry; every other field
        /// is kept only when it has the expected type and bounds, and dropped
        /// otherwise. Accepts the watcher's raw JSON or a node the API built.
        /// </summary>
        public static JsonObject SanitizeEntry(
            JsonNode? raw, string stacks, string nodeName, string board, string solver)
        {
            var entry = new JsonObject
            {
                ["stacks"] = stacks,
                ["node_name"] = nodeName,
                ["board"] = board,
            };
            var src = raw as JsonObject ?? new JsonObject();

            if (StringList(src["preflop_line"]) is { } line) entry["preflop_line"] = line;
            if (StringList(src["alive_positions"], LabelRe) is { } alive) entry["alive_positions"] = alive;
            if (Bool(src["icm"]) is { } icm) entry["icm"] = icm;
            if (Text(src["created_utc"], 40) is { } created) entry["created_utc"] = created;
            if (Count(src["flop_nodes"]) is { } flopNodes) entry["flop_nodes"] = flopNodes;
            if (Count(src["turn_streets"]) is { } turns) entry["turn_streets"] = turns;
            if (Bool(src["cfr_available"]) is { } cfr) entry["cfr_available"] = cfr;
            entry["solver"] = solver;
            return entry;
        }

        public static JsonObject SanitizeEntry(
            JsonElement raw, string stacks, string nodeName, string board, string solver) =>
            SanitizeEntry(
                raw.ValueKind == JsonValueKind.Object ? JsonNode.Parse(raw.GetRawText()) : null,
                stacks, nodeName, board, solver);

        private static bool? Bool(JsonNode? n) =>
            n is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

        private static string? Text(JsonNode? n, int max) =>
            n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length <= max ? s : null;

        private static int? Count(JsonNode? n)
        {
            if (n is not JsonValue v) return null;
            if (v.TryGetValue<int>(out var i)) return i >= 0 ? i : null;
            if (v.TryGetValue<double>(out var d) && d == Math.Floor(d) && d >= 0 && d <= int.MaxValue)
                return (int)d;
            if (v.TryGetValue<JsonElement>(out var el) && el.ValueKind == JsonValueKind.Number
                && el.TryGetInt32(out var e) && e >= 0)
                return e;
            return null;
        }

        private static JsonArray? StringList(JsonNode? n, Regex? itemRe = null)
        {
            if (n is not JsonArray arr || arr.Count > MaxListItems) return null;
            var outList = new JsonArray();
            foreach (var item in arr)
            {
                var s = Text(item, MaxItemChars);
                if (s == null || (itemRe != null && !itemRe.IsMatch(s))) return null;
                outList.Add(s);
            }
            return outList;
        }
    }

    /// <summary>The Azure Blob implementation, with real ETag conditions.</summary>
    public sealed class AzureEngineIndexBlobStore : IEngineIndexBlobStore
    {
        private readonly BlobClient _blob;

        public AzureEngineIndexBlobStore(IConfiguration configuration)
        {
            var connectionString = configuration["AzureStorage:ConnectionString"];
            var containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");
            _blob = new BlobServiceClient(connectionString)
                .GetBlobContainerClient(containerName)
                .GetBlobClient(EngineSolutionsIndex.BlobName);
        }

        public async Task<(string? Json, string? ETag)> ReadAsync(CancellationToken ct)
        {
            try
            {
                var result = await _blob.DownloadContentAsync(ct);
                return (result.Value.Content.ToString(), result.Value.Details.ETag.ToString());
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return (null, null);
            }
        }

        public async Task<bool> TryWriteAsync(string json, string? etag, CancellationToken ct)
        {
            var conditions = etag == null
                ? new BlobRequestConditions { IfNoneMatch = ETag.All }
                : new BlobRequestConditions { IfMatch = new ETag(etag) };
            try
            {
                await _blob.UploadAsync(BinaryData.FromString(json),
                    new BlobUploadOptions { Conditions = conditions }, ct);
                return true;
            }
            // 412: If-Match failed. 409: If-None-Match * met an existing blob.
            catch (RequestFailedException ex) when (ex.Status == 412 || ex.Status == 409)
            {
                return false;
            }
        }
    }
}
