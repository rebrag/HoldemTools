#include "game/betting_tree.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>

#include "cards/cards.hpp"

namespace engine {

namespace {

Street next_street(Street s) {
  switch (s) {
    case Street::Flop: return Street::Turn;
    case Street::Turn: return Street::River;
    default: return Street::None;
  }
}

struct Builder {
  const PostflopTreeParams& params;
  std::array<Chips, kMaxSeats> stack{};
  int seats = 2;
  PublicTree tree;

  // Per-node betting-round bookkeeping. Deliberately NOT on Node: `commit`
  // and `folded_mask` cannot tell "has not acted yet" apart from "acted, and
  // is still facing the same bet", and Node is the artifact-facing struct.
  // Same split, and the same reason, as build_preflop_tree.
  struct RoundState {
    std::uint16_t acted = 0;                 // seats that acted since the last aggression
    int raises = 0;                          // aggressive actions this street
    Chips last_increment = 0;                // min-raise floor
    std::uint16_t aggressor = kNoSeat;       // last seat to bet/raise this street
    std::uint16_t prev_aggressor = kNoSeat;  // ... on the PREVIOUS street, for donk sizes
  };
  std::vector<RoundState> state;

  NodeId add(Node n, const RoundState& st) {
    tree.nodes.push_back(n);
    state.push_back(st);
    return static_cast<NodeId>(tree.nodes.size() - 1);
  }

  bool alive(const Node& n, int s) const { return (n.folded_mask & (1u << s)) == 0; }
  bool allin(const Node& n, int s) const {
    return n.commit[static_cast<std::size_t>(s)] >= stack[static_cast<std::size_t>(s)];
  }

  int alive_count(const Node& n) const {
    int k = 0;
    for (int s = 0; s < seats; ++s) {
      if (alive(n, s)) ++k;
    }
    return k;
  }

  // Seats that could still put chips in. Fewer than two of them means the
  // street has no decisions at all, which is what turns the rest of the hand
  // into a pure runout.
  int actionable_count(const Node& n) const {
    int k = 0;
    for (int s = 0; s < seats; ++s) {
      if (alive(n, s) && !allin(n, s)) ++k;
    }
    return k;
  }

  std::uint16_t sole_survivor(const Node& n) const {
    for (int s = 0; s < seats; ++s) {
      if (alive(n, s)) return static_cast<std::uint16_t>(s);
    }
    return kNoSeat;
  }

  Chips current_bet(const Node& n) const {
    Chips bet = 0;
    for (int s = 0; s < seats; ++s) bet = std::max(bet, n.commit[static_cast<std::size_t>(s)]);
    return bet;
  }

  Chips total_pot(const Node& n) const {
    Chips p = params.pot;
    for (int s = 0; s < seats; ++s) p += n.commit[static_cast<std::size_t>(s)];
    return p;
  }

  const StreetSizing& sizing_for(Street street) const {
    switch (street) {
      case Street::Flop: return params.flop;
      case Street::Turn: return params.turn;
      default: return params.river;
    }
  }

  // Seat 0 is OOP; every other seat reads the `ip` sizing. Exact at 2 seats,
  // and the only thing the config schema can express at 3+.
  const SeatSizing& seat_sizing(const StreetSizing& s, int actor) const {
    return actor == 0 ? s.oop : s.ip;
  }

  // The next seat after `from` (exclusive) that still owes an action: alive,
  // not all-in, and either yet to act since the last aggression or facing a
  // raise made after it acted. kNoSeat when the betting round is complete.
  //
  // A seat that is all-in never owes an action, but a seat facing an all-in
  // still does - which is why this cannot be short-circuited on
  // actionable_count. That check belongs at street START, where it decides
  // whether the street has decisions at all.
  int next_actor(const Node& n, const RoundState& st, int from) const {
    const Chips bet = current_bet(n);
    for (int step = 1; step <= seats; ++step) {
      const int s = (from + step) % seats;
      if (!alive(n, s) || allin(n, s)) continue;
      const bool has_acted = (st.acted & (1u << s)) != 0;
      if (!has_acted || n.commit[static_cast<std::size_t>(s)] < bet) return s;
    }
    return kNoSeat;
  }

