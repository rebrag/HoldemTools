// Tests/HandShareTests.cs
using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    // Exercises the hand-share endpoints against the real controller logic backed
    // by an EF Core in-memory database, mirroring how the existing /api/handhistory
    // ownership checks work.
    public class HandShareTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    // A unique name per test keeps the stores isolated.
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static IConfiguration EmptyConfig() =>
            new ConfigurationBuilder().Build();

        // Builds an authed HandHistoryController whose token carries the given uid.
        private static HandHistoryController AuthedController(AppDbContext db, string uid)
        {
            var controller = new HandHistoryController(db, EmptyConfig());
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

        private static async Task<HandHistory> SeedHand(AppDbContext db, string ownerUid, string rawText)
        {
            var hand = new HandHistory
            {
                UserId = ownerUid,
                RawText = rawText,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.HandHistories.Add(hand);
            await db.SaveChangesAsync();
            return hand;
        }

        [Fact]
        public async Task Owner_CanCreate_ShareToken()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "raw-hand-text");
            var controller = AuthedController(db, "owner-1");

            var result = await controller.CreateShare(hand.Id);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<HandHistoryController.ShareTokenResponse>(ok.Value);
            Assert.False(string.IsNullOrWhiteSpace(body.Token));
            // Token must be short, url-safe, and not derived from the numeric id.
            Assert.Equal(22, body.Token.Length);
            Assert.Matches("^[0-9A-Za-z]+$", body.Token);
            Assert.DoesNotContain(hand.Id.ToString(), body.Token);
        }

        [Fact]
        public async Task RepeatPost_SameHand_ReturnsSameToken()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "raw-hand-text");
            var controller = AuthedController(db, "owner-1");

            var first = Assert.IsType<OkObjectResult>((await controller.CreateShare(hand.Id)).Result);
            var second = Assert.IsType<OkObjectResult>((await controller.CreateShare(hand.Id)).Result);

            var t1 = Assert.IsType<HandHistoryController.ShareTokenResponse>(first.Value).Token;
            var t2 = Assert.IsType<HandHistoryController.ShareTokenResponse>(second.Value).Token;

            Assert.Equal(t1, t2); // idempotent per hand
        }

        [Fact]
        public async Task NonOwner_Create_Gets403()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "raw-hand-text");
            var controller = AuthedController(db, "someone-else");

            var result = await controller.CreateShare(hand.Id);

            Assert.IsType<ForbidResult>(result.Result);
        }

        [Fact]
        public async Task Create_UnknownHand_Gets404()
        {
            using var db = NewDb();
            var controller = AuthedController(db, "owner-1");

            var result = await controller.CreateShare(9999);

            Assert.IsType<NotFoundResult>(result.Result);
        }

        [Fact]
        public async Task PublicGet_ReturnsRawText_NoAuth()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "the-exact-raw-text-payload");
            var token = Assert
                .IsType<HandHistoryController.ShareTokenResponse>(
                    Assert.IsType<OkObjectResult>(
                        (await AuthedController(db, "owner-1").CreateShare(hand.Id)).Result).Value)
                .Token;

            // No ControllerContext / no user set at all -> genuinely anonymous.
            var shared = new SharedController(db);

            var result = await shared.GetByToken(token);

            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<SharedController.SharedHandResponse>(ok.Value);
            Assert.Equal("the-exact-raw-text-payload", body.RawText);
        }

        [Fact]
        public async Task PublicGet_UnknownToken_Gets404()
        {
            using var db = NewDb();
            var shared = new SharedController(db);

            var result = await shared.GetByToken("does-not-exist");

            Assert.IsType<NotFoundResult>(result.Result);
        }

        [Fact]
        public async Task PublicGet_Returns404_AfterDelete()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "raw-hand-text");
            var owner = AuthedController(db, "owner-1");

            var token = Assert
                .IsType<HandHistoryController.ShareTokenResponse>(
                    Assert.IsType<OkObjectResult>((await owner.CreateShare(hand.Id)).Result).Value)
                .Token;

            // Before revoke: reachable.
            Assert.IsType<OkObjectResult>((await new SharedController(db).GetByToken(token)).Result);

            // Revoke.
            var del = await owner.DeleteShare(hand.Id);
            Assert.IsType<NoContentResult>(del);

            // After revoke: 404.
            Assert.IsType<NotFoundResult>((await new SharedController(db).GetByToken(token)).Result);
        }

        [Fact]
        public async Task NonOwner_Delete_Gets403()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "owner-1", "raw-hand-text");
            await AuthedController(db, "owner-1").CreateShare(hand.Id);

            var result = await AuthedController(db, "intruder").DeleteShare(hand.Id);

            Assert.IsType<ForbidResult>(result);
        }
    }
}
