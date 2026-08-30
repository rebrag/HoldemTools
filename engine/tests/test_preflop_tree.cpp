#include <doctest/doctest.h>

#include <array>
#include <cstdint>
#include <vector>

#include "game/preflop_tree.hpp"

using namespace engine;

namespace {

// The short-term target spot: 4 seats, blinds 1/2, 20 chips each (10bb),
// button on seat 3 so the action order is 2, 3, 0, 1.
PreflopTreeParams four_way_10bb() {
  PreflopTreeParams p;
  p.num_seats = 4;
  p.small_blind = 1;
  p.big_blind = 2;
  p.button = 3;
  for (int s = 0; s < 4; ++s) p.stack[s] = 20;
  return p;
}

int count_kind(const PublicTree& tree, NodeKind kind) {
  int n = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind == kind) ++n;
  }
  return n;
}

int count_terminal(const PublicTree& tree, TerminalKind kind) {
  int n = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind == NodeKind::Terminal && node.terminal_kind == kind) ++n;
  }
  return n;
}

int alive_at(const PublicTree& tree, const Node& n, int seats) {
  (void)tree;
  int k = 0;
  for (int s = 0; s < seats; ++s) {
    if ((n.folded_mask & (1u << s)) == 0) ++k;
  }
  return k;
}

}  // namespace

TEST_CASE("4-way jam/fold tree shape") {
  const PublicTree tree = build_preflop_tree(four_way_10bb());

  // Four seats each choose fold-or-jam exactly once, which would be the depth-4
  // binary tree (15 internal, 16 leaves). One branch is short: once seats 2, 3
  // and 0 have all folded the big blind is the only seat left and the hand ends
  // without it acting, so that internal node becomes a leaf. 14 decisions, 15
  // terminals, 29 nodes.
  CHECK(count_kind(tree, NodeKind::Decision) == 14);
  CHECK(count_kind(tree, NodeKind::Chance) == 0);
  CHECK(count_terminal(tree, TerminalKind::Fold) == 4);
  CHECK(count_terminal(tree, TerminalKind::Showdown) == 11);
  CHECK(tree.nodes.size() == 29);
  CHECK(tree.num_decision_nodes == 14);
  CHECK(tree.num_terminal_nodes == 15);

  // The showdowns split 6 / 4 / 1 by the number of seats still in.
  int by_alive[5] = {0, 0, 0, 0, 0};
  for (const Node& n : tree.nodes) {
    if (n.kind == NodeKind::Terminal && n.terminal_kind == TerminalKind::Showdown) {
      ++by_alive[alive_at(tree, n, 4)];
    }
  }
  CHECK(by_alive[2] == 6);
  CHECK(by_alive[3] == 4);
  CHECK(by_alive[4] == 1);
}

TEST_CASE("preflop blinds, pot bookkeeping and action order") {
  const PreflopTreeParams params = four_way_10bb();
  const PublicTree tree = build_preflop_tree(params);
  const Node& root = tree[0];

  // Button 3 -> SB 0, BB 1, first to act 2.
  CHECK(root.commit[0] == 1);
  CHECK(root.commit[1] == 2);
  CHECK(root.commit[2] == 0);
  CHECK(root.commit[3] == 0);
  CHECK(root.pot == 3);
  CHECK(root.kind == NodeKind::Decision);
  CHECK(root.actor == 2);
  CHECK(root.street == Street::Preflop);

  // Action order is 2, 3, 0, 1: walk the all-fold line.
  const std::array<int, 3> order{2, 3, 0};
  NodeId id = 0;
  for (std::size_t i = 0; i < order.size(); ++i) {
    CHECK(tree[id].actor == order[i]);
    // Child 0 is the fold (offered first whenever facing a bet).
    CHECK(tree[tree[id].first_child].action_kind == ActionKind::Fold);
    id = tree[id].first_child;
  }
  // Everyone folded to the big blind, so the hand is over without the big
  // blind ever acting.
  CHECK(tree[id].kind == NodeKind::Terminal);
  CHECK(tree[id].terminal_kind == TerminalKind::Fold);
  CHECK(tree[id].fold_winner == 1);

  // pot == dead + sum(commit) everywhere, and a fold never moves chips.
  for (const Node& n : tree.nodes) {
    Chips sum = params.dead;
    for (int s = 0; s < params.num_seats; ++s) sum += n.commit[s];
    CHECK(n.pot == sum);
    if (n.action_kind == ActionKind::Fold) {
      CHECK(n.commit == tree[n.parent].commit);
      CHECK(n.folded_mask != tree[n.parent].folded_mask);
    }
  }
}

