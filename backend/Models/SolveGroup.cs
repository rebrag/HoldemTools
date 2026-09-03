// Models/SolveGroup.cs
using System;
using System.Collections.Generic;

namespace PokerRangeAPI2.Models
{
    /// <summary>
    /// A named, ORDERED set of a user's push/fold solves: what the /multiway
    /// session simulator plays as a rotation (hand k plays member k mod n),
    /// saved so the next visit is "load the group" rather than picking the
    /// same four solves out of a list again.
    ///
    /// Members point at job rows rather than at solve ids because a job is
    /// what has a result to play, and about half the older rows carry no
    /// solve id at all. A lineage keeps one result, and when a newer job
    /// supersedes an older one of the same lineage the watcher report
    /// re-points the membership (EngineCompareWatcherController), so a group
    /// follows its solves as they converge instead of losing them.
    /// </summary>
    public class SolveGroup
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (verified token)

        public string Name { get; set; } = default!;

        public DateTimeOffset CreatedAtUtc { get; set; }
        public DateTimeOffset? UpdatedAtUtc { get; set; }

        public List<SolveGroupMember> Members { get; set; } = new();
    }

    /// <summary>
    /// One slot of a group. Its own row rather than a JSON list on the group
    /// so the job reference is a real foreign key: deleting a job drops it
    /// from every group by cascade, and superseding one is a single UPDATE.
    /// The same job may appear twice - a rotation that lists a solve twice
    /// plays it twice as often, which the simulator already supports.
    /// </summary>
    public class SolveGroupMember
    {
        public Guid Id { get; set; }

        public Guid GroupId { get; set; }

        public Guid JobId { get; set; }

        /// <summary>0-based order within the group: the rotation's order.</summary>
        public int Position { get; set; }
    }
}
