#include <doctest/doctest.h>

#include <array>
#include <bit>
#include <cstdint>
#include <vector>

#include "cards/cards.hpp"
#include "eval/terminal.hpp"
#include "game/betting_tree.hpp"

using namespace engine;

namespace {

PostflopTreeParams multiway_river(int seats, Chips stack) {
  PostflopTreeParams p;
  p.pot = 90;
  p.num_seats = seats;
  p.effective_stack = stack;
  p.start_street = Street::River;
  p.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d 6c"));
  p.river.oop.bets = {50.0};
  p.river.oop.raises = {100.0};
  p.river.ip.bets = {50.0};
  p.river.ip.raises = {100.0};
  p.river.max_raises = 2;
  p.river.allin_threshold = 0.9;
  return p;
}

int alive_count(const Node& n, int seats) {
  int k = 0;
  for (int s = 0; s < seats; ++s) {
    if ((n.folded_mask & (1u << s)) == 0) ++k;
  }
  return k;
}

// Walk from a node to the root collecting the actions taken, so a failure
// says which line is wrong rather than which node index is wrong.
std::vector<NodeId> path_to_root(const PublicTree& tree, NodeId id) {
  std::vector<NodeId> path;
  for (NodeId n = id; n != kNoNode; n = tree[n].parent) path.push_back(n);
  return path;
}

}  // namespace

TEST_CASE("multiway tree: a fold is not terminal until one seat remains") {
  const PublicTree tree = build_postflop_tree(multiway_river(3, 200));

  bool saw_fold_continuing = false;
  for (const Node& n : tree.nodes) {
    if (n.action_kind != ActionKind::Fold) continue;
    const int alive = alive_count(n, 3);
    if (alive >= 2) {
      // Two seats still in, so the hand is not over: this fold is either a
      // decision node for whoever acts next, or - when the folder was the
      // last seat still owing an action - the showdown between the other
      // two. What it must never be is a FOLD terminal, which is the
      // heads-up shortcut that does not generalize.
      CHECK(n.terminal_kind != TerminalKind::Fold);
      if (n.kind == NodeKind::Decision) saw_fold_continuing = true;
      else CHECK(n.terminal_kind == TerminalKind::Showdown);
    } else {
      CHECK(n.kind == NodeKind::Terminal);
      CHECK(n.terminal_kind == TerminalKind::Fold);
      CHECK(n.fold_winner != kNoSeat);
      CHECK((n.folded_mask & (1u << n.fold_winner)) == 0);
    }
  }
  CHECK(saw_fold_continuing);
}

TEST_CASE("multiway tree: every terminal is reachable, consistent and conserving") {
  for (int seats : {2, 3, 4}) {
    CAPTURE(seats);
    const PublicTree tree = build_postflop_tree(multiway_river(seats, 200));

    for (NodeId id = 0; id < tree.size(); ++id) {
      const Node& n = tree[id];
      CAPTURE(id);
      // The pot always equals dead money plus every seat's commitment,
      // folded seats included - their chips stay in the middle.
      Chips sum = 90;
      for (int s = 0; s < seats; ++s) sum += n.commit[s];
      CHECK(n.pot == sum);

      for (int c = 0; c < n.num_children; ++c) {
        CHECK(tree[n.first_child + static_cast<NodeId>(c)].parent == id);
      }

      if (n.kind == NodeKind::Decision) {
        REQUIRE(n.num_children > 0);
        CHECK(n.actor != kNoSeat);
        CHECK(n.actor < seats);
        // A seat that has folded or is all-in never gets to act.
        CHECK((n.folded_mask & (1u << n.actor)) == 0);
        CHECK(n.commit[n.actor] < 200);
      } else if (n.kind == NodeKind::Terminal) {
        CHECK(n.num_children == 0);
        CHECK(n.actor == kNoSeat);
        if (n.terminal_kind == TerminalKind::Showdown) {
          CHECK(alive_count(n, seats) >= 2);
        } else if (n.terminal_kind == TerminalKind::Fold) {
          CHECK(alive_count(n, seats) == 1);
        }
      }
    }
  }
}

TEST_CASE("multiway tree: the betting round closes only when everyone has matched") {
  for (int seats : {3, 4}) {
    CAPTURE(seats);
    const PublicTree tree = build_postflop_tree(multiway_river(seats, 200));
    for (const Node& n : tree.nodes) {
      if (n.kind != NodeKind::Terminal || n.terminal_kind != TerminalKind::Showdown) continue;
      // At a showdown every alive seat has either matched the top commitment
      // or is all-in for less. Anything else means the round closed early and
      // a seat never got to act.
      Chips bet = 0;
      for (int s = 0; s < seats; ++s) bet = std::max(bet, n.commit[s]);
      for (int s = 0; s < seats; ++s) {
        if ((n.folded_mask & (1u << s)) != 0) continue;
        CHECK((n.commit[s] == bet || n.commit[s] >= 200));
      }
    }
  }
}

