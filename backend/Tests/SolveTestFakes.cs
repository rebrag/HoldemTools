// Tests/SolveTestFakes.cs
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Storage.Queues;
using Azure.Storage.Queues.Models;
using Microsoft.Extensions.Caching.Memory;
using PokerRangeAPI2.Services;

namespace HoldemToolsAPI.Tests
{
    /// <summary>
    /// enginesolutions-index.json in memory, with real ETag semantics: every
    /// successful write mints a new ETag, If-Match fails on a stale one, and a
    /// create-only write fails once the blob exists. <see cref="BeforeWrite"/>
    /// lets a test slip in a competing writer between a read and a write.
    /// </summary>
    public sealed class InMemoryEngineIndexBlobStore : IEngineIndexBlobStore
    {
        private int _version;
        public string? Json { get; private set; }
        public string? ETag => Json == null ? null : $"\"v{_version}\"";
        public int Writes { get; private set; }
        public int Conflicts { get; private set; }
        public System.Action<InMemoryEngineIndexBlobStore>? BeforeWrite { get; set; }

        public Task<(string? Json, string? ETag)> ReadAsync(CancellationToken ct) =>
            Task.FromResult((Json, ETag));

        public Task<bool> TryWriteAsync(string json, string? etag, CancellationToken ct)
        {
            var hook = BeforeWrite;
            BeforeWrite = null; // one competing writer per arming
            hook?.Invoke(this);

            var ok = etag == null ? Json == null : etag == ETag;
            if (!ok)
            {
                Conflicts++;
                return Task.FromResult(false);
            }
            Set(json);
            return Task.FromResult(true);
        }

        /// <summary>An unconditional write, as another writer would make it.</summary>
        public void Set(string json)
        {
            Json = json;
            _version++;
            Writes++;
        }

        public JsonArray Entries() => (JsonArray)JsonNode.Parse(Json!)!["entries"]!;
    }

    public static class EngineIndexFactory
    {
        public static EngineSolutionsIndex New(InMemoryEngineIndexBlobStore store, IMemoryCache? cache = null) =>
            new(store, cache ?? new MemoryCache(new MemoryCacheOptions()));

        public static EngineSolutionsIndex New() => New(new InMemoryEngineIndexBlobStore());
    }

    public sealed class FakeGameTreeBlobStore : IGameTreeBlobStore
    {
        public List<(string Path, byte[] Bytes)> Uploads { get; } = new();

        public Task UploadAsync(string dirPath, string fileName, byte[] bytes)
        {
            Uploads.Add(($"{dirPath}/{fileName}", bytes));
            return Task.CompletedTask;
        }
    }

    public sealed class FakeNodeRequestStore : INodeRequestStore
    {
        /// <summary>The solver each manifest names, keyed "stacks/node/board"; absent = no manifest.</summary>
        public Dictionary<string, string?> ManifestSolvers { get; } = new();
        public bool ThrowOnRead { get; set; }
        public List<(string Path, string Json)> Blobs { get; } = new();

        public Task<string?> ReadManifestSolverAsync(string stacks, string nodeName, string board, CancellationToken ct)
        {
            if (ThrowOnRead) throw new RequestFailedException(500, "storage unavailable");
            return Task.FromResult(ManifestSolvers.TryGetValue($"{stacks}/{nodeName}/{board}", out var s) ? s : null);
        }

        public Task WriteRequestBlobAsync(string dirPath, string fileName, string json)
        {
            Blobs.Add(($"{dirPath}/{fileName}", json));
            return Task.CompletedTask;
        }
    }

    /// <summary>A QueueClient that records messages instead of sending them.</summary>
    public sealed class FakeQueueClient : QueueClient
    {
        public List<string> Messages { get; } = new();
        public bool Fail { get; set; }

        private Task<Response<SendReceipt>> Record(string text)
        {
            if (Fail) throw new RequestFailedException(500, "queue unavailable");
            Messages.Add(text);
            return Task.FromResult<Response<SendReceipt>>(null!);
        }

        public override Task<Response<SendReceipt>> SendMessageAsync(string messageText) => Record(messageText);

        public override Task<Response<SendReceipt>> SendMessageAsync(string messageText, CancellationToken cancellationToken) =>
            Record(messageText);
    }
}
