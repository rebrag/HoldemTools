// Tests/EngineTreeValidatorTests.cs
using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using PokerRangeAPI2.Services;
using Xunit;

namespace HoldemToolsAPI.Tests
{
    public class EngineTreeValidatorTests
    {
        /// <summary>The contract's section-1 example, as a client would send it.</summary>
        public static JsonObject ValidTree(string board = "Qh Jh Th", double chipScale = 100) => new()
        {
            ["schema"] = 1,
            ["game"] = "nlhe",
            ["board"] = board,
            ["pot"] = 81,
            ["chip_scale"] = chipScale,
            ["players"] = new JsonArray(
                new JsonObject { ["seat"] = "SB", ["stack"] = 583, ["range"] = "AA:1,AKs:0.5" },
                new JsonObject { ["seat"] = "BTN", ["stack"] = 583, ["range"] = "KK,QQ:0.25,AsKd" }),
            ["bet_sizing"] = new JsonObject
            {
                ["flop"] = new JsonObject
                {
                    ["oop"] = new JsonObject
                    {
                        ["bets"] = new JsonArray(33), ["donks"] = new JsonArray(33),
                        ["raises"] = new JsonArray(33), ["add_allin"] = true, ["no_3bet"] = false,
                    },
                    ["ip"] = new JsonObject
                    {
                        ["bets"] = new JsonArray(100), ["raises"] = new JsonArray(10000),
                        ["add_allin"] = true, ["no_3bet"] = false,
                    },
                    ["allin_threshold"] = 0.6,
                    ["max_raises"] = 4,
                    ["add_allin_max_pot_ratio"] = 2.5,
                    ["merge_similar_pct"] = 12,
                },
                ["turn"] = new JsonObject(),
                ["river"] = new JsonObject(),
            },
            ["preflop_aggressor"] = "none",
        };

        private static JsonElement El(JsonNode node) => JsonDocument.Parse(node.ToJsonString()).RootElement;

        private static (JsonObject? tree, string? error) Run(
            JsonNode tree, string? expectedBoard = "QhJhTh", double chipScale = 100)
        {
            var result = EngineTreeValidator.Validate(El(tree), expectedBoard, chipScale, out var error);
            return (result, error);
        }

        private static void AssertRejected(JsonNode tree, string? expectedBoard = "QhJhTh", double chipScale = 100)
        {
            var (result, error) = Run(tree, expectedBoard, chipScale);
            Assert.Null(result);
            Assert.False(string.IsNullOrEmpty(error));
        }

        [Fact]
        public void Accepts_ContractExample_AndRebuildsIt()
        {
            var (tree, error) = Run(ValidTree());

            Assert.Null(error);
            Assert.NotNull(tree);
            Assert.Equal(ValidTree().ToJsonString(), tree!.ToJsonString());
        }

        /// <summary>
        /// The exact JSON the frontend's engineTreeFromParams emits for the
        /// default tree sizes (frontend/e2e/engine-tree.spec.ts pins the same
        /// literal on its side): streets ordered river, turn, flop; seats ip
        /// before oop; an empty turn donk list. If either side changes shape,
        /// one of the two tests fails instead of every upload silently
        /// falling back to Pio.
        /// </summary>
        private const string FrontendDefaultTree = """
            {"schema":1,"game":"nlhe","board":"Ah Kd 9c","pot":550,"chip_scale":100,
             "players":[{"seat":"SB","stack":2100,"range":"22:1,33:0.169,AA:1"},{"seat":"BTN","stack":2100,"range":"KK:1,QQ:0.75"}],
             "bet_sizing":{
              "river":{"ip":{"bets":[30,66],"raises":[10000],"no_3bet":false,"add_allin":true},
                       "oop":{"bets":[30,66],"donks":[30],"raises":[10000],"no_3bet":false,"add_allin":true},
                       "allin_threshold":0.6,"max_raises":4,"add_allin_max_pot_ratio":2.5,"merge_similar_pct":12},
              "turn":{"ip":{"bets":[50],"raises":[10000],"no_3bet":false,"add_allin":true},
                      "oop":{"bets":[50],"donks":[],"raises":[10000],"no_3bet":false,"add_allin":true},
                      "allin_threshold":0.6,"max_raises":4,"add_allin_max_pot_ratio":2.5,"merge_similar_pct":12},
              "flop":{"ip":{"bets":[33],"raises":[10000],"no_3bet":false,"add_allin":true},
                      "oop":{"bets":[33],"donks":[33],"raises":[33],"no_3bet":false,"add_allin":true},
                      "allin_threshold":0.6,"max_raises":4,"add_allin_max_pot_ratio":2.5,"merge_similar_pct":12}},
             "preflop_aggressor":"none"}
            """;

