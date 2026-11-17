#include <doctest/doctest.h>

#include <bit>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "config/schema.hpp"
#include "game/betting_tree.hpp"

using namespace engine;

namespace {

PostflopTreeParams river_params() {
  PostflopTreeParams params;
  params.pot = 100;
  params.effective_stack = 900;
  params.start_street = Street::River;
  params.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d 6c"));
  params.river.oop.bets = {50.0};
  params.river.oop.raises = {100.0};
  params.river.ip.bets = {50.0};
  params.river.ip.raises = {100.0};
  params.river.max_raises = 2;
  params.river.allin_threshold = 0.9;
  return params;
}

int count_kind(const PublicTree& tree, NodeKind kind) {
  int n = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind == kind) ++n;
  }
  return n;
}

// Totals of every aggressive child of `id`, in child order.
std::vector<Chips> bet_totals(const PublicTree& tree, NodeId id) {
  std::vector<Chips> out;
  const Node& n = tree[id];
  for (std::uint16_t c = 0; c < n.num_children; ++c) {
    const Node& child = tree[n.first_child + c];
    if (child.action_kind == ActionKind::Bet) out.push_back(child.action_amount);
  }
  return out;
}

// River spot for the Pio-parity options: one bet size per seat, the
// threshold out of the way so only the option under test changes the tree.
PostflopTreeParams parity_river(Chips stack) {
  PostflopTreeParams params;
  params.pot = 100;
  params.effective_stack = stack;
  params.start_street = Street::River;
  params.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d 6c"));
  params.river.oop.bets = {50.0};
  params.river.ip.bets = {50.0};
  params.river.max_raises = 4;
  params.river.allin_threshold = 1.0;
  return params;
}

bool same_tree(const PublicTree& a, const PublicTree& b) {
  if (a.size() != b.size()) return false;
  for (NodeId id = 0; id < a.size(); ++id) {
    const Node& x = a[id];
    const Node& y = b[id];
    if (x.kind != y.kind || x.street != y.street || x.action_kind != y.action_kind ||
        x.terminal_kind != y.terminal_kind || x.actor != y.actor || x.dealt_card != y.dealt_card ||
        x.action_amount != y.action_amount || x.parent != y.parent ||
        x.first_child != y.first_child || x.num_children != y.num_children || x.pot != y.pot ||
        x.board_mask != y.board_mask || x.commit != y.commit || x.folded_mask != y.folded_mask ||
        x.fold_winner != y.fold_winner) {
      return false;
    }
  }
  return true;
}

std::string write_temp(const std::string& name, const std::string& body) {
  const auto path = std::filesystem::temp_directory_path() / name;
  std::ofstream(path, std::ios::binary) << body;
  return path.string();
}

}  // namespace

TEST_CASE("river tree structure and cumulative action amounts") {
  const PublicTree tree = build_postflop_tree(river_params());
  const Node& root = tree[0];
  CHECK(root.actor == 0);
  CHECK(root.pot == 100);
  CHECK(root.num_children == 2);  // check, bet 50%

  // Children are contiguous and correctly parented everywhere.
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& n = tree[id];
    for (std::uint16_t c = 0; c < n.num_children; ++c) {
      CHECK(tree[n.first_child + c].parent == id);
    }
  }

  // OOP checks -> IP decision; IP check ends in a showdown with equal commits.
  const Node& ip_after_check = tree[root.first_child];
  CHECK(ip_after_check.kind == NodeKind::Decision);
  CHECK(ip_after_check.actor == 1);
  const Node& check_check = tree[ip_after_check.first_child];
  CHECK(check_check.kind == NodeKind::Terminal);
  CHECK(check_check.terminal_kind == TerminalKind::Showdown);
  CHECK(check_check.commit[0] == check_check.commit[1]);

  // OOP bets 50% pot: cumulative amount 50 (the bNNN convention).
  const Node& bet = tree[root.first_child + 1];
  CHECK(bet.kind == NodeKind::Decision);
  CHECK(bet.action_kind == ActionKind::Bet);
  CHECK(bet.action_amount == 50);
  CHECK(bet.pot == 150);

  // Facing the bet: fold, call, raise. Fold pays the pot to the bettor.
  REQUIRE(bet.num_children == 3);
  const Node& fold = tree[bet.first_child];
  CHECK(fold.terminal_kind == TerminalKind::Fold);
  CHECK(fold.fold_winner == 0);
  const Node& call = tree[bet.first_child + 1];
  CHECK(call.terminal_kind == TerminalKind::Showdown);
  CHECK(call.commit[0] == 50);
  CHECK(call.commit[1] == 50);
  CHECK(call.pot == 200);

  // 100% pot raise over a 50 bet: raise_add = pot after call (200), so the
  // raise-to total is 50 + 200 = 250, hand-cumulative.
  const Node& raise = tree[bet.first_child + 2];
  CHECK(raise.action_kind == ActionKind::Bet);
  CHECK(raise.action_amount == 250);
  CHECK(raise.actor == 0);

  // Every showdown has equal commits (no all-in-for-less lines this pass).
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& n = tree[id];
    if (n.kind == NodeKind::Terminal && n.terminal_kind == TerminalKind::Showdown) {
      CHECK(n.commit[0] == n.commit[1]);
      CHECK(n.pot == 100 + n.commit[0] + n.commit[1]);
    }
  }
}

