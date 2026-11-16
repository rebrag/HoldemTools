// Services/SolveStorage.cs
using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Storage.Files.DataLake;
using Azure.Storage.Queues;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Models;

namespace PokerRangeAPI2.Services
{
    // The ADLS and Storage Queue calls the solve-job controllers make, behind
    // interfaces so the controllers stay constructible in the EF-InMemory test
    // suite without Azure configuration. Each ADLS implementation makes
    // exactly the calls its controller made inline before, in the same order.

    /// <summary>Writes uploaded gametree blobs.</summary>
    public interface IGameTreeBlobStore
    {
        /// <summary>Write <paramref name="bytes"/> to {dirPath}/{fileName}, overwriting.</summary>
        Task UploadAsync(string dirPath, string fileName, byte[] bytes);
    }

    public sealed class AdlsGameTreeBlobStore : IGameTreeBlobStore
    {
        private readonly DataLakeServiceClient _client;
        private readonly string _containerName;

        public AdlsGameTreeBlobStore(IConfiguration configuration)
        {
            var connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");
            _client = new DataLakeServiceClient(connectionString);
        }

        public async Task UploadAsync(string dirPath, string fileName, byte[] bytes)
        {
            var fs = _client.GetFileSystemClient(_containerName);
            await fs.CreateIfNotExistsAsync();
            var dir = fs.GetDirectoryClient(dirPath);
            await dir.CreateIfNotExistsAsync();
            using var ms = new MemoryStream(bytes);
            await dir.GetFileClient(fileName).UploadAsync(ms, overwrite: true);
        }
    }

    /// <summary>The storage a node request touches: the board's manifest and the Pio request blob.</summary>
    public interface INodeRequestStore
    {
        /// <summary>
        /// The solver a published board's manifest names (manifest.engine.solver),
        /// or null when the manifest is missing, unreadable or names none - which
        /// is every Pio board.
        /// </summary>
        Task<string?> ReadManifestSolverAsync(string stacks, string nodeName, string board, CancellationToken ct);

        /// <summary>Write the Pio watcher's request blob at {dirPath}/{fileName}.</summary>
        Task WriteRequestBlobAsync(string dirPath, string fileName, string json);
    }

    public sealed class AdlsNodeRequestStore : INodeRequestStore
    {
        private readonly DataLakeServiceClient _client;
        private readonly string _containerName;

        public AdlsNodeRequestStore(IConfiguration configuration)
        {
            var connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";
            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");
            _client = new DataLakeServiceClient(connectionString);
        }

        public async Task<string?> ReadManifestSolverAsync(
            string stacks, string nodeName, string board, CancellationToken ct)
        {
            var file = _client.GetFileSystemClient(_containerName)
                .GetFileClient($"piosolutions/{stacks}/{nodeName}/{board}/manifest.json");
            try
            {
                var content = await file.ReadContentAsync(ct);
                return ManifestSolver.Parse(content.Value.Content.ToString());
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return null;
            }
        }

        public async Task WriteRequestBlobAsync(string dirPath, string fileName, string json)
        {
            var fs = _client.GetFileSystemClient(_containerName);
            await fs.CreateIfNotExistsAsync();
            var dir = fs.GetDirectoryClient(dirPath);
            await dir.CreateIfNotExistsAsync();
            var file = dir.GetFileClient(fileName);
            await file.UploadAsync(BinaryData.FromString(json).ToStream(), overwrite: true);
        }
    }

    /// <summary>Reads the solver block a manifest carries.</summary>
    public static class ManifestSolver
    {
        /// <summary>
        /// manifest.engine.solver normalized, or null when absent or the text is
        /// not a JSON object. A manifest without engine.solver is a Pio board.
        /// </summary>
        public static string? Parse(string manifestJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(manifestJson);
                if (doc.RootElement.ValueKind == JsonValueKind.Object
                    && doc.RootElement.TryGetProperty("engine", out var engine)
                    && engine.ValueKind == JsonValueKind.Object
                    && engine.TryGetProperty("solver", out var solver)
                    && solver.ValueKind == JsonValueKind.String)
                {
                    return SolveJobSolver.Normalize(solver.GetString());
                }
                return null;
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

    /// <summary>
    /// The htsolver worker's node-request queue
    /// (AzureStorage:HtNodeRequestQueueName, default "noderequests-htsolver").
    /// A distinct type so it cannot be confused with the Pio watcher's
    /// QueueClient in DI. Messages are raw UTF-8 JSON (the SDK default of no
    /// Base64), the same encoding as the Pio queue.
    /// </summary>
    public class HtNodeRequestQueue
    {
        public const string DefaultName = "noderequests-htsolver";

        private readonly QueueClient _client;

        public HtNodeRequestQueue(QueueClient client)
        {
            _client = client;
        }

        public QueueClient Client => _client;

        /// <summary>
        /// Enqueue one message. If the queue does not exist (startup creation
        /// failed, or it was deleted), create it and retry once. Throws when
        /// the message could not be enqueued.
        /// </summary>
        public virtual async Task SendAsync(string messageJson, CancellationToken ct)
        {
            try
            {
                await _client.SendMessageAsync(messageJson, ct);
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                await _client.CreateIfNotExistsAsync(cancellationToken: ct);
                await _client.SendMessageAsync(messageJson, ct);
            }
        }
    }
}
