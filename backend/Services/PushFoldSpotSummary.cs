// Services/PushFoldSpotSummary.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// What a push/fold job's stored config says about the SPOT it solved -
    /// the handful of fields a person needs to tell one solve from another in
    /// a list: seats, stacks, blinds, button, and whether a hand-sharing team
    /// exists and where it sits. Derived from ConfigJson at read time rather
    /// than stored, so every row ever queued has one and nothing has to be
    /// backfilled; parsing a 32 KB document for a 100-row list is nothing.
    ///
    /// Null when the config is not a preflop spot this recognises: a list
    /// must never 500 over one malformed row, and a null just means the row
    /// shows what it always showed.
    ///
    /// Reads the same keys multiwayView.ts buildMultiwayConfig writes; the
    /// engine's own parser validates them, this only describes them.
    /// </summary>
    public class PushFoldSpotSummary
    {
        public int Players { get; set; }
        /// <summary>Seat labels in seat order (config.players[].seat).</summary>
        public string[] Seats { get; set; } = Array.Empty<string>();
        /// <summary>Starting stacks in chips, seat order.</summary>
        public double[] Stacks { get; set; } = Array.Empty<double>();
        public double SmallBlind { get; set; }
        public double BigBlind { get; set; }
        public double Ante { get; set; }
        public int Button { get; set; }
        /// <summary>The hand-sharing pair's seat indices, or null for a
        /// no-team solve (the baseline, phase 1).</summary>
        public int[]? TeamSeats { get; set; }
        /// <summary>"aware" or "unaware"; null without a team.</summary>
        public string? Awareness { get; set; }
        /// <summary>Requested iterations (budget.iterations), the total the
        /// lineage was asked to reach.</summary>
        public long? RequestedIterations { get; set; }

        public static PushFoldSpotSummary? Parse(string? configJson)
        {
            if (string.IsNullOrWhiteSpace(configJson)) return null;
            try
            {
                var root = JsonNode.Parse(configJson) as JsonObject;
                if (root == null) return null;
                var players = root["players"] as JsonArray;
                var preflop = root["preflop"] as JsonObject;
                if (players == null || preflop == null || players.Count < 2) return null;

                var seats = new List<string>();
                var stacks = new List<double>();
                foreach (var p in players)
                {
                    var seat = p?["seat"]?.GetValue<string>();
                    var stack = Number(p?["stack"]);
                    if (seat == null || stack == null) return null;
                    seats.Add(seat);
                    stacks.Add(stack.Value);
                }

                var button = (int?)Number(preflop["button"]) ?? 0;
                var bigBlind = Number(preflop["big_blind"]);
                if (bigBlind == null) return null;

                int[]? teamSeats = null;
                string? awareness = null;
                if (root["agents"] is JsonObject agents)
                {
                    // The partition's one multi-seat block is the team; the
                    // singletons are the opponents playing alone.
                    if (agents["partition"] is JsonArray partition)
                    {
                        foreach (var block in partition)
                        {
                            if (block is JsonArray arr && arr.Count >= 2)
                            {
                                var ids = arr.Select(n => (int?)Number(n)).ToArray();
                                if (ids.All(i => i != null))
                                {
                                    teamSeats = ids.Select(i => i!.Value).OrderBy(i => i).ToArray();
                                    break;
                                }
                            }
                        }
                    }
                    awareness = agents["awareness"]?.GetValue<string>();
                }

                return new PushFoldSpotSummary
                {
                    Players = seats.Count,
                    Seats = seats.ToArray(),
                    Stacks = stacks.ToArray(),
                    SmallBlind = Number(preflop["small_blind"]) ?? 0,
                    BigBlind = bigBlind.Value,
                    Ante = Number(preflop["ante"]) ?? 0,
                    Button = button,
                    TeamSeats = teamSeats,
                    Awareness = teamSeats != null ? awareness : null,
                    RequestedIterations = (long?)Number(root["budget"]?["iterations"]),
                };
            }
            catch (Exception e) when (e is JsonException || e is InvalidOperationException || e is FormatException)
            {
                return null;
            }
        }

        private static double? Number(JsonNode? node)
        {
            if (node is not JsonValue v) return null;
            if (v.TryGetValue<double>(out var d) && double.IsFinite(d)) return d;
            if (v.TryGetValue<long>(out var l)) return l;
            return null;
        }
    }
}
