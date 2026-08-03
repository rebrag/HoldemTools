// Models/HiddenSolution.cs
using System;

namespace PokerRangeAPI2.Models
{
    /// <summary>
    /// One solved board a user has removed from their own solved-flops library.
    ///
    /// Hiding is per-viewer and stores nothing but the board's coordinates: the
    /// library index blob (piosolutions-index.json) has exactly one writer, the
    /// watcher, and the solution blobs are shared, so a delete that mutated
    /// either would race the pipeline and take the board away from everyone
    /// else. Filtering on read is both reversible and free of that race.
    /// </summary>
    public class HiddenSolution
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (verified token)

        // Manifest coordinates: piosolutions/{Stacks}/{NodeName}/{Board}/
        public string Stacks { get; set; } = default!;
        public string NodeName { get; set; } = default!;
        public string Board { get; set; } = default!;

        public DateTimeOffset HiddenAtUtc { get; set; }
    }
}