TEST_CASE("bets at or beyond the all-in threshold clamp to all-in") {
  PostflopTreeParams params = river_params();
  params.pot = 1000;
  params.effective_stack = 500;
  params.river.oop.bets = {75.0};  // 750 >= 0.9 * 500 -> all-in 500
  params.river.ip.bets = {75.0};
  params.river.max_raises = 1;
  const PublicTree tree = build_postflop_tree(params);
  const Node& bet = tree[tree[0].first_child + 1];
  CHECK(bet.action_amount == 500);
  // Facing an all-in there is no raise: fold or call only.
  CHECK(bet.num_children == 2);
}

TEST_CASE("turn tree deals chance cards and runs out all-in calls") {
  PostflopTreeParams params;
  params.pot = 100;
  params.effective_stack = 300;
  params.start_street = Street::Turn;
  params.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d"));
  params.turn.oop.bets = {50.0};
  params.turn.ip.bets = {50.0};
  params.turn.max_raises = 1;
  params.river.oop.bets = {50.0};
  params.river.ip.bets = {50.0};
  params.river.max_raises = 1;
  const PublicTree tree = build_postflop_tree(params);

  // Turn check-check becomes a chance node with 48 children (52 - 4 board),
  // each dealt child a river decision for OOP with the card on its board.
  const Node& ip_check_node = tree[tree[0].first_child];
  const Node& chance = tree[ip_check_node.first_child];
  CHECK(chance.kind == NodeKind::Chance);
  CHECK(chance.num_children == 48);
  const Node& dealt = tree[chance.first_child];
  CHECK(dealt.kind == NodeKind::Decision);
  CHECK(dealt.actor == 0);
  CHECK(dealt.street == Street::River);
  CHECK(dealt.dealt_card >= 0);
  CHECK(std::popcount(dealt.board_mask) == 5);

  // Turn bet 50 -> call is all-in? No (100 < 300): it advances to the river.
  const Node& bet = tree[tree[0].first_child + 1];
  const Node& call = tree[bet.first_child + 1];
  CHECK(call.kind == NodeKind::Chance);

  // Force an all-in on the turn: the call must run out the river as a pure
  // chance chain into showdowns, with no decisions in between.
  PostflopTreeParams jam = params;
  jam.turn.oop.bets = {400.0};  // clamps to all-in 300
  const PublicTree jam_tree = build_postflop_tree(jam);
  const Node& jam_bet = jam_tree[jam_tree[0].first_child + 1];
  CHECK(jam_bet.action_amount == 300);
  const Node& jam_call = jam_tree[jam_bet.first_child + 1];
  REQUIRE(jam_call.kind == NodeKind::Chance);
  const Node& river_card = jam_tree[jam_call.first_child];
  CHECK(river_card.kind == NodeKind::Terminal);
  CHECK(river_card.terminal_kind == TerminalKind::Showdown);
  CHECK(river_card.commit[0] == 300);
  CHECK(river_card.commit[1] == 300);
}

