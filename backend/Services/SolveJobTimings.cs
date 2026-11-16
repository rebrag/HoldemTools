using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// How long a solve has actually been taking, read off the queue's own
    /// history. The frontend used to print a fixed promise ("usually 2-10
    /// min") that was written once and never checked against anything; a
    /// figure measured from the last solves of the same kind on the same
    /// solver cannot drift from reality, and follows a change of solver or of
    /// the machine behind it without a deploy.
    /// </summary>
    public static class SolveJobTimings
    {
        /// <summary>The most recent completed solves the figure is taken over.</summary>
        public const int SampleSize = 20;

        /// <summary>
        /// Below this many completed solves there is no figure: one or two
        /// samples describe those trees, not the solver.
        /// </summary>
        public const int MinSamples = 3;

        /// <summary>
        /// Median seconds from claim to Done over the last <see cref="SampleSize"/>
        /// completed jobs of this solver and kind (hand-history jobs carry seat
        /// meta and solve the hand's own stacks; sim jobs solve the sim's), or
        /// null when there are too few to say. Claim to Done is what a user
        /// waits once their job is at the head of the queue: solve, extraction
        /// and upload, not time spent queued behind others. The median rather
        /// than the mean, so one deep-stacked outlier does not move the promise.
        /// DB-only, so tests drive it directly.
        /// </summary>
        public static async Task<int?> TypicalSecondsAsync(AppDbContext db, string solver, bool hasSeatMeta)
        {
            var rows = await db.SolveJobs.AsNoTracking()
                .Where(j => j.Solver == solver &&
                            j.HasSeatMeta == hasSeatMeta &&
                            j.Status == SolveJobStatus.Done &&
                            j.ClaimedAtUtc != null &&
                            j.CompletedAtUtc != null)
                .OrderByDescending(j => j.CompletedAtUtc)
                .Take(SampleSize)
                .Select(j => new { j.ClaimedAtUtc, j.CompletedAtUtc })
                .ToListAsync();

            var seconds = rows
                .Select(r => (r.CompletedAtUtc!.Value - r.ClaimedAtUtc!.Value).TotalSeconds)
                .Where(s => s > 0)
                .OrderBy(s => s)
                .ToArray();
            if (seconds.Length < MinSamples)
                return null;

            var mid = seconds.Length / 2;
            var median = seconds.Length % 2 == 1 ? seconds[mid] : (seconds[mid - 1] + seconds[mid]) / 2.0;
            return (int)Math.Round(median);
        }
    }
}
