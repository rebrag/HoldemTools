// Models/SavedTree.cs
using System;

namespace PokerRangeAPI2.Models
{
    // One named tree-building configuration in the user's library, so a spot
    // built once on /compare does not have to be rebuilt for the next solve.
    // These are what the UI calls "trees"; the engine's own benchmark spots
    // (frontend enginePresets.ts) are the read-only built-ins beside them.
    public class SavedTree
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string Name { get; set; } = default!;

        // Null = sits at the library root rather than inside a folder.
        public Guid? FolderId { get; set; }

        // The tree as the versioned JSON envelope written by the client's
        // pages/compare/savedTreePayload.ts: a "pio" field holding PioViewer's
        // own tree-config text (ranges, board, pot, stacks, thresholds and every
        // sizing box), plus the handful of knobs that format cannot express -
        // max raises, the pre-root aggressor, IP's "no 3-bet" flags, and
        // /compare's solve settings.
        //
        // Stored as that envelope rather than as a flat column set for the same
        // reason SavedRange.Weights holds a Pio token string: the inner text is
        // already round-trip tested against PioViewer byte for byte, it is
        // legible in a database client, and the server never has to understand
        // a tree to store one. The schema of the tree builder can move without
        // a migration; the "v" field is how the client handles that.
        //
        // Never indexed, so the length bound is only a sanity check. Sized for
        // a config carrying two full 169-class ranges.
        public string Config { get; set; } = default!;

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }
}
