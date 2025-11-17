// Models/BankrollSession.cs
using System;

namespace PokerRangeAPI2.Models
{
    public class BankrollSession
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid

        public string Type { get; set; } = "Cash";     // Cash / Tournament / Other

        public DateTimeOffset? Start { get; set; }
        public DateTimeOffset? End { get; set; }

        public double? Hours { get; set; }

        public string? Location { get; set; }
        public string? Game { get; set; }    // Holdem / PLO / etc
        public string? Blinds { get; set; }  // 1/2, 2/5, etc

        public decimal? BuyIn { get; set; }
        public decimal? CashOut { get; set; }

        public decimal Profit { get; set; }  // required
    }
}
