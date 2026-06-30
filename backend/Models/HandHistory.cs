// Models/HandHistory.cs
using System;

namespace PokerRangeAPI2.Models
{
    public class HandHistory
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string? Title { get; set; }

        public string RawText { get; set; } = default!; // the full pasted hand-history string

        // Reserved for a future link to a BankrollSession.Id. Unused by the UI for now.
        public Guid? SessionId { get; set; }

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }
}
