// Services/PlayerPhotoStore.cs
using Azure;
using Azure.Storage.Files.DataLake;
using Microsoft.Extensions.Configuration;
using System;
using System.IO;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Services
{
    // Blob storage for player photos, abstracted behind an interface so
    // PlayersController stays constructible in the EF-InMemory test suite
    // without Azure configuration (the tests inject an in-memory fake).
    public interface IPlayerPhotoStore
    {
        Task SaveAsync(string path, Stream content);

        // Null when the blob does not exist (deleted out-of-band).
        Task<Stream?> OpenReadAsync(string path);

        // Best-effort: a missing blob is not an error.
        Task DeleteAsync(string path);
    }

    public class AdlsPlayerPhotoStore : IPlayerPhotoStore
    {
        private readonly DataLakeServiceClient _client;
        private readonly string _containerName;

        public AdlsPlayerPhotoStore(IConfiguration configuration)
        {
            var connectionString = configuration["AzureStorage:ConnectionString"];
            _containerName = configuration["AzureStorage:ContainerName"] ?? "onlinerangedata";

            if (string.IsNullOrWhiteSpace(connectionString))
                throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");

            _client = new DataLakeServiceClient(connectionString);
        }

        public async Task SaveAsync(string path, Stream content)
        {
            var fs = _client.GetFileSystemClient(_containerName);
            await fs.CreateIfNotExistsAsync();
            var file = fs.GetFileClient(path);
            await file.UploadAsync(content, overwrite: true);
        }

        public async Task<Stream?> OpenReadAsync(string path)
        {
            var file = _client.GetFileSystemClient(_containerName).GetFileClient(path);
            try
            {
                var result = await file.ReadAsync();
                return result.Value.Content;
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return null;
            }
        }

        public async Task DeleteAsync(string path)
        {
            var file = _client.GetFileSystemClient(_containerName).GetFileClient(path);
            try
            {
                await file.DeleteIfExistsAsync();
            }
            catch (RequestFailedException)
            {
                // Best-effort cleanup: an orphaned blob is preferable to a failed
                // delete/replace of the player row it belonged to.
            }
        }
    }
}
