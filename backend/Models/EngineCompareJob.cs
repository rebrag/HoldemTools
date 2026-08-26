// Models/EngineCompareJob.cs
using System;
using System.Collections.Generic;

namespace PokerRangeAPI2.Models
{
    /// <summary>
    /// One queued htsolver run on the machine that has both solvers. The
    /// durable queue entry the compare watcher claims; the frontend /compare
    /// page polls it. Two modes:
    ///  - "compare": solve with htsolver AND PioSolver, upload the per-hand
    ///    comparison JSON (the htsolver-verification loop).
    ///  - "publish": solve with htsolver only and publish schema-4 bundles to
    ///    the solutions library - the post-Pio production path, gated to
    ///    admins while htsolver is still earning trust.
    /// </summary>
    public class EngineCompareJob
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (verified token)

        public string Mode { get; set; } = EngineCompareJobMode.Compare;

        // The htsolver config JSON (the spot definition: board, pot, stacks,
        // ranges, sizes, budget). Small enough to live in the row.
        public string ConfigJson { get; set; } = default!;

        // Board parsed out of the config at submit time, for list display.
        public string? Board { get; set; }

        // Pio accuracy ("exploitable for") as % of the pot, compare mode only.
        public double PioAccuracyPct { get; set; } = 0.02;

        public string Status { get; set; } = EngineCompareJobStatus.Queued;

        public int AttemptCount { get; set; }
        public string? Error { get; set; }
        public string? WatcherId { get; set; }

        // compare mode: ADLS path of the uploaded comparison JSON (gzipped).
        public string? ResultBlobPath { get; set; }

        // Per-stage wall times reported by the watcher (flat JSON dict of
        // seconds; see the /compare pipeline timing panel). Null for jobs
        // that predate the instrumentation.
        public string? TimingsJson { get; set; }

        // publish mode: manifest coordinates in the solutions library.
        public string? ResultStacks { get; set; }
        public string? ResultNodeName { get; set; }

        public DateTimeOffset CreatedAtUtc { get; set; }
        public DateTimeOffset? ClaimedAtUtc { get; set; }
        public DateTimeOffset? CompletedAtUtc { get; set; }
        public DateTimeOffset? LastHeartbeatUtc { get; set; }
    }

    public static class EngineCompareJobMode
    {
        public const string Compare = "compare";
        public const string Publish = "publish";
    }

    public static class EngineCompareJobStatus
    {
        public const string Queued = "Queued";
        public const string Claimed = "Claimed";
        public const string Running = "Running";
        public const string Uploading = "Uploading";
        public const string Done = "Done";
        public const string Failed = "Failed";

        /// <summary>States owned by a live watcher claim (heartbeat expected).</summary>
        public static readonly IReadOnlyList<string> Active =
            new[] { Claimed, Running, Uploading };

        public static readonly IReadOnlyList<string> Terminal = new[] { Done, Failed };

        /// <summary>
        /// The linear stage chain a watcher walks. Failed is reachable from
        /// any active state and is validated separately.
        /// </summary>
        public static readonly IReadOnlyList<string> Chain =
            new[] { Queued, Claimed, Running, Uploading, Done };
    }
}