TEST_CASE("OOP first-in uses donk sizes only against a prior-street aggressor") {
  PostflopTreeParams params;
  params.pot = 100;
  params.effective_stack = 1000;
  params.start_street = Street::Turn;
  params.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d"));
  params.preflop_aggressor = Aggressor::Ip;
  // OOP: no donks configured, one probe bet size; IP: one bet size.
  params.turn.oop.bets = {50.0};
  params.turn.oop.donks = {};
  params.turn.ip.bets = {50.0};
  params.river.oop.bets = {50.0};
  params.river.oop.donks = {25.0};
  params.river.ip.bets = {50.0};
  const PublicTree tree = build_postflop_tree(params);

  // Root (turn, prev aggressor = IP): OOP has no donk sizes -> check only.
  CHECK(tree[0].num_children == 1);

  // After turn goes check / IP bet 50 / OOP call, IP was the turn aggressor,
  // so river OOP first-in offers the 25% DONK size (25% of pot 200 = 50 ->
  // cumulative 100).
  const Node& ip_node = tree[tree[0].first_child];
  const Node& ip_bet = tree[ip_node.first_child + 1];
  const Node& call = tree[ip_bet.first_child + 1];
  REQUIRE(call.kind == NodeKind::Chance);
  const Node& river_oop = tree[call.first_child];
  REQUIRE(river_oop.kind == NodeKind::Decision);
  REQUIRE(river_oop.num_children == 2);  // check + donk
  const Node& donk = tree[river_oop.first_child + 1];
  CHECK(donk.action_kind == ActionKind::Bet);
  CHECK(donk.action_amount == 50 + 50);  // turn 50 + 25% of the 200 pot

  // After turn check-check (no aggressor), river OOP first-in uses BET sizes
  // (50% of pot 100 = 50).
  const Node& xx = tree[ip_node.first_child];
  REQUIRE(xx.kind == NodeKind::Chance);
  const Node& river_oop2 = tree[xx.first_child];
  REQUIRE(river_oop2.num_children == 2);
  const Node& probe = tree[river_oop2.first_child + 1];
  CHECK(probe.action_amount == 50);
}

TEST_CASE("flop tree nests two chance levels") {
  PostflopTreeParams params;
  params.pot = 100;
  params.effective_stack = 200;
  params.start_street = Street::Flop;
  params.board_mask = cards_mask(parse_cards("Qs Jh 2h"));
  params.preflop_aggressor = Aggressor::None;
  params.flop.oop.bets = {50.0};
  params.flop.ip.bets = {50.0};
  params.flop.max_raises = 0;
  params.turn.max_raises = 0;
  params.river.max_raises = 0;
  const PublicTree tree = build_postflop_tree(params);

  // check-check -> 49 turn cards -> (per card) check-check -> 48 river cards.
  const Node& ip_node = tree[tree[0].first_child];
  const Node& turn_chance = tree[ip_node.first_child];
  REQUIRE(turn_chance.kind == NodeKind::Chance);
  CHECK(turn_chance.num_children == 49);
  const Node& turn_oop = tree[turn_chance.first_child];
  CHECK(turn_oop.street == Street::Turn);
  const Node& turn_ip = tree[turn_oop.first_child];
  const Node& river_chance = tree[turn_ip.first_child];
  REQUIRE(river_chance.kind == NodeKind::Chance);
  CHECK(river_chance.num_children == 48);
  const Node& river_oop = tree[river_chance.first_child];
  CHECK(river_oop.street == Street::River);
  CHECK(count_kind(tree, NodeKind::Chance) > 49);
  CHECK(tree.num_decision_nodes > 1000);  // 49 x 48 river fan-out
}