        [Fact]
        public void Accepts_WhatTheFrontendActuallySends()
        {
            var sent = JsonNode.Parse(FrontendDefaultTree)!;
            var (tree, error) = Run(sent, expectedBoard: "AhKd9c", chipScale: 100);

            Assert.Null(error);
            Assert.NotNull(tree);
            // Nothing the engine reads is lost in the rebuild.
            var turnOop = tree!["bet_sizing"]!["turn"]!["oop"]!;
            Assert.Empty(turnOop["donks"]!.AsArray());
            Assert.True(turnOop["add_allin"]!.GetValue<bool>());
            Assert.Equal(2.5, tree["bet_sizing"]!["flop"]!["add_allin_max_pot_ratio"]!.GetValue<double>());
            Assert.Equal(12, tree["bet_sizing"]!["river"]!["merge_similar_pct"]!.GetValue<double>());
            Assert.Equal(10000, tree["bet_sizing"]!["river"]!["ip"]!["raises"]![0]!.GetValue<double>());
        }

        [Fact]
        public void Rebuild_IsAFreshObject_NotTheClientsElement()
        {
            var (tree, _) = Run(ValidTree());
            // Normalized board spacing, and nothing beyond the whitelist.
            Assert.Equal("Qh Jh Th", tree!["board"]!.GetValue<string>());
            Assert.Equal(
                new[] { "schema", "game", "board", "pot", "chip_scale", "players", "bet_sizing", "preflop_aggressor" },
                tree.Select(p => p.Key).ToArray());
        }

        [Fact]
        public void Accepts_MinimalTree_AndLeavesOptionalKeysAbsent()
        {
            var tree = ValidTree();
            tree.Remove("preflop_aggressor");
            var (result, error) = Run(tree);
            Assert.Null(error);
            Assert.False(result!.ContainsKey("preflop_aggressor"));
            Assert.Empty(result["bet_sizing"]!["turn"]!.AsObject());
        }

        [Fact]
        public void Accepts_IntegralFloats_AndChipScaleBelowOne()
        {
            var tree = ValidTree(chipScale: 0.01);
            tree["pot"] = 81.0;
            var (result, error) = Run(tree, chipScale: 0.01);
            Assert.Null(error);
            Assert.Equal(81, result!["pot"]!.GetValue<int>());
        }

        [Theory]
        [InlineData("schema", 2)]
        [InlineData("game", "plo")]
        [InlineData("pot", 0)]
        [InlineData("pot", -5)]
        [InlineData("pot", 81.5)]
        [InlineData("pot", "81")]
        [InlineData("preflop_aggressor", "btn")]
        public void Rejects_BadTopLevelValue(string key, object value)
        {
            var tree = ValidTree();
            tree[key] = JsonValue.Create(value);
            AssertRejected(tree);
        }

        [Fact]
        public void Rejects_UnknownAndMissingKeys()
        {
            var unknown = ValidTree();
            unknown["algorithm"] = new JsonObject { ["iterations"] = 1_000_000_000 };
            AssertRejected(unknown);

            var missing = ValidTree();
            missing.Remove("pot");
            AssertRejected(missing);

            var unknownSeatKey = ValidTree();
            unknownSeatKey["players"]![0]!["threads"] = 64;
            AssertRejected(unknownSeatKey);

            var unknownStreetKey = ValidTree();
            unknownStreetKey["bet_sizing"]!["flop"]!["time_budget"] = 9999;
            AssertRejected(unknownStreetKey);

            var missingStreet = ValidTree();
            missingStreet["bet_sizing"]!.AsObject().Remove("river");
            AssertRejected(missingStreet);
        }

        [Fact]
        public void Rejects_DuplicateKeys()
        {
            var json = ValidTree().ToJsonString().Replace("\"pot\":81", "\"pot\":81,\"pot\":82");
            var el = JsonDocument.Parse(json).RootElement;
            Assert.Null(EngineTreeValidator.Validate(el, "QhJhTh", 100, out var error));
            Assert.Contains("Duplicate", error);
        }

