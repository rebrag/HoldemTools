// Models/SolveJob.cs
using System;
using System.Collections.Generic;

namespace PokerRangeAPI2.Models
{
    /// <summary>
    /// One queued postflop solve. The gametree JSON itself lives in ADLS
    /// (BlobPath); this row is the durable queue entry the watcher claims and
    /// walks through the status chain, and the frontend polls for progress.
    /// </summary>
    public class SolveJob
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (verified token)

        // "gametree" today. Noderequests stay blob-based for now; the column
        // exists so migrating them later is a data change, not a schema change.
        public string Type { get; set; } = SolveJobType.GameTree;

        public string BlobPath { get; set; } = default!; // gametrees/... json in ADLS

        // Submission identity, used for dedupe and for display before the
        // watcher has resolved the manifest coordinates.
        public string Folder { get; set; } = default!;   // stacks folder, e.g. "40-27.5-..."
        public string LineKey { get; set; } = default!;  // preflop line joined with "-"
        public string ActingPos { get; set; } = default!;
        public bool IsIcm { get; set; }
        public string? Board { get; set; }               // "4hJh5s", parsed from #Board# in the tree text

        // Hand-history uploads carry per-seat metadata and are never deduped:
        // their manifests are personalized (names, stacks, hole cards).
        public bool HasSeatMeta { get; set; }

        // The recorded hand this solve came from, when it came from one. Set
        // only after the uploader is confirmed to own that hand, so it is safe
        // to hand back to the library as a replay link. Null for solver-page
        // uploads and for hand-history solves queued before this column
        // existed (those still carry HasSeatMeta).
        public int? HandHistoryId { get; set; }
        public HandHistory? HandHistory { get; set; }

        // Which solver this job is routed to (SolveJobSolver). Chosen
        // server-side at upload; each solver's watcher claims from its own
        // route, so a watcher can never pop a job meant for the other one.
        public string Solver { get; set; } = SolveJobSolver.Pio;

        // The upload carried a valid engine tree (stored in the gametree
        // blob). A job-row fact so routing decisions after upload, such as
        // the admin re-route, never need a blob read.
        public bool HasEngineTree { get; set; }

        public string Status { get; set; } = SolveJobStatus.Queued;

        public int Priority { get; set; }      // higher claims first; 0 default
        public int AttemptCount { get; set; }  // incremented on each claim
        public string? Error { get; set; }
        public string? WatcherId { get; set; } // machine name of the claiming watcher

        // Manifest coordinates. Set at insert (they are deterministic from
        // BlobPath, see GameTreeCoordinates) so the library overlay can
        // owner-filter a hand-history board from the moment any of it is
        // published; the watcher's Done report restates the same values.
        // Non-null does NOT mean solved - Status says that.
        public string? ResultStacks { get; set; }
        public string? ResultNodeName { get; set; }

        public DateTimeOffset CreatedAtUtc { get; set; }
        public DateTimeOffset? ClaimedAtUtc { get; set; }
        public DateTimeOffset? CompletedAtUtc { get; set; }
        public DateTimeOffset? LastHeartbeatUtc { get; set; }
    }

    public static class SolveJobType
    {
        public const string GameTree = "gametree";
    }

    public static class SolveJobSolver
    {
        public const string Pio = "pio";
        public const string HtSolver = "htsolver";

        public static readonly IReadOnlyList<string> All = new[] { Pio, HtSolver };

        /// <summary>The canonical name for a solver string, or null when it names none.</summary>
        public static string? Normalize(string? value)
        {
            var v = value?.Trim().ToLowerInvariant();
            return v == Pio || v == HtSolver ? v : null;
        }
    }

    public static class SolveJobStatus
    {
        public const string Queued = "Queued";
        public const string Claimed = "Claimed";
        public const string Solving = "Solving";
        public const string Extracting = "Extracting";
        public const string Uploading = "Uploading";
        public const string Done = "Done";
        public const string Failed = "Failed";

        /// <summary>States owned by a live watcher claim (heartbeat expected).</summary>
        public static readonly IReadOnlyList<string> Active =
            new[] { Claimed, Solving, Extracting, Uploading };

        public static readonly IReadOnlyList<string> Terminal = new[] { Done, Failed };

        /// <summary>
        /// The linear stage chain a watcher walks. Failed is reachable from
        /// any active state and is validated separately.
        /// </summary>
        public static readonly IReadOnlyList<string> Chain =
            new[] { Queued, Claimed, Solving, Extracting, Uploading, Done };
    }
}
