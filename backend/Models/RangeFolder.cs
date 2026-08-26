// Models/RangeFolder.cs
using System;

namespace PokerRangeAPI2.Models
{
    // A folder in the user's saved-range library. Folders nest to any depth via
    // ParentId; a null ParentId is a root folder.
    //
    // Deliberately NO materialized path or depth column. The whole library is a
    // handful of rows per user and is always read in one go (the picker renders
    // the entire tree), so the client assembles the shape from ParentId. A path
    // column would have to be rewritten for every descendant on a move, which is
    // the one operation that would otherwise be a single-row update.
    public class RangeFolder
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string Name { get; set; } = default!;

        // Null = a root-level folder. The controller enforces that a supplied
        // parent belongs to the same user, and rejects a move that would put a
        // folder inside its own subtree.
        public Guid? ParentId { get; set; }

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }
}
