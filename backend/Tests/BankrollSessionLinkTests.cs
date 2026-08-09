// Tests/BankrollSessionLinkTests.cs
using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Controllers;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    // Exercises the time-window hand adoption in BankrollController: saving or
    // editing a session links the user's still-unlinked hands whose CreatedAt
    // falls inside [Start, End]. Fill-only by design - hands already linked to
    // a session are never re-linked or unlinked.
    public class BankrollSessionLinkTests
    {
        private static readonly DateTimeOffset T0 =
            new DateTimeOffset(2026, 8, 1, 18, 0, 0, TimeSpan.Zero);

        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static async Task<HandHistory> SeedHand(
            AppDbContext db, string uid, DateTimeOffset createdAt, Guid? sessionId = null)
        {
            var hand = new HandHistory
            {
                UserId = uid,
                RawText = "raw",
                SessionId = sessionId,
                CreatedAt = createdAt,
            };
            db.HandHistories.Add(hand);
            await db.SaveChangesAsync();
            return hand;
        }

        private static async Task<BankrollSession> SeedSession(
            AppDbContext db, string uid, DateTimeOffset? start, DateTimeOffset? end)
        {
            var session = new BankrollSession
            {
                Id = Guid.NewGuid(),
                UserId = uid,
                Start = start,
                End = end,
                Profit = 0m,
            };
            db.BankrollSessions.Add(session);
            await db.SaveChangesAsync();
            return session;
        }

        private static BankrollController.CreateBankrollSessionDto Dto(
            string uid, DateTimeOffset? start, DateTimeOffset? end) =>
            new BankrollController.CreateBankrollSessionDto
            {
                UserId = uid,
                Start = start,
                End = end,
                Profit = 0m,
            };

        private static async Task<BankrollSession> CreateViaController(
            AppDbContext db, string uid, DateTimeOffset? start, DateTimeOffset? end)
        {
            var result = await new BankrollController(db).CreateSession(Dto(uid, start, end));
            var ok = Assert.IsType<OkObjectResult>(result.Result);
            return Assert.IsType<BankrollSession>(ok.Value);
        }

        [Fact]
        public async Task Create_LinksInWindowUnlinkedHands_Only()
        {
            using var db = NewDb();
            var inWindow = await SeedHand(db, "u1", T0.AddHours(1));
            var beforeWindow = await SeedHand(db, "u1", T0.AddHours(-1));
            var afterWindow = await SeedHand(db, "u1", T0.AddHours(5));
            var otherUsers = await SeedHand(db, "u2", T0.AddHours(1));

            var saved = await CreateViaController(db, "u1", T0, T0.AddHours(4));

            Assert.Equal(saved.Id, (await db.HandHistories.FindAsync(inWindow.Id))!.SessionId);
            Assert.Null((await db.HandHistories.FindAsync(beforeWindow.Id))!.SessionId);
            Assert.Null((await db.HandHistories.FindAsync(afterWindow.Id))!.SessionId);
            Assert.Null((await db.HandHistories.FindAsync(otherUsers.Id))!.SessionId);
        }

        [Fact]
        public async Task Create_NeverStealsHandsLinkedToAnotherSession()
        {
            using var db = NewDb();
            var other = await SeedSession(db, "u1", T0, T0.AddHours(4));
            var claimed = await SeedHand(db, "u1", T0.AddHours(1), sessionId: other.Id);

            // Same window as the existing session: the hand must stay put.
            await CreateViaController(db, "u1", T0, T0.AddHours(4));

            Assert.Equal(other.Id, (await db.HandHistories.FindAsync(claimed.Id))!.SessionId);
        }

        [Fact]
        public async Task Create_WithNullStartOrEnd_LinksNothing()
        {
            using var db = NewDb();
            var hand = await SeedHand(db, "u1", T0.AddHours(1));

            await CreateViaController(db, "u1", null, T0.AddHours(4));
            await CreateViaController(db, "u1", T0, null);

            Assert.Null((await db.HandHistories.FindAsync(hand.Id))!.SessionId);
        }

        [Fact]
        public async Task Update_WidenedWindow_AdoptsNewlyMatchingHands()
        {
            using var db = NewDb();
            var session = await SeedSession(db, "u1", T0, T0.AddHours(1));
            var lateHand = await SeedHand(db, "u1", T0.AddHours(2));

            var result = await new BankrollController(db)
                .UpdateSession(session.Id, Dto("u1", T0, T0.AddHours(4)));
            Assert.IsType<OkObjectResult>(result.Result);

            Assert.Equal(session.Id, (await db.HandHistories.FindAsync(lateHand.Id))!.SessionId);
        }

        [Fact]
        public async Task Update_ShrunkWindow_NeverUnlinks()
        {
            using var db = NewDb();
            var session = await SeedSession(db, "u1", T0, T0.AddHours(4));
            var linked = await SeedHand(db, "u1", T0.AddHours(3), sessionId: session.Id);

            // The hand now falls outside the edited window; fill-only means it
            // keeps its link anyway.
            var result = await new BankrollController(db)
                .UpdateSession(session.Id, Dto("u1", T0, T0.AddHours(1)));
            Assert.IsType<OkObjectResult>(result.Result);

            Assert.Equal(session.Id, (await db.HandHistories.FindAsync(linked.Id))!.SessionId);
        }
    }
}
