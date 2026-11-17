using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
using System;
using System.Threading.Tasks;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    /// <summary>
    /// The solve-time promise the frontend prints is the queue's own history,
    /// so these pin what that history is taken over: completed jobs of the
    /// SAME solver and the SAME kind, claim to Done, as a median.
    /// </summary>
    public class SolveJobTimingsTests
    {
        private static AppDbContext NewDb() =>
            new AppDbContext(
                new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                    .Options);

        private static readonly DateTimeOffset T0 = new(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);

        private static void AddJob(
            AppDbContext db, string solver, bool hasSeatMeta, int? seconds,
            string status = SolveJobStatus.Done, int completedMinutesAfterT0 = 0)
        {
            var completed = T0.AddMinutes(completedMinutesAfterT0);
            db.SolveJobs.Add(new SolveJob
            {
                Id = Guid.NewGuid(),
                UserId = "u",
                BlobPath = $"gametrees/2026/11/16/u/folder=x/{Guid.NewGuid():N}.json",
                Folder = "x",
                LineKey = "l",
                ActingPos = "BB",
                Board = "QhJhTh",
                HasSeatMeta = hasSeatMeta,
                Solver = solver,
                Status = status,
                CreatedAtUtc = completed.AddHours(-1),
                ClaimedAtUtc = seconds.HasValue ? completed.AddSeconds(-seconds.Value) : null,
                CompletedAtUtc = status == SolveJobStatus.Done ? completed : null,
            });
        }

        [Fact]
        public async Task NoHistory_IsNull_NotAGuess()
        {
            using var db = NewDb();
            Assert.Null(await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, hasSeatMeta: true));
        }

        [Fact]
        public async Task FewerThanMinSamples_IsNull()
        {
            using var db = NewDb();
            for (var i = 0; i < SolveJobTimings.MinSamples - 1; i++)
                AddJob(db, SolveJobSolver.HtSolver, true, 90, completedMinutesAfterT0: i);
            await db.SaveChangesAsync();

            Assert.Null(await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, true));
        }

        [Fact]
        public async Task Median_NotMean_SoOneOutlierDoesNotMoveThePromise()
        {
            using var db = NewDb();
            var durations = new[] { 80, 95, 100, 110, 1500 };
            for (var i = 0; i < durations.Length; i++)
                AddJob(db, SolveJobSolver.HtSolver, true, durations[i], completedMinutesAfterT0: i);
            await db.SaveChangesAsync();

            Assert.Equal(100, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, true));
        }

        [Fact]
        public async Task EvenCount_AveragesTheTwoMiddleSolves()
        {
            using var db = NewDb();
            var durations = new[] { 40, 60, 80, 100 };
            for (var i = 0; i < durations.Length; i++)
                AddJob(db, SolveJobSolver.Pio, false, durations[i], completedMinutesAfterT0: i);
            await db.SaveChangesAsync();

            Assert.Equal(70, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.Pio, false));
        }

        [Fact]
        public async Task OtherSolvers_OtherKinds_AndUnfinishedJobs_DoNotCount()
        {
            using var db = NewDb();
            for (var i = 0; i < 3; i++)
                AddJob(db, SolveJobSolver.HtSolver, true, 300, completedMinutesAfterT0: i);
            // None of these describe an htsolver hand-history solve.
            for (var i = 0; i < 5; i++)
            {
                AddJob(db, SolveJobSolver.Pio, true, 40, completedMinutesAfterT0: 10 + i);
                AddJob(db, SolveJobSolver.HtSolver, false, 900, completedMinutesAfterT0: 20 + i);
                AddJob(db, SolveJobSolver.HtSolver, true, 5, status: SolveJobStatus.Failed, completedMinutesAfterT0: 30 + i);
                AddJob(db, SolveJobSolver.HtSolver, true, 5, status: SolveJobStatus.Solving, completedMinutesAfterT0: 40 + i);
            }
            await db.SaveChangesAsync();

            Assert.Equal(300, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, true));
            Assert.Equal(40, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.Pio, true));
            Assert.Equal(900, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, false));
        }

        [Fact]
        public async Task OnlyTheMostRecentSolvesCount_SoTheFigureFollowsAChangeOfMachine()
        {
            using var db = NewDb();
            // An old, slow machine...
            for (var i = 0; i < SolveJobTimings.SampleSize; i++)
                AddJob(db, SolveJobSolver.HtSolver, true, 600, completedMinutesAfterT0: i);
            // ...then SampleSize solves on a faster one.
            for (var i = 0; i < SolveJobTimings.SampleSize; i++)
                AddJob(db, SolveJobSolver.HtSolver, true, 120, completedMinutesAfterT0: 1000 + i);
            await db.SaveChangesAsync();

            Assert.Equal(120, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.HtSolver, true));
        }

        [Fact]
        public async Task ADoneRowWithNoClaimTime_IsSkipped()
        {
            using var db = NewDb();
            for (var i = 0; i < 3; i++)
                AddJob(db, SolveJobSolver.Pio, true, 50, completedMinutesAfterT0: i);
            AddJob(db, SolveJobSolver.Pio, true, seconds: null, completedMinutesAfterT0: 5);
            await db.SaveChangesAsync();

            Assert.Equal(50, await SolveJobTimings.TypicalSecondsAsync(db, SolveJobSolver.Pio, true));
        }
    }
}
