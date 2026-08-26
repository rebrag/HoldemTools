#include <doctest/doctest.h>

#include <bit>

#include "cards/cards.hpp"
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
