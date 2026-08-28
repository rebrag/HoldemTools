// Tests/SavedTreesControllerTests.cs
//
// The saved-tree library. What is worth pinning here is not the CRUD - it is
// the three things that are easy to get wrong and expensive when they are:
// cross-user isolation, what a folder delete does to the trees inside it, and
// the cycle check that stops a folder being moved into its own subtree.
//
// A deliberate near-copy of SavedRangesControllerTests: the two libraries share
// a shape, so they must be shown to share these guarantees independently rather
// than by assertion that "it is the same code".
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
    public class SavedTreesControllerTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static SavedTreesController AuthedController(AppDbContext db, string uid)
        {
            var controller = new SavedTreesController(db);
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

        private static async Task<SavedTreesController.FolderDto> NewFolder(
            SavedTreesController controller, string name, Guid? parentId = null) =>
            OkValue(await controller.CreateFolder(
                new SavedTreesController.FolderUpsertDto { Name = name, ParentId = parentId }));

        private static async Task<SavedTreesController.TreeDto> NewTree(
            SavedTreesController controller, string name, Guid? folderId = null,
            string config = @"{""v"":1,""pio"":""#Type#NoLimit""}") =>
            OkValue(await controller.CreateTree(
                new SavedTreesController.TreeUpsertDto
                {
                    Name = name,
                    FolderId = folderId,
                    Config = config,
                }));

        [Fact]
        public async Task Library_returns_only_the_callers_rows()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var myFolder = await NewFolder(mine, "Mine");
            await NewTree(mine, "My tree", myFolder.Id);
            var theirFolder = await NewFolder(theirs, "Theirs");
            await NewTree(theirs, "Their tree", theirFolder.Id);

            var library = OkValue(await mine.GetAll());

            Assert.Equal(new[] { "Mine" }, library.Folders.Select(f => f.Name));
            Assert.Equal(new[] { "My tree" }, library.Trees.Select(t => t.Name));
        }

        [Fact]
        public async Task Another_users_row_is_indistinguishable_from_a_missing_one()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var theirFolder = await NewFolder(theirs, "Theirs");
            var theirTree = await NewTree(theirs, "Their tree", theirFolder.Id);

            Assert.IsType<NotFoundResult>(await mine.DeleteFolder(theirFolder.Id));
            Assert.IsType<NotFoundResult>(await mine.DeleteTree(theirTree.Id));
            Assert.IsType<NotFoundResult>(
                (await mine.UpdateFolder(
                    theirFolder.Id,
                    new SavedTreesController.FolderUpsertDto { Name = "Stolen" })).Result);
        }

        [Fact]
        public async Task A_folder_belonging_to_someone_else_cannot_be_used_as_a_parent()
        {
            using var db = NewDb();
            var mine = AuthedController(db, "user-a");
            var theirs = AuthedController(db, "user-b");

            var theirFolder = await NewFolder(theirs, "Theirs");

            Assert.IsType<BadRequestObjectResult>(
                (await mine.CreateFolder(new SavedTreesController.FolderUpsertDto
                {
                    Name = "Sneaky",
                    ParentId = theirFolder.Id,
                })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await mine.CreateTree(new SavedTreesController.TreeUpsertDto
                {
                    Name = "Sneaky",
                    FolderId = theirFolder.Id,
                    Config = "AA",
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
        public async Task Deleting_a_folder_keeps_its_trees_and_moves_them_to_the_root()
        {
            // The deliberate choice: losing a built tree to a mis-clicked
            // folder delete is worse than an untidy root, and there is no undo.
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var root = await NewFolder(controller, "Root");
            var child = await NewFolder(controller, "Child", root.Id);
            var atRoot = await NewTree(controller, "Top", root.Id);
            var deeper = await NewTree(controller, "Deep", child.Id);

            Assert.IsType<NoContentResult>(await controller.DeleteFolder(root.Id));

            var library = OkValue(await controller.GetAll());
            Assert.Empty(library.Folders);
            Assert.Equal(2, library.Trees.Count);
            Assert.All(library.Trees, t => Assert.Null(t.FolderId));
            Assert.Contains(library.Trees, t => t.Id == atRoot.Id);
            Assert.Contains(library.Trees, t => t.Id == deeper.Id);
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
                    new SavedTreesController.FolderUpsertDto { Name = "Root", ParentId = target });
                Assert.IsType<BadRequestObjectResult>(result.Result);
            }

            // The legitimate move still works: a leaf up to the root.
            var moved = OkValue(await controller.UpdateFolder(
                grandchild.Id,
                new SavedTreesController.FolderUpsertDto { Name = "Grandchild", ParentId = null }));
            Assert.Null(moved.ParentId);
        }

        [Fact]
        public async Task A_tree_round_trips_its_config_and_can_be_overwritten()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            var folder = await NewFolder(controller, "Benchmarks");
            // The server treats Config as opaque text, so the fixture is a real
            // envelope - embedded newline escapes included - rather than a token.
            const string v1 = @"{""v"":1,""pio"":""#Type#NoLimit\n#Pot#100"",""maxRaises"":""3""}";
            var created = await NewTree(controller, "Turn ref", folder.Id, v1);
            Assert.Equal(v1, created.Config);

            const string v2 = @"{""v"":1,""pio"":""#Type#NoLimit\n#Pot#200"",""maxRaises"":""2""}";
            var updated = OkValue(await controller.UpdateTree(
                created.Id,
                new SavedTreesController.TreeUpsertDto
                {
                    Name = "Turn ref v2",
                    FolderId = null,
                    Config = v2,
                }));

            Assert.Equal("Turn ref v2", updated.Name);
            Assert.Equal(v2, updated.Config);
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
                    new SavedTreesController.FolderUpsertDto { Name = "   " })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateFolder(
                    new SavedTreesController.FolderUpsertDto { Name = new string('x', 101) })).Result);
        }

        [Fact]
        public async Task An_empty_or_oversized_tree_is_rejected()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "user-a");

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateTree(new SavedTreesController.TreeUpsertDto
                {
                    Name = "Empty",
                    Config = "   ",
                })).Result);

            Assert.IsType<BadRequestObjectResult>(
                (await controller.CreateTree(new SavedTreesController.TreeUpsertDto
                {
                    Name = "Huge",
                    Config = new string('A', 16001),
                })).Result);
        }

        [Fact]
        public async Task Signed_out_callers_get_401_rather_than_an_empty_library()
        {
            using var db = NewDb();
            var controller = new SavedTreesController(db)
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
                    new SavedTreesController.FolderUpsertDto { Name = "x" })).Result);
        }
    }
}