TEST_CASE("don't-3-bet bars a seat's third aggression, and only that seat's") {
  PostflopTreeParams params = river_params();
  params.river.max_raises = 3;  // the street cap is not what does the work here
  params.river.ip.no_3bet = true;
  const PublicTree tree = build_postflop_tree(params);

  // Check -> IP bet is IP's aggression #1, so the box does not touch it.
  const Node& ip_after_check = tree[tree[0].first_child];
  REQUIRE(ip_after_check.num_children == 2);  // check back, bet
  const Node& ip_open = tree[ip_after_check.first_child + 1];
  CHECK(ip_open.action_kind == ActionKind::Bet);

  // OOP raises that (#2), so IP's next raise would be #3: fold or call only.
  REQUIRE(ip_open.num_children == 3);  // fold, call, raise
  const Node& oop_raise = tree[ip_open.first_child + 2];
  CHECK(oop_raise.actor == 1);
  CHECK(oop_raise.num_children == 2);

  // IP raising OOP's opening bet is only #2 - still available.
  const Node& oop_open = tree[tree[0].first_child + 1];
  REQUIRE(oop_open.num_children == 3);
  const Node& ip_raise = tree[oop_open.first_child + 2];
  CHECK(ip_raise.action_kind == ActionKind::Bet);
  // ... and OOP, which does not carry the flag, may still make #3.
  CHECK(ip_raise.num_children == 3);

  // Clearing the flag restores IP's #3, so the cap above is the flag's doing
  // and not max_raises.
  params.river.ip.no_3bet = false;
  const PublicTree open = build_postflop_tree(params);
  const Node& open_ip_open = open[open[0].first_child];
  const Node& open_oop_raise = open[open[open_ip_open.first_child + 1].first_child + 2];
  CHECK(open_oop_raise.num_children == 3);
}

TEST_CASE("add_allin offers an all-in beside a non-empty size list, and only then") {
  PostflopTreeParams params = parity_river(1000);
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50});
  params.river.oop.add_allin = true;
  const PublicTree tree = build_postflop_tree(params);
  CHECK(bet_totals(tree, 0) == std::vector<Chips>{50, 1000});
  // IP has no raise sizes, so its flag adds nothing when facing a bet: the
  // box extends a list, it never creates one.
  params.river.ip.add_allin = true;
  const PublicTree with_ip = build_postflop_tree(params);
  const NodeId oop_bet = with_ip[0].first_child + 1;
  CHECK(bet_totals(with_ip, oop_bet).empty());
  // ... while after a check IP's bet list is non-empty and gains the all-in.
  CHECK(bet_totals(with_ip, with_ip[0].first_child) == std::vector<Chips>{50, 1000});
}

TEST_CASE("add_allin_max_pot_ratio caps the added all-in by pot, inclusive") {
  // Opening bet: (stack - commit) <= ratio * pot, here 2.5 * 100 = 250.
  PostflopTreeParams params = parity_river(250);
  params.river.oop.add_allin = true;
  params.river.add_allin_max_pot_ratio = 2.5;
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50, 250});
  params.effective_stack = 251;
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50});

  // Raise: the chips ABOVE the bet against the pot AFTER calling. Facing 50
  // into 100 the pot after calling is 200, so the cap is (stack - 50) <= 500.
  // Against the pot before the call (150) it would be 375 and the stack-550
  // raise would be refused - the reading PioViewer's river-5sizes script
  // rules out.
  params = parity_river(550);
  params.river.ip.raises = {100.0};  // 50 + 200 = 250
  params.river.ip.add_allin = true;
  params.river.add_allin_max_pot_ratio = 2.5;
  const PublicTree tree = build_postflop_tree(params);
  CHECK(bet_totals(tree, tree[0].first_child + 1) == std::vector<Chips>{250, 550});
  params.effective_stack = 551;
  const PublicTree capped = build_postflop_tree(params);
  CHECK(bet_totals(capped, capped[0].first_child + 1) == std::vector<Chips>{250});
}

TEST_CASE("an explicit all-in size ignores add_allin_max_pot_ratio") {
  PostflopTreeParams params = parity_river(5000);
  params.river.oop.bets = {50.0, 10000.0};
  params.river.add_allin_max_pot_ratio = 0.1;
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50, 5000});
}

TEST_CASE("merge_similar_pct keeps the larger of two sizes closer than the threshold") {
  PostflopTreeParams params = parity_river(1000);
  params.river.oop.bets = {50.0, 55.0, 90.0};
  params.river.merge_similar_pct = 12.0;  // 5 chips apart in a 100 pot < 12%
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{55, 90});
  params.river.merge_similar_pct = 5.0;  // 5 chips is not BELOW 5% of 100
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50, 55, 90});
  // The reference is the smallest size KEPT so far: 60 drops 55, and 50 is
  // then measured against 60 (10 apart), so it survives.
  params.river.oop.bets = {50.0, 55.0, 60.0};
  params.river.merge_similar_pct = 6.0;
  CHECK(bet_totals(build_postflop_tree(params), 0) == std::vector<Chips>{50, 60});
}

