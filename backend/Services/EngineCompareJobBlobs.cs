// Services/EngineCompareJobBlobs.cs
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage.Blobs;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Models;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Deleting a compare job's result blobs, shared by the owner's DELETE and
    /// the watcher's supersede-on-report so the two can never disagree about
    /// which paths a job owns.
    /// </summary>
    public static class EngineCompareJobBlobs
    {
        public static BlobContainerClient? Container(IConfiguration config)
        {
            var connectionString = config["AzureStorage:ConnectionString"];
            if (string.IsNullOrWhiteSpace(connectionString)) return null;
            var containerName = config["AzureStorage:ContainerName"] ?? "onlinerangedata";
            return new BlobServiceClient(connectionString).GetBlobContainerClient(containerName);
        }

        /// <summary>
        /// Remove every result blob the job points at. Already-missing is
        /// success: the point is that it is gone. A null container (no storage
        /// configured) deletes nothing and is not an error, so a row can still
        /// be removed in a storage-less environment.
        /// </summary>
        public static async Task DeleteAsync(BlobContainerClient? container, EngineCompareJob job,
                                             CancellationToken ct = default)
        {
            if (container == null) return;
            foreach (var path in new[] { job.HtResultBlobPath, job.PioResultBlobPath, job.ResultBlobPath })
            {
                if (string.IsNullOrEmpty(path)) continue;
                await container.GetBlobClient(path).DeleteIfExistsAsync(cancellationToken: ct);
            }
        }
    }
}
