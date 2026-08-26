// Models/SavedRange.cs
using System;

namespace PokerRangeAPI2.Models
{
    // One named starting range in the user's library, so a range painted once
    // does not have to be painted again on the next solve.
    public class SavedRange
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string Name { get; set; } = default!;

        // Null = sits at the library root rather than inside a folder.
        public Guid? FolderId { get; set; }

        // The range as PioSOLVER's own token string ("AA,KK:0.5,AK:0.25,T4").
        //
        // Stored in that form rather than as JSON weights for three reasons: it
        // is what serializeRangeTokens/parseRangeTokens on the client already
        // round-trip byte-clean, it is a quarter the size of the equivalent JSON
        // object, and it is legible in a database client - which matters the
        // first time someone has to answer "what did this user actually save".
        // Never indexed, so the length bound is only a sanity check.
        public string Weights { get; set; } = default!;

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }
}
