// Models/TreeFolder.cs
using System;

namespace PokerRangeAPI2.Models
{
    // A folder in the user's saved-tree library. Folders nest to any depth via
    // ParentId; a null ParentId is a root folder.
    //
    // Same shape and the same reasoning as RangeFolder - no materialized path,
    // no depth column, because the whole library is a handful of rows per user
    // and the picker always renders all of it. A separate table rather than a
    // "kind" column on RangeFolder: a range folder and a tree folder are never
    // browsed together, and sharing the table would put a discriminator into
    // every query on the hotter of the two libraries for no gain.
    public class TreeFolder
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
