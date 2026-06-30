// Models/HandHistory.cs
using System;

namespace PokerRangeAPI2.Models
{
    public class HandHistory
    {
        public int Id { get; set; } // "HandId" — sequential identity PK

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string RawText { get; set; } = default!; // the full pasted hand-history string

        // Optional link to a bankroll session. Searchable hand attributes
        // (location, dates, game, blinds) live on the linked BankrollSession.
        public Guid? SessionId { get; set; }
        public BankrollSession? Session { get; set; } // navigation property

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }
}
