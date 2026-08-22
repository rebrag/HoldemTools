// Tests/PlayersControllerTests.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    // Exercises the Players CRUD + photo endpoints against the real controller
    // logic backed by an EF Core in-memory database and an in-memory photo store.
    // Length/blank-name rules are asserted here because the InMemory provider
    // ignores HasMaxLength - the controller is the enforcement point.
    public class PlayersControllerTests
    {
        private sealed class FakePhotoStore : IPlayerPhotoStore
        {
            public readonly Dictionary<string, byte[]> Blobs = new();

            public Task SaveAsync(string path, Stream content)
            {
                using var ms = new MemoryStream();
                content.CopyTo(ms);
                Blobs[path] = ms.ToArray();
                return Task.CompletedTask;
            }

            public Task<Stream?> OpenReadAsync(string path) =>
                Task.FromResult<Stream?>(
                    Blobs.TryGetValue(path, out var bytes) ? new MemoryStream(bytes) : null);

            public Task DeleteAsync(string path)
            {
                Blobs.Remove(path);
                return Task.CompletedTask;
            }
        }

        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static PlayersController AuthedController(
            AppDbContext db, string uid, FakePhotoStore? store = null)
        {
            var controller = new PlayersController(db, store ?? new FakePhotoStore());
            var identity = new ClaimsIdentity(new[]
            {
                new Claim("user_id", uid),
                new Claim("sub", uid),
            }, authenticationType: "TestAuth");

            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(identity),
                },
            };
            return controller;
        }

        private static async Task<PlayersController.PlayerDto> CreatePlayer(
            PlayersController controller, string name, string? notes = null)
        {
            var result = await controller.Create(
                new PlayersController.PlayerUpsertDto { Name = name, Notes = notes });
            var ok = Assert.IsType<OkObjectResult>(result.Result);
            return Assert.IsType<PlayersController.PlayerDto>(ok.Value);
        }

        // A minimal valid JPEG header (magic bytes only - the controller sniffs,
        // it does not decode).
        private static IFormFile JpegFile(int size = 64, string contentType = "image/jpeg")
        {
            var bytes = new byte[size];
            bytes[0] = 0xFF;
            bytes[1] = 0xD8;
            var ms = new MemoryStream(bytes);
            return new FormFile(ms, 0, ms.Length, "file", "photo.jpg")
            {
                Headers = new HeaderDictionary(),
                ContentType = contentType,
            };
        }

        [Fact]
        public async Task Create_TrimsAndPersists_AllowingDuplicateNames()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");

            var first = await CreatePlayer(controller, "  Jonathan  ", "wears sunglasses");
            var second = await CreatePlayer(controller, "Jonathan");

            Assert.Equal("Jonathan", first.Name);
            Assert.Equal("wears sunglasses", first.Notes);
            Assert.NotEqual(first.Id, second.Id); // identity is the row, never the name
            Assert.Equal(2, await db.Players.CountAsync());
        }

        [Fact]
        public async Task Create_BlankName_Gets400()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");

            var result = await controller.Create(
                new PlayersController.PlayerUpsertDto { Name = "   " });

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public async Task Create_OverlongName_Gets400()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");

            var result = await controller.Create(
                new PlayersController.PlayerUpsertDto { Name = new string('x', 101) });

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public async Task GetAll_ReturnsOnlyCallersPlayers()
        {
            using var db = NewDb();
            await CreatePlayer(AuthedController(db, "owner-1"), "Mine");
            await CreatePlayer(AuthedController(db, "owner-2"), "Theirs");

            var result = await AuthedController(db, "owner-1").GetAll();

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var items = Assert.IsAssignableFrom<IEnumerable<PlayersController.PlayerDto>>(ok.Value).ToList();
            var item = Assert.Single(items);
            Assert.Equal("Mine", item.Name);
        }

        [Fact]
        public async Task Update_NonOwner_Gets404()
        {
            using var db = NewDb();
            var mine = await CreatePlayer(AuthedController(db, "owner-1"), "Jonathan");

            var result = await AuthedController(db, "someone-else").Update(
                mine.Id, new PlayersController.PlayerUpsertDto { Name = "Hijacked" });

            // NotFound (not Forbid) so ids don't leak existence.
            Assert.IsType<NotFoundResult>(result.Result);
            Assert.Equal("Jonathan", (await db.Players.FindAsync(mine.Id))!.Name);
        }

        [Fact]
        public async Task Delete_RemovesRow_AndPhotoBlob()
        {
            using var db = NewDb();
            var store = new FakePhotoStore();
            var controller = AuthedController(db, "owner-1", store);
            var player = await CreatePlayer(controller, "Jonathan");
            await controller.UploadPhoto(player.Id, JpegFile());
            Assert.Single(store.Blobs);

            var result = await controller.Delete(player.Id);

            Assert.IsType<NoContentResult>(result);
            Assert.Equal(0, await db.Players.CountAsync());
            Assert.Empty(store.Blobs);
        }

        [Fact]
        public async Task UploadPhoto_SetsDtoFlags_AndStoresUnderPlayerPrefix()
        {
            using var db = NewDb();
            var store = new FakePhotoStore();
            var controller = AuthedController(db, "owner-1", store);
            var player = await CreatePlayer(controller, "Jonathan");

            var result = await controller.UploadPhoto(player.Id, JpegFile());

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var dto = Assert.IsType<PlayersController.PlayerDto>(ok.Value);
            Assert.True(dto.HasPhoto);
            Assert.NotNull(dto.PhotoUpdatedAt);
            var path = Assert.Single(store.Blobs.Keys);
            Assert.StartsWith($"playerphotos/owner-1/{player.Id}/", path);
            Assert.EndsWith(".jpg", path);
        }

        [Fact]
        public async Task UploadPhoto_Replace_DeletesOldBlob()
        {
            using var db = NewDb();
            var store = new FakePhotoStore();
            var controller = AuthedController(db, "owner-1", store);
            var player = await CreatePlayer(controller, "Jonathan");

            await controller.UploadPhoto(player.Id, JpegFile());
            var firstPath = Assert.Single(store.Blobs.Keys);
            await controller.UploadPhoto(player.Id, JpegFile());

            var secondPath = Assert.Single(store.Blobs.Keys); // old one gone
            Assert.NotEqual(firstPath, secondPath);
        }

        [Fact]
        public async Task UploadPhoto_WrongContentType_Gets400()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");
            var player = await CreatePlayer(controller, "Jonathan");

            var result = await controller.UploadPhoto(
                player.Id, JpegFile(contentType: "image/gif"));

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public async Task UploadPhoto_MismatchedMagicBytes_Gets400()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");
            var player = await CreatePlayer(controller, "Jonathan");

            // Claims PNG but carries JPEG magic bytes.
            var result = await controller.UploadPhoto(
                player.Id, JpegFile(contentType: "image/png"));

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public async Task UploadPhoto_Oversize_Gets400()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");
            var player = await CreatePlayer(controller, "Jonathan");

            var result = await controller.UploadPhoto(
                player.Id, JpegFile(size: 5 * 1024 * 1024 + 1));

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public async Task GetPhoto_NonOwner_Gets404_OwnerGetsBytes()
        {
            using var db = NewDb();
            var store = new FakePhotoStore();
            var owner = AuthedController(db, "owner-1", store);
            var player = await CreatePlayer(owner, "Jonathan");
            await owner.UploadPhoto(player.Id, JpegFile());

            Assert.IsType<NotFoundResult>(
                await AuthedController(db, "someone-else", store).GetPhoto(player.Id));

            var file = Assert.IsType<FileStreamResult>(await owner.GetPhoto(player.Id));
            Assert.Equal("image/jpeg", file.ContentType);
        }

        [Fact]
        public async Task DeletePhoto_ClearsFlags_AndBlob()
        {
            using var db = NewDb();
            var store = new FakePhotoStore();
            var controller = AuthedController(db, "owner-1", store);
            var player = await CreatePlayer(controller, "Jonathan");
            await controller.UploadPhoto(player.Id, JpegFile());

            var result = await controller.DeletePhoto(player.Id);

            Assert.IsType<NoContentResult>(result);
            Assert.Empty(store.Blobs);
            var row = await db.Players.FindAsync(player.Id);
            Assert.Null(row!.PhotoPath);
            Assert.Null(row.PhotoContentType);
            Assert.Null(row.PhotoUpdatedAt);
        }
    }
}