  // Settle a node whose role is not yet decided: keep the betting round
  // going, or close it. Everything that is not a fold or a bet arrives here.
  void settle(NodeId id, int last_actor) {
    if (alive_count(tree[id]) <= 1) {
      Node& n = tree[id];
      n.kind = NodeKind::Terminal;
      n.terminal_kind = TerminalKind::Fold;
      n.actor = kNoSeat;
      n.fold_winner = sole_survivor(n);
      return;
    }
    const int nxt = next_actor(tree[id], state[id], last_actor);
    if (nxt == kNoSeat) {
      end_round(id);
      return;
    }
    tree[id].kind = NodeKind::Decision;
    tree[id].actor = static_cast<std::uint16_t>(nxt);
    expand_decision(id);
  }

  // The betting round closed with two or more seats alive: deal the next
  // card, show down, or stop at the depth limit.
  void end_round(NodeId id) {
    const Street street = tree[id].street;
    const std::uint16_t aggressor = state[id].aggressor;
    tree[id].actor = kNoSeat;
    if (street == Street::River) {
      tree[id].kind = NodeKind::Terminal;
      tree[id].terminal_kind = TerminalKind::Showdown;
      return;
    }
    if (street == params.depth_limit) {
      // Truncation point: the subtree below is replaced by a continuation
      // value. Note this catches the all-in chain too - every seat all-in on
      // the flop reaches here as an ordinary street end.
      tree[id].kind = NodeKind::Terminal;
      tree[id].terminal_kind = TerminalKind::DepthLimit;
      return;
    }
    tree[id].kind = NodeKind::Chance;
    expand_chance(id, next_street(street), aggressor);
  }

  // Deal one card: children for every card not yet public. When fewer than
  // two seats can still act the next street has no decisions, so the chain
  // continues straight to the next card / showdown.
  void expand_chance(NodeId id, Street street, std::uint16_t prev_aggressor) {
    const Node parent = tree[id];
    const bool runout = actionable_count(parent) < 2;
    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    std::uint16_t count = 0;
    RoundState fresh;
    fresh.prev_aggressor = prev_aggressor;
    for (int card = 0; card < kNumCards; ++card) {
      if (parent.board_mask & (1ULL << card)) continue;
      Node n;
      n.kind = runout ? (street == Street::River ? NodeKind::Terminal : NodeKind::Chance)
                      : NodeKind::Decision;
      n.terminal_kind =
          runout && street == Street::River ? TerminalKind::Showdown : TerminalKind::None;
      n.parent = id;
      n.action_kind = ActionKind::Deal;
      n.dealt_card = static_cast<std::int16_t>(card);
      n.street = street;
      n.actor = kNoSeat;  // settle() names the first actor
      n.commit = parent.commit;
      n.folded_mask = parent.folded_mask;
      n.action_amount = parent.commit[0];  // no chips move on a deal
      n.pot = parent.pot;
      n.board_mask = parent.board_mask | (1ULL << card);
      add(n, fresh);
      ++count;
    }
    tree[id].first_child = first;
    tree[id].num_children = count;
    for (std::uint16_t c = 0; c < count; ++c) {
      const NodeId cid = first + c;
      if (tree[cid].kind == NodeKind::Decision) {
        // Fresh round: nobody has acted, seat 0 opens. Entering settle() as
        // though the last seat had just acted starts the scan at seat 0.
        settle(cid, seats - 1);
      } else if (tree[cid].kind == NodeKind::Chance) {
        expand_chance(cid, next_street(street), prev_aggressor);
      }
    }
  }

