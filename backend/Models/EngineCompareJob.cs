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

        // Compare-mode options, normalized at create time so the stored row is
        // always coherent (no Pio means neither the per-hand extraction nor
        // the gate can run). Default is the fast engine-only loop: PioSolver
        // is on its way out and is wanted only as an occasional spot-check.
        public bool DisablePio { get; set; } = true;
        public bool DisableCompare { get; set; } = true;      // Pio's per-hand extraction
        public bool DisableCrossCheck { get; set; } = true;   // the cross-exploitability gate

        public string Status { get; set; } = EngineCompareJobStatus.Queued;

        public int AttemptCount { get; set; }
        public string? Error { get; set; }
        public string? WatcherId { get; set; }

        // compare mode: ADLS paths of the two uploaded payloads (gzipped .htc,
        // one per solver). The Pio path stays null when Pio did not run.
        public string? HtResultBlobPath { get; set; }
        public string? PioResultBlobPath { get; set; }

        // LEGACY: the single merged payload written before the per-solver
        // split. Never set by the current watcher; kept so old rows are
        // recognizable as such rather than failing to decode under the new
        // route.
        public string? ResultBlobPath { get; set; }

        // Per-stage wall times reported by the watcher (flat JSON dict of
        // seconds; see the /compare pipeline timing panel). Null for jobs
        // that predate the instrumentation.
        public string? TimingsJson { get; set; }

        // publish mode: manifest coordinates in the solutions library.
        public string? ResultStacks { get; set; }
        public string? ResultNodeName { get; set; }

        /// <summary>
        /// When the owner asked for this job to stop, or null. A REQUEST, not
        /// a state: an active job keeps its status while the watcher notices
        /// the flag (it comes back on every heartbeat response), stops the
        /// solver cooperatively, and uploads whatever the solve reached. A job
        /// still Queued is cancelled outright, since there is nothing to save.
        /// </summary>
        public DateTimeOffset? CancelRequestedAtUtc { get; set; }

        /// <summary>
        /// The solve LINEAGE this job's result belongs to, as the engine
        /// stamped it (metadata.solve_id): stable across resumes, so several
        /// jobs can carry the same id at different iteration counts. Reported
        /// by the watcher with the terminal status; null for jobs that
        /// predate it (a viewer that reads the metadata may fill it in).
        /// One lineage keeps ONE result: when a later job of the same lineage
        /// finishes with at least as many iterations, earlier ones are
        /// deleted - a lineage only moves forward, and the older artifact is
        /// the same solve at a less converged point.
        /// </summary>
        public string? SolveId { get; set; }

        /// <summary>
        /// The spot's identity (metadata.solve_key, the engine's
        /// config_solve_key): what a checkpoint refuses to continue across.
        /// Two jobs with the same SolveId but different keys are different
        /// spots that happened to reuse an id, and never supersede each other.
        /// Null on jobs from before the engine stamped it.
        /// </summary>
        public string? SolveKey { get; set; }

        /// <summary>Iterations the result reached (the team phase for a team
        /// solve): the measure of "more converged" within a lineage.</summary>
        public long? Iterations { get; set; }

        public DateTimeOffset CreatedAtUtc { get; set; }
        public DateTimeOffset? ClaimedAtUtc { get; set; }
        public DateTimeOffset? CompletedAtUtc { get; set; }
        public DateTimeOffset? LastHeartbeatUtc { get; set; }
    }

    public static class EngineCompareJobMode
    {
        public const string Compare = "compare";
        public const string Publish = "publish";
        // Multiway preflop jam/fold (engine M8a). There is no board and no
        // PioSOLVER equivalent to compare against - Pio is heads-up postflop -
        // so the watcher solves with htsolver and uploads the dumped artifact
        // straight to HtResultBlobPath, which /result/ht already serves.
        public const string PushFold = "pushfold";
    }

    public static class EngineCompareJobStatus
    {
        public const string Queued = "Queued";
        public const string Claimed = "Claimed";
        public const string Running = "Running";
        public const string Uploading = "Uploading";
        public const string Done = "Done";
        public const string Failed = "Failed";

        /// <summary>
        /// Stopped by its owner. Terminal, and NOT a failure: a cancelled
        /// solve normally still has a result blob - the engine stops
        /// cooperatively, writes its checkpoint and exports the artifact for
        /// the iterations it completed - so the frontend opens these the same
        /// way it opens Done. It is a distinct status rather than Done
        /// because "you stopped this" is the thing the row has to say.
        /// </summary>
        public const string Cancelled = "Cancelled";

        /// <summary>States owned by a live watcher claim (heartbeat expected).</summary>
        public static readonly IReadOnlyList<string> Active =
            new[] { Claimed, Running, Uploading };

        public static readonly IReadOnlyList<string> Terminal = new[] { Done, Failed, Cancelled };

        /// <summary>
        /// The linear stage chain a watcher walks. Failed and Cancelled are
        /// reachable from any active state and are validated separately.
        /// </summary>
        public static readonly IReadOnlyList<string> Chain =
            new[] { Queued, Claimed, Running, Uploading, Done };
    }
}
