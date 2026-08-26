// Tests/SavedRangesControllerTests.cs
//
// The saved-range library. What is worth pinning here is not the CRUD - it is
// the three things that are easy to get wrong and expensive when they are:
// cross-user isolation, what a folder delete does to the ranges inside it, and
// the cycle check that stops a folder being moved into its own subtree.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Xunit;

namespace GTOLiteAPI.Tests
{
    public class SavedRangesControllerTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static SavedRangesController AuthedController(AppDbContext db, string uid)
        {
            var controller = new SavedRangesController(db);
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

        private static T OkValue<T>(ActionResult<T> result) =>
            Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);

        private static async Task<SavedRangesController.FolderDto> NewFolder(
            SavedRangesController controller, string name, Guid? parentId = null) =>
            OkValue(await controller.CreateFolder(
                new SavedRangesController.FolderUpsertDto { Name = name, ParentId = parentId }));

        private static async Task<SavedRangesController.RangeDto> NewRange(
            SavedRangesController controller, string name, Guid? folderId = null,
            string weights = "AA,KK:0.5") =>
            OkValue(await controller.CreateRange(
                new SavedRangesController.RangeUpsertDto
                {
                    Name = name,
                    FolderId = folderId,
                    Weights = weights,
                }));

        [Fact]
        public async Task Library_returns_only_the_callers_rows()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var myFolder = await NewFolder(mine, "Mine");
            await NewRange(mine, "My range", myFolder.Id);
            var theirFolder = await NewFolder(theirs, "Theirs");
            await NewRange(theirs, "Their range", theirFolder.Id);

            var library = OkValue(await mine.GetAll());

            Assert.Equal(new[] { "Mine" }, library.Folders.Select(f => f.Name));
            Assert.Equal(new[] { "My range" }, library.Ranges.Select(r => r.Name));
        }

        [Fact]
        public async Task Another_users_row_is_indistinguishable_from_a_missing_one()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var theirFolder = await NewFolder(theirs, "Theirs");
            var theirRange = await NewRange(theirs, "Their range", theirFolder.Id);

            Assert.IsType<NotFoundResult>(await mine.DeleteFolder(theirFolder.Id));
            Assert.IsType<NotFoundResult>(await mine.DeleteRange(theirRange.Id));
            Assert.IsType<NotFoundResult>(
                (await mine.UpdateFolder(
                    theirFolder.Id,
                    new SavedRangesController.FolderUpsertDto { Name = "Stolen" })).Result);
        }

        [Fact]
        public async Task A_folder_belonging_to_someone_else_cannot_be_used_as_a_parent()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var theirFolder = await NewFolder(theirs, "Theirs");

            Assert.IsType<BadRequestObjectResult>(
                (await mine.CreateFolder(new SavedRangesController.FolderUpsertDto
                {
                    Name = "Sneaky",
                    ParentId = theirFolder.Id,
                })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await mine.CreateRange(new SavedRangesController.RangeUpsertDto
                {
                    Name = "Sneaky",
                    FolderId = theirFolder.Id,
                    Weights = "AA",
                })).Result);
        }

        [Fact]
        public async Task Deleting_a_folder_deletes_its_subtree()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var root = await NewFolder(controller, "Root");
            var child = await NewFolder(controller, "Child", root.Id);
            var grandchild = await NewFolder(controller, "Grandchild", child.Id);
            var sibling = await NewFolder(controller, "Sibling");

            Assert.IsType<NoContentResult>(await controller.DeleteFolder(root.Id));

            var library = OkValue(await controller.GetAll());
            Assert.Equal(new[] { sibling.Id }, library.Folders.Select(f => f.Id));
            Assert.DoesNotContain(library.Folders, f => f.Id == child.Id || f.Id == grandchild.Id);
        }

        [Fact]
        public async Task Deleting_a_folder_keeps_its_ranges_and_moves_them_to_the_root()
        {
            // The deliberate choice: losing a painted range to a mis-clicked
            // folder delete is worse than an untidy root, and there is no undo.
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var root = await NewFolder(controller, "Root");
            var child = await NewFolder(controller, "Child", root.Id);
            var atRoot = await NewRange(controller, "Top", root.Id);
            var deeper = await NewRange(controller, "Deep", child.Id);

            Assert.IsType<NoContentResult>(await controller.DeleteFolder(root.Id));

            var library = OkValue(await controller.GetAll());
            Assert.Empty(library.Folders);
            Assert.Equal(2, library.Ranges.Count);
            Assert.All(library.Ranges, r => Assert.Null(r.FolderId));
            Assert.Contains(library.Ranges, r => r.Id == atRoot.Id);
            Assert.Contains(library.Ranges, r => r.Id == deeper.Id);
        }

        [Fact]
        public async Task A_folder_cannot_be_moved_into_itself_or_its_own_subtree()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var root = await NewFolder(controller, "Root");
            var child = await NewFolder(controller, "Child", root.Id);
            var grandchild = await NewFolder(controller, "Grandchild", child.Id);

            foreach (var target in new[] { root.Id, child.Id, grandchild.Id })
            {
                var result = await controller.UpdateFolder(
                    root.Id,
                    new SavedRangesController.FolderUpsertDto { Name = "Root", ParentId = target });
                Assert.IsType<BadRequestObjectResult>(result.Result);
            }

            // The legitimate move still works: a leaf up to the root.
            var moved = OkValue(await controller.UpdateFolder(
                grandchild.Id,
                new SavedRangesController.FolderUpsertDto { Name = "Grandchild", ParentId = null }));
            Assert.Null(moved.ParentId);
        }

        [Fact]
        public async Task A_range_round_trips_its_weights_and_can_be_overwritten()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var folder = await NewFolder(controller, "Opens");
            var created = await NewRange(controller, "BTN open", folder.Id, "AA,KK:0.5,AK:0.25,T4");
            Assert.Equal("AA,KK:0.5,AK:0.25,T4", created.Weights);

            var updated = OkValue(await controller.UpdateRange(
                created.Id,
                new SavedRangesController.RangeUpsertDto
                {
                    Name = "BTN open v2",
                    FolderId = null,
                    Weights = "22+,A2s+",
                }));

            Assert.Equal("BTN open v2", updated.Name);
            Assert.Equal("22+,A2s+", updated.Weights);
            Assert.Null(updated.FolderId);
            Assert.NotNull(updated.UpdatedAt);
        }

        [Fact]
        public async Task Names_are_trimmed_and_bounded()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var trimmed = await NewFolder(controller, "   Opens   ");
            Assert.Equal("Opens", trimmed.Name);

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateFolder(
                    new SavedRangesController.FolderUpsertDto { Name = "   " })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateFolder(
                    new SavedRangesController.FolderUpsertDto { Name = new string('x', 101) })).Result);
        }

        [Fact]
        public async Task An_empty_or_oversized_range_is_rejected()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateRange(new SavedRangesController.RangeUpsertDto
                {
                    Name = "Empty",
                    Weights = "   ",
                })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateRange(new SavedRangesController.RangeUpsertDto
                {
                    Name = "Huge",
                    Weights = new string('A', 4001),
                })).Result);
        }

        [Fact]
        public async Task Signed_out_callers_get_401_rather_than_an_empty_library()
        {
            using var db = NewDb();
            var controller = new SavedRangesController(db)
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity()),
                    },
                },
            };

            Assert.IsType<UnauthorizedResult>((await controller.GetAll()).Result);
            Assert.IsType<UnauthorizedResult>(
                (await controller.CreateFolder(
                    new SavedRangesController.FolderUpsertDto { Name = "x" })).Result);
        }
    }
}