        [Theory]
        [InlineData("Qh Jh", "QhJh")]          // two cards
        [InlineData("Qh Jh Th 2c", "QhJhTh2c")] // a turn
        [InlineData("Qh Qh Th", "QhQhTh")]      // repeated card
        [InlineData("Qx Jh Th", "QxJhTh")]      // bad suit
        [InlineData("Qh Jh Th", "AsKdQc")]      // disagrees with the text
        [InlineData("Qh Jh Th", null)]          // text has no board
        public void Rejects_BadBoard(string board, string? expected)
        {
            AssertRejected(ValidTree(board: board), expectedBoard: expected);
        }

        [Fact]
        public void Rejects_ChipScaleThatDisagreesWithTheUpload()
        {
            AssertRejected(ValidTree(chipScale: 1), chipScale: 100);
        }

        [Fact]
        public void Rejects_BadPlayers()
        {
            var three = ValidTree();
            three["players"]!.AsArray().Add(new JsonObject { ["seat"] = "BB", ["stack"] = 1, ["range"] = "AA" });
            AssertRejected(three);

            var badSeat = ValidTree();
            badSeat["players"]![0]!["seat"] = "S B";
            AssertRejected(badSeat);

            var longSeat = ValidTree();
            longSeat["players"]![0]!["seat"] = "ABCDEFGHI";
            AssertRejected(longSeat);

            var negativeStack = ValidTree();
            negativeStack["players"]![1]!["stack"] = -1;
            AssertRejected(negativeStack);

            var injected = ValidTree();
            injected["players"]![1]!["range"] = "AA\nset_threads 999";
            AssertRejected(injected);

            var tooLong = ValidTree();
            tooLong["players"]![1]!["range"] = new string('A', EngineTreeValidator.MaxRangeChars + 1);
            AssertRejected(tooLong);
        }

        [Fact]
        public void Rejects_BadSizing()
        {
            var tooMany = ValidTree();
            tooMany["bet_sizing"]!["flop"]!["oop"]!["bets"] = new JsonArray(1, 2, 3, 4, 5, 6, 7, 8, 9);
            AssertRejected(tooMany);

            var zero = ValidTree();
            zero["bet_sizing"]!["flop"]!["ip"]!["bets"] = new JsonArray(0);
            AssertRejected(zero);

            var huge = ValidTree();
            huge["bet_sizing"]!["flop"]!["ip"]!["raises"] = new JsonArray(10001);
            AssertRejected(huge);

            var notBool = ValidTree();
            notBool["bet_sizing"]!["flop"]!["ip"]!["add_allin"] = "yes";
            AssertRejected(notBool);
        }

        [Theory]
        [InlineData("allin_threshold", 0)]
        [InlineData("allin_threshold", 1.6)]
        [InlineData("max_raises", 21)]
        [InlineData("max_raises", 2.5)]
        [InlineData("add_allin_max_pot_ratio", 101)]
        [InlineData("merge_similar_pct", -1)]
        public void Rejects_StreetValueOutOfRange(string key, double value)
        {
            var tree = ValidTree();
            tree["bet_sizing"]!["flop"]![key] = value;
            AssertRejected(tree);
        }

        [Fact]
        public void Rejects_OversizedTree()
        {
            // Both ranges at their own cap still fit...
            var tree = ValidTree();
            var range = string.Concat(Enumerable.Repeat("AsKs:0.5,", 2000))[..EngineTreeValidator.MaxRangeChars];
            tree["players"]![0]!["range"] = range;
            tree["players"]![1]!["range"] = range;
            Assert.NotNull(Run(tree).tree);

            // ...but the raw request is capped before any per-key work.
            var padded = tree.ToJsonString().Insert(1, new string(' ', EngineTreeValidator.MaxTreeBytes));
            var el = JsonDocument.Parse(padded).RootElement;
            Assert.Null(EngineTreeValidator.Validate(el, "QhJhTh", 100, out var error));
            Assert.Contains("exceeds", error);
        }

        [Fact]
        public void Rejects_NonObject()
        {
            var el = JsonDocument.Parse("[1,2,3]").RootElement;
            Assert.Null(EngineTreeValidator.Validate(el, "QhJhTh", 100, out var error));
            Assert.NotNull(error);
        }
    }
}
