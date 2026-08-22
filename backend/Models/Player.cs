// Models/Player.cs
using System;

namespace PokerRangeAPI2.Models
{
    // A person the user plays against, recorded so hands can reference a durable
    // identity instead of a free-text seat name. Identity is the ROW, never the
    // name: duplicate names per user are expected (three different "Jonathan"s),
    // and disambiguation happens by photo/notes at pick time in the recorder.
    public class Player
    {
        public Guid Id { get; set; }

        public string UserId { get; set; } = default!; // Firebase uid (set from the verified token)

        public string Name { get; set; } = default!;

        public string? Notes { get; set; }

        // ADLS path of the current photo blob; null when no photo. Each upload
        // writes a fresh unguessable path (see PlayersController), so this value
        // doubles as the photo's version key. Never exposed to clients.
        public string? PhotoPath { get; set; }
        public string? PhotoContentType { get; set; }
        public DateTimeOffset? PhotoUpdatedAt { get; set; }

        public DateTimeOffset CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }

        // Deliberately NO relationship to HandHistory: the per-seat playerId lives
        // inside the hand's opaque RawText payload, so deleting a player leaves
        // hands intact (their seats keep the free-text name snapshot).
    }
}
