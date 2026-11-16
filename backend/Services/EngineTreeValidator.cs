// Services/EngineTreeValidator.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Validates the engine tree block a gametree upload carries (the
    /// cross-component contract "engine tree block", section 1) and rebuilds
    /// it from a whitelist into a fresh JSON object. The client's object is
    /// never stored verbatim: every key is known, every value is range-checked,
    /// and the board and chip scale must agree with the Pio text the same
    /// upload carries, so the two serializations cannot describe different
    /// spots.
    ///
    /// Unknown keys are rejected rather than dropped. Dropping one would build
    /// a different tree from the one the client described; rejecting it makes
    /// contract drift loud. Optional keys that are absent stay absent, so the
    /// engine applies its own defaults exactly as it does for any other config.
    /// Pure and static, so it is unit-tested directly.
    /// </summary>
    public static class EngineTreeValidator
    {
        public const int MaxTreeBytes = 48 * 1024;
        public const int MaxRangeChars = 16 * 1024;
        public const int MaxSizesPerList = 8;
        public const double ExplicitAllInSize = 10000;

        private static readonly Regex CardRe = new("^[2-9TJQKA][shdc]$", RegexOptions.Compiled);
        private static readonly Regex SeatRe = new("^[A-Za-z0-9+]{1,8}$", RegexOptions.Compiled);
        // Pio range text: hand classes, combos, weights, separators.
        private static readonly Regex RangeRe = new(@"^[A-Za-z0-9:,.+\- ]+$", RegexOptions.Compiled);

        private static readonly string[] TopKeys =
            { "schema", "game", "board", "pot", "chip_scale", "players", "bet_sizing", "preflop_aggressor" };
        private static readonly string[] PlayerKeys = { "seat", "stack", "range" };
        private static readonly string[] Streets = { "flop", "turn", "river" };
        private static readonly string[] StreetKeys =
            { "oop", "ip", "allin_threshold", "max_raises", "add_allin_max_pot_ratio", "merge_similar_pct" };
        private static readonly string[] SeatSizingKeys = { "bets", "donks", "raises", "add_allin", "no_3bet" };
        private static readonly string[] SizeLists = { "bets", "donks", "raises" };
        private static readonly string[] SeatFlags = { "add_allin", "no_3bet" };
        private static readonly string[] Aggressors = { "none", "ip", "oop" };

        /// <summary>Thrown internally to unwind with one readable reason.</summary>
        private sealed class Invalid : Exception
        {
            public Invalid(string message) : base(message) { }
        }

        /// <summary>
        /// Validate and rebuild. <paramref name="expectedBoard"/> is the
        /// compact board parsed from the Pio text ("4hJh5s", null when the
        /// text has none, which fails validation); <paramref name="expectedChipScale"/>
        /// is the upload's sanitized chip scale (100 when it has none).
        /// Returns the rebuilt tree, or null with <paramref name="error"/> set.
        /// </summary>
        public static JsonObject? Validate(
            JsonElement tree, string? expectedBoard, double expectedChipScale, out string? error)
        {
            try
            {
                error = null;
                return Rebuild(tree, expectedBoard, expectedChipScale);
            }
            catch (Invalid ex)
            {
                error = ex.Message;
                return null;
            }
        }

        private static JsonObject Rebuild(JsonElement tree, string? expectedBoard, double expectedChipScale)
        {
            if (tree.ValueKind != JsonValueKind.Object)
                throw new Invalid("engineTree must be an object.");
            // Size cap first, on the raw input, before any per-key work.
            if (tree.GetRawText().Length > MaxTreeBytes)
                throw new Invalid($"engineTree exceeds {MaxTreeBytes} bytes.");

            var props = Properties(tree, "", TopKeys);
            var outTree = new JsonObject();

            if (Int(Required(props, "schema", ""), "schema", 0, int.MaxValue) != 1)
                throw new Invalid("engineTree.schema must be 1.");
            outTree["schema"] = 1;

            if (Str(Required(props, "game", ""), "game") != "nlhe")
                throw new Invalid("engineTree.game must be \"nlhe\".");
            outTree["game"] = "nlhe";

            outTree["board"] = Board(Required(props, "board", ""), expectedBoard);

            outTree["pot"] = Int(Required(props, "pot", ""), "pot", 1, 1_000_000_000);

            var chipScale = Number(Required(props, "chip_scale", ""), "chip_scale");
            if (Math.Abs(chipScale - expectedChipScale) > 1e-9 * Math.Max(1, Math.Abs(expectedChipScale)))
                throw new Invalid(
                    $"engineTree.chip_scale {chipScale} disagrees with the upload's chip scale {expectedChipScale}.");
            outTree["chip_scale"] = expectedChipScale;

            outTree["players"] = Players(Required(props, "players", ""));
            outTree["bet_sizing"] = BetSizing(Required(props, "bet_sizing", ""));

            if (props.TryGetValue("preflop_aggressor", out var aggressor))
            {
                var a = Str(aggressor, "preflop_aggressor");
                if (!Aggressors.Contains(a))
                    throw new Invalid("engineTree.preflop_aggressor must be none, ip or oop.");
                outTree["preflop_aggressor"] = a;
            }

            if (outTree.ToJsonString().Length > MaxTreeBytes)
                throw new Invalid($"engineTree exceeds {MaxTreeBytes} bytes.");
            return outTree;
        }

        private static string Board(JsonElement value, string? expectedBoard)
        {
            var text = Str(value, "board");
            var cards = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (cards.Length != 3 || cards.Any(c => !CardRe.IsMatch(c)))
                throw new Invalid("engineTree.board must be exactly 3 valid cards, e.g. \"Qh Jh Th\".");
            if (cards.Distinct(StringComparer.Ordinal).Count() != 3)
                throw new Invalid("engineTree.board repeats a card.");
            if (expectedBoard == null || string.Concat(cards) != expectedBoard)
                throw new Invalid("engineTree.board disagrees with the tree text's #Board#.");
            return string.Join(" ", cards);
        }

        private static JsonArray Players(JsonElement value)
        {
            if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 2)
                throw new Invalid("engineTree.players must hold exactly 2 players (OOP first).");
            var outPlayers = new JsonArray();
            var i = 0;
            foreach (var p in value.EnumerateArray())
            {
                var path = $"players[{i++}]";
                var props = Properties(p, path, PlayerKeys);

                var seat = Str(Required(props, "seat", path), $"{path}.seat");
                if (!SeatRe.IsMatch(seat))
                    throw new Invalid($"engineTree.{path}.seat must match [A-Za-z0-9+]{{1,8}}.");

                var stack = Int(Required(props, "stack", path), $"{path}.stack", 0, 1_000_000_000);

                var range = Str(Required(props, "range", path), $"{path}.range");
                if (range.Length > MaxRangeChars)
                    throw new Invalid($"engineTree.{path}.range exceeds {MaxRangeChars} characters.");
                if (!RangeRe.IsMatch(range))
                    throw new Invalid($"engineTree.{path}.range has characters outside the range alphabet.");

                outPlayers.Add(new JsonObject { ["seat"] = seat, ["stack"] = stack, ["range"] = range });
            }
            return outPlayers;
        }

        private static JsonObject BetSizing(JsonElement value)
        {
            var props = Properties(value, "bet_sizing", Streets);
            var outSizing = new JsonObject();
            foreach (var street in Streets)
            {
                var streetValue = Required(props, street, "bet_sizing");
                outSizing[street] = Street(streetValue, $"bet_sizing.{street}");
            }
            return outSizing;
        }

        private static JsonObject Street(JsonElement value, string path)
        {
            var props = Properties(value, path, StreetKeys);
            var outStreet = new JsonObject();

            foreach (var seat in new[] { "oop", "ip" })
            {
                if (props.TryGetValue(seat, out var seatValue))
                    outStreet[seat] = SeatSizing(seatValue, $"{path}.{seat}");
            }

            if (props.TryGetValue("allin_threshold", out var threshold))
            {
                var t = Number(threshold, $"{path}.allin_threshold");
                if (!(t > 0 && t <= 1.5))
                    throw new Invalid($"engineTree.{path}.allin_threshold must be in (0, 1.5].");
                outStreet["allin_threshold"] = t;
            }
            if (props.TryGetValue("max_raises", out var maxRaises))
                outStreet["max_raises"] = Int(maxRaises, $"{path}.max_raises", 0, 20);
            if (props.TryGetValue("add_allin_max_pot_ratio", out var ratio))
                outStreet["add_allin_max_pot_ratio"] = InRange(ratio, $"{path}.add_allin_max_pot_ratio", 0, 100);
            if (props.TryGetValue("merge_similar_pct", out var merge))
                outStreet["merge_similar_pct"] = InRange(merge, $"{path}.merge_similar_pct", 0, 100);

            return outStreet;
        }

        private static JsonObject SeatSizing(JsonElement value, string path)
        {
            var props = Properties(value, path, SeatSizingKeys);
            var outSeat = new JsonObject();
            foreach (var list in SizeLists)
            {
                if (!props.TryGetValue(list, out var sizes)) continue;
                if (sizes.ValueKind != JsonValueKind.Array)
                    throw new Invalid($"engineTree.{path}.{list} must be an array.");
                if (sizes.GetArrayLength() > MaxSizesPerList)
                    throw new Invalid($"engineTree.{path}.{list} holds more than {MaxSizesPerList} sizes.");
                var outSizes = new JsonArray();
                foreach (var s in sizes.EnumerateArray())
                {
                    var size = Number(s, $"{path}.{list}");
                    if (!(size > 0 && size <= ExplicitAllInSize))
                        throw new Invalid($"engineTree.{path}.{list} sizes must be in (0, {ExplicitAllInSize}].");
                    outSizes.Add(size);
                }
                outSeat[list] = outSizes;
            }
            foreach (var flag in SeatFlags)
            {
                if (!props.TryGetValue(flag, out var f)) continue;
                if (f.ValueKind != JsonValueKind.True && f.ValueKind != JsonValueKind.False)
                    throw new Invalid($"engineTree.{path}.{flag} must be a boolean.");
                outSeat[flag] = f.GetBoolean();
            }
            return outSeat;
        }

        // ---------------- primitives ----------------

        /// <summary>The object's properties, rejecting non-objects, unknown keys and duplicates.</summary>
        private static Dictionary<string, JsonElement> Properties(JsonElement value, string path, string[] allowed)
        {
            if (value.ValueKind != JsonValueKind.Object)
                throw new Invalid($"{Where(path)} must be an object.");
            var props = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var p in value.EnumerateObject())
            {
                if (!allowed.Contains(p.Name))
                    throw new Invalid($"Unknown key \"{Truncate(p.Name)}\" in {Where(path)}."
                        );
                if (!props.TryAdd(p.Name, p.Value))
                    throw new Invalid($"Duplicate key \"{Truncate(p.Name)}\" in {Where(path)}."
                        );
            }
            return props;
        }

        private static JsonElement Required(Dictionary<string, JsonElement> props, string key, string path)
        {
            if (!props.TryGetValue(key, out var v))
                throw new Invalid($"Missing key \"{key}\" in {Where(path)}."
                    );
            return v;
        }

        private static string Str(JsonElement value, string path)
        {
            if (value.ValueKind != JsonValueKind.String)
                throw new Invalid($"engineTree.{path} must be a string.");
            return value.GetString()!;
        }

        private static double Number(JsonElement value, string path)
        {
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var d) || !double.IsFinite(d))
                throw new Invalid($"engineTree.{path} must be a number.");
            return d;
        }

        private static double InRange(JsonElement value, string path, double min, double max)
        {
            var d = Number(value, path);
            if (d < min || d > max)
                throw new Invalid($"engineTree.{path} must be in [{min}, {max}].");
            return d;
        }

        /// <summary>An integral JSON number in [min, max] ("81" and "81.0" both pass).</summary>
        private static int Int(JsonElement value, string path, int min, int max)
        {
            var d = Number(value, path);
            if (d != Math.Floor(d) || d < min || d > max)
                throw new Invalid($"engineTree.{path} must be an integer in [{min}, {max}].");
            return (int)d;
        }

        private static string Where(string path) => path.Length == 0 ? "engineTree" : $"engineTree.{path}";

        private static string Truncate(string s) => s.Length <= 32 ? s : s[..32];
    }
}