TEST_CASE("a fold ends the hand only when one seat is left") {
  const PublicTree tree = build_preflop_tree(four_way_10bb());
  int folds_that_continue = 0;
  int folds_that_close_to_showdown = 0;
  for (const Node& n : tree.nodes) {
    if (n.action_kind != ActionKind::Fold) continue;
    if (alive_at(tree, n, 4) == 1) {
      // Everyone else is gone: this is the one shape where a fold wins a pot.
      CHECK(n.kind == NodeKind::Terminal);
      CHECK(n.terminal_kind == TerminalKind::Fold);
    } else {
      // Two or more seats remain, so a FOLD terminal would be wrong. The node
      // is either another decision, or - when the folder was last to act - a
      // showdown between whoever is still in.
      CHECK(n.terminal_kind != TerminalKind::Fold);
      if (n.kind == NodeKind::Terminal) {
        CHECK(n.terminal_kind == TerminalKind::Showdown);
        ++folds_that_close_to_showdown;
      } else {
        ++folds_that_continue;
      }
    }
  }
  // Both are the structural difference from the heads-up postflop builder,
  // where every fold is a leaf and every fold ends the hand.
  CHECK(folds_that_continue > 0);
  CHECK(folds_that_close_to_showdown > 0);
}

TEST_CASE("the blinds follow the button at every seat") {
  for (int button = 0; button < 4; ++button) {
    PreflopTreeParams params = four_way_10bb();
    params.button = button;
    const PublicTree tree = build_preflop_tree(params);
    const int sb = (button + 1) % 4;
    const int bb = (button + 2) % 4;
    CHECK(tree[0].commit[sb] == 1);
    CHECK(tree[0].commit[bb] == 2);
    CHECK(tree[0].actor == (bb + 1) % 4);
    // The shape does not depend on which seat holds the button.
    CHECK(tree.nodes.size() == 29);
  }
}

TEST_CASE("heads-up: the button is the small blind and acts first") {
  PreflopTreeParams p;
  p.num_seats = 2;
  p.small_blind = 1;
  p.big_blind = 2;
  p.button = 0;
  p.stack[0] = 20;
  p.stack[1] = 20;
  const PublicTree tree = build_preflop_tree(p);

  CHECK(tree[0].commit[0] == 1);  // button posts the small blind
  CHECK(tree[0].commit[1] == 2);
  CHECK(tree[0].actor == 0);  // and acts first preflop

  // fold | jam, then BB folds | calls: 3 decisions, 2 folds, 1 showdown.
  CHECK(tree.num_decision_nodes == 2);
  CHECK(count_terminal(tree, TerminalKind::Fold) == 2);
  CHECK(count_terminal(tree, TerminalKind::Showdown) == 1);
}

TEST_CASE("a short stack jams for less and leaves distinct commit levels") {
  PreflopTreeParams p = four_way_10bb();
  p.stack[2] = 7;   // first to act is short
  p.stack[3] = 20;
  p.stack[0] = 12;
  p.stack[1] = 20;
  const PublicTree tree = build_preflop_tree(p);

  // Seat 2 jams 7, seat 3 jams 20, seat 0 jams 12, seat 1 calls 20:
  // three distinct commit levels plus the caller, i.e. two side pots.
  NodeId id = 0;
  for (int step = 0; step < 4; ++step) {
    const Node& n = tree[id];
    REQUIRE(n.kind == NodeKind::Decision);
    // The jam is always the last child (fold first when one is offered).
    id = n.first_child + n.num_children - 1;
  }
  const Node& showdown = tree[id];
  CHECK(showdown.kind == NodeKind::Terminal);
  CHECK(showdown.terminal_kind == TerminalKind::Showdown);
  CHECK(showdown.commit[2] == 7);
  CHECK(showdown.commit[3] == 20);
  CHECK(showdown.commit[0] == 12);
  CHECK(showdown.commit[1] == 20);
  CHECK(showdown.pot == 59);
  CHECK(showdown.folded_mask == 0);
}

TEST_CASE("a seat all-in for its blind never acts") {
  PreflopTreeParams p;
  p.num_seats = 3;
  p.small_blind = 1;
  p.big_blind = 2;
  p.button = 2;  // SB 0, BB 1, first to act 2
  p.stack[0] = 20;
  p.stack[1] = 2;  // big blind is all-in from posting
  p.stack[2] = 20;
  const PublicTree tree = build_preflop_tree(p);

  CHECK(tree[0].commit[1] == 2);
  for (const Node& n : tree.nodes) {
    CHECK(n.actor != 1);
  }
}

TEST_CASE("build_preflop_tree rejects what it does not implement") {
  PreflopTreeParams p = four_way_10bb();
  p.num_seats = 1;
  CHECK_THROWS(build_preflop_tree(p));

  p = four_way_10bb();
  p.button = 4;
  CHECK_THROWS(build_preflop_tree(p));

  p = four_way_10bb();
  p.stack[1] = 0;
  CHECK_THROWS(build_preflop_tree(p));

  p = four_way_10bb();
  p.jam_only = false;
  CHECK_THROWS(build_preflop_tree(p));

  p = four_way_10bb();
  p.open_bb = {2.5};
  CHECK_THROWS(build_preflop_tree(p));
}