  void expand_decision(NodeId id) {
    const Node parent = tree[id];
    const RoundState parent_state = state[id];
    const int actor = parent.actor;
    const Chips bet = current_bet(parent);
    const Chips my_commit = parent.commit[static_cast<std::size_t>(actor)];
    const Chips facing = bet - my_commit;
    const Chips my_stack = stack[static_cast<std::size_t>(actor)];
    const Street street = parent.street;
    const StreetSizing& sizing = sizing_for(street);
    const SeatSizing& seat = seat_sizing(sizing, actor);
    const double pot_now = static_cast<double>(total_pot(parent));

    // A raise clears everyone else's "has acted"; the actor's own is set
    // either way, since it has just acted.
    const std::uint16_t acted_after_call =
        static_cast<std::uint16_t>(parent_state.acted | (1u << actor));
    const std::uint16_t acted_after_raise = static_cast<std::uint16_t>(1u << actor);

    struct Child {
      Node node;
      RoundState state;
    };
    std::vector<Child> children;

    auto make_node = [&](ActionKind ak, Chips new_commit, bool folds) {
      Node n;
      n.kind = NodeKind::Decision;  // provisional; settle() decides
      n.parent = id;
      n.action_kind = ak;
      n.street = street;
      n.actor = kNoSeat;
      n.commit = parent.commit;
      n.folded_mask = parent.folded_mask;
      if (folds) {
        n.folded_mask |= static_cast<std::uint16_t>(1u << actor);
      } else {
        n.commit[static_cast<std::size_t>(actor)] = new_commit;
      }
      n.action_amount = n.commit[static_cast<std::size_t>(actor)];
      n.pot = total_pot(n);
      n.board_mask = parent.board_mask;
      return n;
    };

    auto passive_state = [&]() {
      RoundState st = parent_state;
      st.acted = acted_after_call;
      return st;
    };

    auto aggressive_state = [&](Chips increment) {
      RoundState st = parent_state;
      st.acted = acted_after_raise;
      st.raises = parent_state.raises + 1;
      st.last_increment = increment;
      st.aggressor = static_cast<std::uint16_t>(actor);
      return st;
    };

    auto add_sizes = [&](const std::vector<double>& pcts, bool is_raise) {
      std::vector<Chips> totals;
      for (double pct : pcts) {
        Chips target;
        if (is_raise) {
          const double pot_after_call = pot_now + static_cast<double>(facing);
          Chips raise_add = static_cast<Chips>(std::llround(pct / 100.0 * pot_after_call));
          if (raise_add < parent_state.last_increment) raise_add = parent_state.last_increment;
          if (raise_add < 1) raise_add = 1;
          target = bet + raise_add;
        } else {
          Chips bet_add = static_cast<Chips>(std::llround(pct / 100.0 * pot_now));
          if (bet_add < 1) bet_add = 1;
          target = my_commit + bet_add;
        }
        if (target >= static_cast<Chips>(sizing.allin_threshold *
                                         static_cast<double>(my_stack)) ||
            target > my_stack) {
          target = my_stack;
        }
        if (target <= bet) continue;  // must exceed a call
        totals.push_back(target);
      }
      std::sort(totals.begin(), totals.end());
      totals.erase(std::unique(totals.begin(), totals.end()), totals.end());
      for (Chips target : totals) {
        children.push_back(
            {make_node(ActionKind::Bet, target, false), aggressive_state(target - bet)});
      }
    };

    if (facing == 0) {
      children.push_back({make_node(ActionKind::CheckCall, my_commit, false), passive_state()});
      if (my_commit < my_stack) {
        // A donk is a first-in bet INTO the previous street's aggressor, so
        // it needs that seat to still be behind us this street. Checking that
        // it has not acted yet is what makes this reduce exactly to the
        // heads-up rule (only OOP donks, and only when IP took the last
        // street) instead of also firing for a seat betting after the
        // aggressor checked.
        const bool donking = parent_state.prev_aggressor != kNoSeat &&
                             parent_state.prev_aggressor != actor &&
                             (parent_state.acted & (1u << parent_state.prev_aggressor)) == 0;
        add_sizes(donking ? seat.donks : seat.bets, false);
      }
    } else {
      children.push_back({make_node(ActionKind::Fold, my_commit, true), passive_state()});
      // Calling for less than the bet is all-in; the tree records the smaller
      // commitment and showdown_share resolves the side pot it creates.
      children.push_back({make_node(ActionKind::CheckCall, std::min(bet, my_stack), false),
                          passive_state()});

      // `raises` counts the aggressive actions already made this street, so
      // this one would be number raises + 1. "Don't 3-bet" bars that seat
      // from making number 3 or higher.
      const bool blocked_by_no_3bet = seat.no_3bet && parent_state.raises >= 2;
      if (parent_state.raises < sizing.max_raises && !blocked_by_no_3bet && my_stack > bet) {
        add_sizes(seat.raises, true);
      }
    }

    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    for (Child& c : children) add(c.node, c.state);
    tree[id].first_child = first;
    tree[id].num_children = static_cast<std::uint16_t>(children.size());

    for (std::size_t i = 0; i < children.size(); ++i) {
      settle(first + static_cast<NodeId>(i), actor);
    }
  }
};

}  // namespace

PublicTree build_postflop_tree(const PostflopTreeParams& params) {
  if (params.pot <= 0) throw std::runtime_error("postflop tree needs a positive root pot");
  if (params.num_seats < 2 || params.num_seats > kMaxSeats) {
    throw std::runtime_error("postflop tree needs 2 to " + std::to_string(kMaxSeats) +
                             " seats; got " + std::to_string(params.num_seats));
  }
  if (params.effective_stack < 0) throw std::runtime_error("negative effective stack");
  const int board_cards = std::popcount(params.board_mask);
  if (board_cards < 3 || board_cards > 5) {
    throw std::runtime_error("postflop tree needs a 3, 4, or 5 card board");
  }
  if (params.depth_limit != Street::None) {
    // Refuse the no-ops rather than silently building a full tree: a limit
    // at or past the river never fires (the river street end is a showdown),
    // and one before the root street can never be reached.
    if (params.depth_limit >= Street::River) {
      throw std::runtime_error("depth_limit must be before the river - there is nothing below a "
                               "river street end to truncate");
    }
    if (params.depth_limit < params.start_street) {
      throw std::runtime_error("depth_limit is before the tree's own start street");
    }
  }

  Builder builder{params, {}, params.num_seats, {}, {}};
  for (int s = 0; s < params.num_seats; ++s) {
    const Chips have = params.stack[static_cast<std::size_t>(s)];
    builder.stack[static_cast<std::size_t>(s)] = have > 0 ? have : params.effective_stack;
    if (builder.stack[static_cast<std::size_t>(s)] <= 0) {
      throw std::runtime_error("postflop tree: every seat needs a positive stack (set stack[] or "
                               "effective_stack)");
    }
  }

  Node root;
  root.kind = NodeKind::Decision;
  root.actor = kNoSeat;  // settle() names it
  root.street = params.start_street;
  root.pot = params.pot;
  root.board_mask = params.board_mask;

  Builder::RoundState st;
  // The previous street's aggressor, as a seat. The config surface carries it
  // as an OOP/IP enum, which only names seats 0 and 1 - at 3+ seats that is
  // the same limitation the sizing lists have.
  st.prev_aggressor = params.preflop_aggressor == Aggressor::None ? kNoSeat
                      : params.preflop_aggressor == Aggressor::Oop
                          ? static_cast<std::uint16_t>(0)
                          : static_cast<std::uint16_t>(1);
  builder.add(root, st);
  // Entering as though the last seat had just acted starts the scan at seat 0.
  builder.settle(0, params.num_seats - 1);
  builder.tree.finalize();
  return builder.tree;
}

}  // namespace engine