TEST_CASE("absent Pio-parity keys build the identical tree, and parse to off") {
  const std::string base = R"({
    "schema": 1, "game": "nlhe", "board": "Qs Jh 2h", "pot": 100, "chip_scale": 1,
    "players": [{"seat": "SB", "stack": 600, "range": "AA,KK"},
                {"seat": "BTN", "stack": 600, "range": "QQ,JJ"}],
    "bet_sizing": {
      "flop": {"oop": {"bets": [33], "raises": [50]@OOP@}, "ip": {"bets": [75], "raises": [10000]@IP@},
               "max_raises": 4, "allin_threshold": 0.6@STREET@},
      "turn": {"bets": [50], "raises": [10000]},
      "river": {"bets": [30, 66], "raises": [10000]}
    },
    "budget": {"iterations": 1}
  })";
  const auto make = [&](const std::string& name, const std::string& oop, const std::string& ip,
                        const std::string& street) {
    std::string body = base;
    body.replace(body.find("@OOP@"), 5, oop);
    body.replace(body.find("@IP@"), 4, ip);
    body.replace(body.find("@STREET@"), 8, street);
    return load_config(write_temp(name, body));
  };
  const SolveConfig plain = make("parity_plain.json", "", "", "");
  CHECK_FALSE(plain.flop_sizing.oop.add_allin);
  CHECK_FALSE(plain.flop_sizing.ip.add_allin);
  CHECK(plain.flop_sizing.add_allin_max_pot_ratio == 0.0);
  CHECK(plain.flop_sizing.merge_similar_pct == 0.0);
  const SolveConfig off = make("parity_off.json", R"(, "add_allin": false)", R"(, "add_allin": false)",
                               R"(, "add_allin_max_pot_ratio": 0, "merge_similar_pct": 0)");
  const SolveConfig on = make("parity_on.json", R"(, "add_allin": true)", R"(, "add_allin": true)",
                              R"(, "add_allin_max_pot_ratio": 2.5, "merge_similar_pct": 12)");
  CHECK(on.flop_sizing.oop.add_allin);
  CHECK(on.flop_sizing.ip.add_allin);
  CHECK(on.flop_sizing.add_allin_max_pot_ratio == 2.5);
  CHECK(on.flop_sizing.merge_similar_pct == 12.0);
  // The hash covers a key only when it is written.
  CHECK(config_hash(plain) != config_hash(off));

  const auto tree_of = [](const SolveConfig& c) {
    PostflopTreeParams p;
    p.pot = c.pot;
    p.effective_stack = c.players[0].stack;
    p.start_street = Street::Flop;
    p.board_mask = cards_mask(parse_cards(c.board));
    p.flop = c.flop_sizing;
    p.turn = c.turn_sizing;
    p.river = c.river_sizing;
    return build_postflop_tree(p);
  };
  const PublicTree a = tree_of(plain);
  CHECK(same_tree(a, tree_of(off)));
  CHECK_FALSE(same_tree(a, tree_of(on)));
}

TEST_CASE("Pio-parity keys are validated") {
  const auto file = [](const std::string& name, const std::string& street) {
    const std::string body =
        R"({"schema": 1, "game": "nlhe", "board": "Qs Jh 2h 8d 6c", "pot": 100,
      "players": [{"seat": "SB", "stack": 600, "range": "AA"}, {"seat": "BTN", "stack": 600, "range": "KK"}],
      "bet_sizing": {"river": {"bets": [50])" +
        street + R"(}}, "budget": {"iterations": 1}})";
    return write_temp(name, body);
  };
  CHECK_THROWS(load_config(file("parity_bad_ratio.json", R"(, "add_allin_max_pot_ratio": -1)")));
  CHECK_THROWS(load_config(file("parity_bad_merge.json", R"(, "merge_similar_pct": 100)")));
  CHECK_NOTHROW(load_config(file("parity_ok.json", R"(, "add_allin": true, "merge_similar_pct": 12)")));
}