TEST_CASE("multiway tree: unequal stacks build side pots that showdown_share resolves") {
  PostflopTreeParams p = multiway_river(3, 0);
  p.stack = {60, 200, 500};  // a short seat, a middle seat, a deep seat
  const PublicTree tree = build_postflop_tree(p);

  bool saw_side_pot = false;
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Terminal || n.terminal_kind != TerminalKind::Showdown) continue;
    // Nobody can commit more than their own stack.
    for (int s = 0; s < 3; ++s) CHECK(n.commit[s] <= p.stack[s]);

    std::array<Chips, kMaxSeats> commit{};
    for (int s = 0; s < 3; ++s) commit[s] = n.commit[s];
    if (!(commit[0] == commit[1] && commit[1] == commit[2])) saw_side_pot = true;

    // Whatever the layer structure, the shares of one showdown must add up to
    // exactly the pot. This is the property side pots are easiest to break.
    for (std::uint32_t a = 1; a <= 3; ++a) {
      for (std::uint32_t b = 1; b <= 3; ++b) {
        for (std::uint32_t c = 1; c <= 3; ++c) {
          const std::uint32_t strengths[3] = {a, b, c};
          double total = 0.0;
          for (int s = 0; s < 3; ++s) {
            total += showdown_share(s, 3, commit, 90, n.folded_mask, strengths);
          }
          CHECK(total == doctest::Approx(static_cast<double>(n.pot)));
        }
      }
    }
  }
  CHECK(saw_side_pot);
}

TEST_CASE("multiway tree: a street with fewer than two live seats runs out") {
  PostflopTreeParams p = multiway_river(3, 200);
  p.start_street = Street::Turn;
  p.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d"));
  p.turn = p.river;
  const PublicTree tree = build_postflop_tree(p);

  bool saw_runout = false;
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Chance) continue;
    int actionable = 0;
    for (int s = 0; s < 3; ++s) {
      if ((n.folded_mask & (1u << s)) == 0 && n.commit[s] < 200) ++actionable;
    }
    if (actionable >= 2) continue;
    saw_runout = true;
    // Nobody left to bet, so the river is dealt straight into a showdown
    // rather than into a decision.
    REQUIRE(n.num_children > 0);
    const Node& child = tree[n.first_child];
    CHECK(child.kind == NodeKind::Terminal);
    CHECK(child.terminal_kind == TerminalKind::Showdown);
  }
  CHECK(saw_runout);
}

TEST_CASE("multiway tree: seat count grows the tree without changing the heads-up one") {
  // Two seats must still produce exactly the Pio-gated tree. The full
  // node-by-node fingerprint lives in tools/tree_hash.cpp; this pins the
  // shape so a regression fails in CI rather than in a validation sweep.
  const PublicTree hu = build_postflop_tree(multiway_river(2, 200));
  CHECK(hu[0].actor == 0);
  CHECK(hu[0].num_children == 2);  // check, bet

  const PublicTree three = build_postflop_tree(multiway_river(3, 200));
  const PublicTree four = build_postflop_tree(multiway_river(4, 200));
  CHECK(three.nodes.size() > hu.nodes.size());
  CHECK(four.nodes.size() > three.nodes.size());

  // Seat 0 opens every street at any seat count, and the first decision after
  // it checks belongs to seat 1.
  for (const PublicTree* t : {&hu, &three, &four}) {
    CHECK((*t)[0].actor == 0);
    const Node& after_check = (*t)[(*t)[0].first_child];
    CHECK(after_check.kind == NodeKind::Decision);
    CHECK(after_check.actor == 1);
  }

  // Three-handed, seat 2 must get to act after seats 0 and 1 both check.
  const Node& check_check = three[three[three[0].first_child].first_child];
  CHECK(check_check.kind == NodeKind::Decision);
  CHECK(check_check.actor == 2);
  // ... and only then does the street end.
  const Node& check_check_check = three[check_check.first_child];
  CHECK(check_check_check.kind == NodeKind::Terminal);
  CHECK(check_check_check.terminal_kind == TerminalKind::Showdown);
  CHECK(path_to_root(three, three[0].first_child).size() == 2);
}

TEST_CASE("multiway tree: action wraps back round after a raise") {
  const PublicTree tree = build_postflop_tree(multiway_river(3, 200));
  // Seat 0 bets: seat 1 acts, and if seat 1 calls, seat 2 still has to act
  // before the street can close - the property a heads-up round-closing rule
  // gets wrong.
  const Node& bet = tree[tree[0].first_child + 1];
  REQUIRE(bet.action_kind == ActionKind::Bet);
  REQUIRE(bet.kind == NodeKind::Decision);
  CHECK(bet.actor == 1);

  const Node& call = tree[bet.first_child + 1];
  REQUIRE(call.action_kind == ActionKind::CheckCall);
  CHECK(call.kind == NodeKind::Decision);
  CHECK(call.actor == 2);

  // Seat 1 raising sends the action back to seat 2 and then to seat 0 again.
  const Node& raise = tree[bet.first_child + 2];
  REQUIRE(raise.action_kind == ActionKind::Bet);
  CHECK(raise.kind == NodeKind::Decision);
  CHECK(raise.actor == 2);
  const Node& raise_call = tree[raise.first_child + 1];
  CHECK(raise_call.kind == NodeKind::Decision);
  CHECK(raise_call.actor == 0);
}
