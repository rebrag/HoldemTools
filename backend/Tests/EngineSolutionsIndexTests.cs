// Tests/EngineSolutionsIndexTests.cs
using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Memory;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    public class EngineSolutionsIndexTests
    {
        private static JsonObject Entry(string board = "QhJhTh", int turns = 0) =>
            EngineSolutionsIndex.SanitizeEntry(
                new JsonObject { ["flop_nodes"] = 8, ["turn_streets"] = turns, ["cfr_available"] = true },
                "40-27.5", "node-a", board, "htsolver");

        [Fact]
        public async Task Upsert_CreatesTheIndex_WhenAbsent()
        {
            var store = new InMemoryEngineIndexBlobStore();
            await EngineIndexFactory.New(store).UpsertAsync(Entry(), CancellationToken.None);

            var index = JsonNode.Parse(store.Json!)!;
            Assert.Equal(2, index["schema"]!.GetValue<int>());
            Assert.NotNull(index["updated_utc"]);
            var entry = Assert.Single(index["entries"]!.AsArray())!;
            Assert.Equal("QhJhTh", entry["board"]!.GetValue<string>());
        }

        [Fact]
        public async Task Upsert_MergesIntoTheExistingEntry_AndKeepsOthers()
        {
            var store = new InMemoryEngineIndexBlobStore();
            var index = EngineIndexFactory.New(store);
            await index.UpsertAsync(Entry("AsKdQc"), CancellationToken.None);
            await index.UpsertAsync(Entry(turns: 0), CancellationToken.None);

            // Flop-ready first, the full sweep later: one entry, newer fields win.
            var partial = new JsonObject
            {
                ["stacks"] = "40-27.5", ["node_name"] = "node-a", ["board"] = "QhJhTh", ["turn_streets"] = 196,
            };
            await index.UpsertAsync(partial, CancellationToken.None);

            var entries = store.Entries();
            Assert.Equal(2, entries.Count);
            var merged = entries.Single(e => e!["board"]!.GetValue<string>() == "QhJhTh")!;
            Assert.Equal(196, merged["turn_streets"]!.GetValue<int>());
            Assert.Equal(8, merged["flop_nodes"]!.GetValue<int>()); // survived the partial
        }

        [Fact]
        public async Task Upsert_RetriesOnAnETagConflict_AndKeepsTheCompetingWrite()
        {
            var store = new InMemoryEngineIndexBlobStore();
            var index = EngineIndexFactory.New(store);
            await index.UpsertAsync(Entry("AsKdQc"), CancellationToken.None);

            // Another instance lands a different board between our read and write.
            store.BeforeWrite = s =>
            {
                var other = JsonNode.Parse(s.Json!)!.AsObject();
                other["entries"]!.AsArray().Add(new JsonObject
                {
                    ["stacks"] = "x", ["node_name"] = "y", ["board"] = "2c3d4h",
                });
                s.Set(other.ToJsonString());
            };
            await index.UpsertAsync(Entry("QhJhTh"), CancellationToken.None);

            Assert.Equal(1, store.Conflicts);
            var boards = store.Entries().Select(e => e!["board"]!.GetValue<string>()).OrderBy(b => b).ToArray();
            Assert.Equal(new[] { "2c3d4h", "AsKdQc", "QhJhTh" }, boards);
        }

        [Fact]
        public async Task Upsert_CreateOnly_LosesToAConcurrentCreate_ThenMerges()
        {
            var store = new InMemoryEngineIndexBlobStore();
            store.BeforeWrite = s => s.Set(new JsonObject
            {
                ["schema"] = 2,
                ["entries"] = new JsonArray(new JsonObject { ["stacks"] = "x", ["node_name"] = "y", ["board"] = "2c3d4h" }),
            }.ToJsonString());

            await EngineIndexFactory.New(store).UpsertAsync(Entry(), CancellationToken.None);

            Assert.Equal(1, store.Conflicts);
            Assert.Equal(2, store.Entries().Count);
        }

        private sealed class ForeverConflictingStore : IEngineIndexBlobStore
        {
            public int Writes;
            public Task<(string? Json, string? ETag)> ReadAsync(CancellationToken ct) =>
                Task.FromResult<(string?, string?)>(("{\"schema\":2,\"entries\":[]}", "\"v1\""));
            public Task<bool> TryWriteAsync(string json, string? etag, CancellationToken ct)
            {
                Writes++;
                return Task.FromResult(false);
            }
        }

        [Fact]
        public async Task Upsert_GivesUpAfterABoundedNumberOfAttempts()
        {
            var store = new ForeverConflictingStore();
            var index = new EngineSolutionsIndex(store, new MemoryCache(new MemoryCacheOptions()));
            await Assert.ThrowsAsync<EngineIndexConflictException>(() => index.UpsertAsync(Entry(), CancellationToken.None));
            Assert.Equal(EngineSolutionsIndex.MaxAttempts, store.Writes);
        }

        [Fact]
        public async Task Upsert_RefusesToOverwriteAnUnparseableIndex()
        {
            var store = new InMemoryEngineIndexBlobStore();
            store.Set("{ not json");
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => EngineIndexFactory.New(store).UpsertAsync(Entry(), CancellationToken.None));
            Assert.Equal("{ not json", store.Json);
        }

        [Fact]
        public async Task Upsert_EvictsTheFilesControllerCacheEntry()
        {
            var cache = new MemoryCache(new MemoryCacheOptions());
            cache.Set(EngineSolutionsIndex.CacheKey, "stale");
            await EngineIndexFactory.New(new InMemoryEngineIndexBlobStore(), cache)
                .UpsertAsync(Entry(), CancellationToken.None);
            Assert.False(cache.TryGetValue(EngineSolutionsIndex.CacheKey, out _));
        }

        [Fact]
        public void SanitizeEntry_ForcesCoordinates_AndWhitelistsFields()
        {
            var raw = new JsonObject
            {
                ["stacks"] = "other-stacks",
                ["node_name"] = "other-node",
                ["board"] = "2c3d4h",
                ["preflop_line"] = new JsonArray("Root", "Call"),
                ["alive_positions"] = new JsonArray("SB", "BTN"),
                ["icm"] = false,
                ["created_utc"] = "2026-11-16T10:00:00+00:00",
                ["flop_nodes"] = 8,
                ["turn_streets"] = 196,
                ["cfr_available"] = true,
                ["solver"] = "pio",
                ["source"] = "handHistory",   // the overlay's field, never stored
                ["hand_history_id"] = 1,
            };

            var entry = EngineSolutionsIndex.SanitizeEntry(raw, "40-27.5", "node-a", "QhJhTh", "htsolver");

            Assert.Equal("40-27.5", entry["stacks"]!.GetValue<string>());
            Assert.Equal("node-a", entry["node_name"]!.GetValue<string>());
            Assert.Equal("QhJhTh", entry["board"]!.GetValue<string>());
            Assert.Equal("htsolver", entry["solver"]!.GetValue<string>());
            Assert.Equal(
                new[] { "stacks", "node_name", "board", "preflop_line", "alive_positions", "icm",
                        "created_utc", "flop_nodes", "turn_streets", "cfr_available", "solver" },
                entry.Select(p => p.Key).ToArray());
        }

        [Fact]
        public void SanitizeEntry_DropsBadlyTypedFields()
        {
            var raw = new JsonObject
            {
                ["preflop_line"] = "Root",                            // not a list
                ["alive_positions"] = new JsonArray("SB", "<script>"), // bad label
                ["icm"] = "no",
                ["created_utc"] = new string('x', 100),
                ["flop_nodes"] = -1,
                ["turn_streets"] = 1.5,
                ["cfr_available"] = 1,
            };
            var entry = EngineSolutionsIndex.SanitizeEntry(raw, "s", "n", "QhJhTh", "htsolver");
            Assert.Equal(new[] { "stacks", "node_name", "board", "solver" }, entry.Select(p => p.Key).ToArray());
        }
    }
}
