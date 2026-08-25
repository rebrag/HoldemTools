#include <doctest/doctest.h>

#include "game/betting_tree.hpp"

using namespace engine;

namespace {
RiverTreeParams small_params() {
  RiverTreeParams params;
  params.pot = 100;
  params.effective_stack = 900;
  params.sizing.bets = {50.0};
  params.sizing.raises = {100.0};
  params.sizing.max_raises = 2;
  params.sizing.allin_threshold = 0.9;
  return params;
}
}  // namespace

TEST_CASE("river tree structure and cumulative action amounts") {
  const PublicTree tree = build_river_tree(small_params());
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

  // OOP bets 50% pot: street-cumulative amount 50 (the bNNN convention).
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
  // raise-to street total is 50 + 200 = 250, hand-cumulative.
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
  RiverTreeParams params;
  params.pot = 1000;
  params.effective_stack = 500;
  params.sizing.bets = {75.0};  // 750 >= 0.9 * 500 -> all-in 500
  params.sizing.max_raises = 1;
  const PublicTree tree = build_river_tree(params);
  const Node& bet = tree[tree[0].first_child + 1];
  CHECK(bet.action_amount == 500);
  // Facing an all-in there is no raise: fold or call only.
  CHECK(bet.num_children == 2);
}

TEST_CASE("max_raises caps the raise ladder") {
  RiverTreeParams params;
  params.pot = 100;
  params.effective_stack = 100000;  // deep enough that stacks never bind
  params.sizing.bets = {25.0};
  params.sizing.raises = {50.0};
  params.sizing.max_raises = 2;
  const PublicTree tree = build_river_tree(params);
  // Walk the raise ladder: bet (raises=1) -> raise (raises=2) -> facing node
  // must offer fold/call only.
  const Node& bet = tree[tree[0].first_child + 1];
  REQUIRE(bet.num_children == 3);
  const Node& raise = tree[bet.first_child + 2];
  CHECK(raise.num_children == 2);
}
