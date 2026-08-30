#include "game/preflop_tree.hpp"

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace engine {

namespace {

struct Builder {
  const PreflopTreeParams& params;
  PublicTree tree;
  // Seats that have already acted since the last aggression, by NodeId.
  // Not derivable from Node: `commit` and `folded_mask` cannot tell "has not
  // acted yet" apart from "acted, and is still facing the same bet".
  std::vector<std::uint16_t> acted;

  NodeId add(Node n, std::uint16_t acted_mask) {
    tree.nodes.push_back(n);
    acted.push_back(acted_mask);
    return static_cast<NodeId>(tree.nodes.size() - 1);
  }

  bool alive(const Node& n, int s) const { return (n.folded_mask & (1u << s)) == 0; }
  // A seat is all-in once its post-root commitment equals everything it had.
  // Derivable from the node, so it is not carried alongside `acted`.
  bool allin(const Node& n, int s) const { return n.commit[s] >= params.stack[s]; }

  int alive_count(const Node& n) const {
    int k = 0;
    for (int s = 0; s < params.num_seats; ++s) {
      if (alive(n, s)) ++k;
    }
    return k;
  }

  std::uint16_t sole_survivor(const Node& n) const {
    for (int s = 0; s < params.num_seats; ++s) {
      if (alive(n, s)) return static_cast<std::uint16_t>(s);
    }
    return kNoSeat;
  }

  Chips current_bet(const Node& n) const {
    Chips bet = 0;
    for (int s = 0; s < params.num_seats; ++s) bet = std::max(bet, n.commit[s]);
    return bet;
  }

  // The next seat clockwise from `from` (exclusive) that still owes an
  // action: alive, not all-in, and either yet to act since the last
  // aggression or facing a raise made after it acted. kNoSeat when the
  // betting round is complete.
  //
  // Under jam_only the second clause never fires - a seat that has acted has
  // either folded or is all-in - but it is the rule a general preflop tree
  // needs, so it is written once here rather than retrofitted later.
  int next_actor(const Node& n, std::uint16_t acted_mask, int from) const {
    const Chips bet = current_bet(n);
    for (int step = 1; step <= params.num_seats; ++step) {
      const int s = (from + step) % params.num_seats;
      if (!alive(n, s) || allin(n, s)) continue;
      const bool has_acted = (acted_mask & (1u << s)) != 0;
      if (!has_acted || n.commit[s] < bet) return s;
    }
    return kNoSeat;
  }

  // Settle a node whose actor is not yet decided: continue the betting round,
  // or close the hand.
  //
  // THE SHOWDOWN SEAM. When the preflop round closes with two or more seats
  // alive, this is where M8b attaches a postflop subtree (or a depth-limited
  // continuation value). Today it is a terminal, and the entire board runout
  // is averaged inside NlhePreflopGame::terminal_values.
  void settle(NodeId id, int last_actor) {
    if (alive_count(tree[id]) <= 1) {
      Node& n = tree[id];
      n.kind = NodeKind::Terminal;
      n.terminal_kind = TerminalKind::Fold;
      n.actor = kNoSeat;
      n.fold_winner = sole_survivor(n);
      return;
    }
    const int nxt = next_actor(tree[id], acted[id], last_actor);
    if (nxt == kNoSeat) {
      Node& n = tree[id];
      n.kind = NodeKind::Terminal;
      n.terminal_kind = TerminalKind::Showdown;
      n.actor = kNoSeat;
      return;
    }
    tree[id].kind = NodeKind::Decision;
    tree[id].actor = static_cast<std::uint16_t>(nxt);
    expand_decision(id);
  }

  void expand_decision(NodeId id) {
    const Node parent = tree[id];
    const std::uint16_t parent_acted = acted[id];
    const int actor = parent.actor;
    const Chips bet = current_bet(parent);
    const Chips my_commit = parent.commit[actor];
    const Chips facing = bet - my_commit;

    // A raise clears everyone else's "has acted" flag; the actor's own is set
    // either way, since it has just acted.
    const std::uint16_t acted_after_call =
        static_cast<std::uint16_t>(parent_acted | (1u << actor));
    const std::uint16_t acted_after_raise = static_cast<std::uint16_t>(1u << actor);

    auto make_node = [&](ActionKind ak, Chips new_commit, bool folds) {
      Node n;
      n.kind = NodeKind::Decision;  // provisional; settle() decides
      n.parent = id;
      n.action_kind = ak;
      n.street = Street::Preflop;
      n.actor = kNoSeat;
      n.commit = parent.commit;
      n.folded_mask = parent.folded_mask;
      if (folds) {
        n.folded_mask |= static_cast<std::uint16_t>(1u << actor);
      } else {
        n.commit[actor] = new_commit;
      }
      n.action_amount = n.commit[actor];
      n.pot = params.dead;
      for (int s = 0; s < params.num_seats; ++s) n.pot += n.commit[s];
      n.board_mask = 0;
      return n;
    };

    struct Child {
      Node node;
      std::uint16_t acted_mask;
    };
    std::vector<Child> children;

    // Fold, offered only when facing a bet. With nothing to call it is both
    // dominated and unreachable in a jam/fold tree - the hand ends before the
    // big blind is ever asked for an option.
    if (facing > 0) {
      children.push_back({make_node(ActionKind::Fold, my_commit, true), acted_after_call});
    }

    // Jam: commit the whole stack. Below the current bet that is an all-in
    // call for less, at it a call, above it a raise. The distinction is what
    // keeps action_kind meaningful to the artifact readers.
    const Chips jam = params.stack[actor];
    const bool raises = jam > bet;
    children.push_back({make_node(raises ? ActionKind::Bet : ActionKind::CheckCall, jam, false),
                        raises ? acted_after_raise : acted_after_call});

    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    for (Child& c : children) add(c.node, c.acted_mask);
    tree[id].first_child = first;
    tree[id].num_children = static_cast<std::uint16_t>(children.size());

    for (std::size_t i = 0; i < children.size(); ++i) {
      settle(first + static_cast<NodeId>(i), actor);
    }
  }
};

}  // namespace

PublicTree build_preflop_tree(const PreflopTreeParams& params) {
  const int n = params.num_seats;
  if (n < 2 || n > kMaxSeats) {
    throw std::runtime_error("preflop tree needs 2 to " + std::to_string(kMaxSeats) +
                             " seats; got " + std::to_string(n));
  }
  if (params.button < 0 || params.button >= n) {
    throw std::runtime_error("preflop tree: button seat is out of range");
  }
  if (params.big_blind <= 0) throw std::runtime_error("preflop tree needs a positive big blind");
  if (params.small_blind < 0 || params.dead < 0) {
    throw std::runtime_error("preflop tree: negative small blind or dead money");
  }
  for (int s = 0; s < n; ++s) {
    if (params.stack[s] <= 0) {
      throw std::runtime_error("preflop tree: every stack must be positive");
    }
    if (params.ante[s] < 0) throw std::runtime_error("preflop tree: negative ante");
  }
  if (!params.jam_only) {
    throw std::runtime_error("preflop tree: only the jam/fold action set is implemented");
  }
  if (!params.open_bb.empty() || !params.raise_pct.empty() || params.max_raises != 0) {
    throw std::runtime_error("preflop tree: bet sizings are not implemented yet");
  }

  // Heads-up posts the blinds the other way round: the button IS the small
  // blind, and acts first preflop.
  const int sb = n == 2 ? params.button : (params.button + 1) % n;
  const int bb = n == 2 ? (params.button + 1) % n : (params.button + 2) % n;

  Builder builder{params, {}, {}};
  Node root;
  root.kind = NodeKind::Decision;
  root.street = Street::Preflop;
  root.actor = kNoSeat;
  root.board_mask = 0;
  root.pot = params.dead;
  for (int s = 0; s < n; ++s) {
    Chips post = params.ante[s];
    if (s == sb) post += params.small_blind;
    if (s == bb) post += params.big_blind;
    root.commit[s] = std::min(post, params.stack[s]);
    root.pot += root.commit[s];
  }
  builder.add(root, 0);
  // First to act is the seat after the big blind, so settle() is entered as
  // though the big blind had just acted. Heads-up that resolves to the
  // button/small blind, which is the standard preflop order.
  builder.settle(0, bb);
  builder.tree.finalize();
  return builder.tree;
}

}  // namespace engine
