#include "game/betting_tree.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <stdexcept>

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
  PublicTree tree;

  NodeId add(Node n) {
    tree.nodes.push_back(n);
    return static_cast<NodeId>(tree.nodes.size() - 1);
  }

  const StreetSizing& sizing_for(Street street) const {
    switch (street) {
      case Street::Flop: return params.flop;
      case Street::Turn: return params.turn;
      default: return params.river;
    }
  }

  // The street a betting round leads into when it ends without a fold:
  // the next card, or showdown when the board is complete.
  void street_end(NodeId id, Street street, Aggressor aggressor) {
    if (street == Street::River) {
      tree[id].kind = NodeKind::Terminal;
      tree[id].terminal_kind = TerminalKind::Showdown;
      tree[id].actor = kNoSeat;
    } else {
      tree[id].kind = NodeKind::Chance;
      tree[id].actor = kNoSeat;
      expand_chance(id, next_street(street), aggressor);
    }
  }

  // Deal one card: children for every card not yet public. When both seats
  // are already all-in the next street has no decisions, so the chain
  // continues straight to the next card / showdown.
  void expand_chance(NodeId id, Street street, Aggressor aggressor) {
    const Node parent = tree[id];
    const bool allin =
        parent.commit[0] >= params.effective_stack && parent.commit[1] >= params.effective_stack;
    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    std::uint16_t count = 0;
    for (int card = 0; card < kNumCards; ++card) {
      if (parent.board_mask & (1ULL << card)) continue;
      Node n;
      n.kind = allin ? (street == Street::River ? NodeKind::Terminal : NodeKind::Chance)
                     : NodeKind::Decision;
      n.terminal_kind =
          allin && street == Street::River ? TerminalKind::Showdown : TerminalKind::None;
      n.parent = id;
      n.action_kind = ActionKind::Deal;
      n.dealt_card = static_cast<std::int16_t>(card);
      n.street = street;
      n.actor = n.kind == NodeKind::Decision ? 0 : kNoSeat;  // OOP opens every street
      n.commit = parent.commit;
      n.action_amount = parent.commit[0];  // no chips move on a deal
      n.pot = parent.pot;
      n.board_mask = parent.board_mask | (1ULL << card);
      add(n);
      ++count;
    }
    tree[id].first_child = first;
    tree[id].num_children = count;
    for (std::uint16_t c = 0; c < count; ++c) {
      const NodeId cid = first + c;
      if (tree[cid].kind == NodeKind::Decision) {
        expand_decision(cid, street, 0, 0, aggressor);
      } else if (tree[cid].kind == NodeKind::Chance) {
        expand_chance(cid, next_street(street), aggressor);
      }
    }
  }

  // Expand one betting decision node. `raises` counts bets+raises this
  // street; `last_increment` is the previous bet/raise delta (min-raise
  // floor); `prev_aggressor` is the previous street's aggressor (gates OOP
  // donk sizes).
  void expand_decision(NodeId id, Street street, int raises, Chips last_increment,
                       Aggressor prev_aggressor) {
    const Node parent = tree[id];
    const int actor = parent.actor;
    const int other = 1 - actor;
    const Chips my_commit = parent.commit[actor];
    const Chips opp_commit = parent.commit[other];
    const Chips facing = opp_commit - my_commit;
    const Chips effective = params.effective_stack;
    const StreetSizing& sizing = sizing_for(street);
    const SeatSizing& seat = actor == 0 ? sizing.oop : sizing.ip;
    const double pot_now = static_cast<double>(params.pot + parent.commit[0] + parent.commit[1]);

    struct Child {
      Node node;
      bool decision;
      Chips increment = 0;
    };
    std::vector<Child> children;

    auto make_node = [&](NodeKind kind, ActionKind ak, Chips new_commit) {
      Node n;
      n.kind = kind;
      n.parent = id;
      n.action_kind = ak;
      n.street = street;
      n.actor = kind == NodeKind::Decision ? static_cast<std::uint16_t>(other) : kNoSeat;
      n.commit = parent.commit;
      n.commit[actor] = new_commit;
      n.action_amount = new_commit;
      n.pot = params.pot + n.commit[0] + n.commit[1];
      n.board_mask = parent.board_mask;
      return n;
    };

    auto add_sizes = [&](const std::vector<double>& pcts, bool is_raise) {
      std::vector<Chips> totals;
      for (double pct : pcts) {
        Chips target;
        if (is_raise) {
          const double pot_after_call = pot_now + static_cast<double>(facing);
          Chips raise_add = static_cast<Chips>(std::llround(pct / 100.0 * pot_after_call));
          if (raise_add < last_increment) raise_add = last_increment;  // min-raise
          if (raise_add < 1) raise_add = 1;
          target = opp_commit + raise_add;
        } else {
          Chips bet = static_cast<Chips>(std::llround(pct / 100.0 * pot_now));
          if (bet < 1) bet = 1;
          target = my_commit + bet;
        }
        if (target >= static_cast<Chips>(sizing.allin_threshold *
                                         static_cast<double>(effective)) ||
            target > effective) {
          target = effective;
        }
        if (target <= opp_commit) continue;  // must exceed a call
        totals.push_back(target);
      }
      std::sort(totals.begin(), totals.end());
      totals.erase(std::unique(totals.begin(), totals.end()), totals.end());
      for (Chips target : totals) {
        Child c;
        c.node = make_node(NodeKind::Decision, ActionKind::Bet, target);
        c.decision = true;
        c.increment = target - opp_commit;
        children.push_back(c);
      }
    };

    if (facing == 0) {
      // Check: the street ends when the in-position seat (1) checks back.
      Node chk = make_node(actor == 1 ? NodeKind::Terminal : NodeKind::Decision,
                           ActionKind::CheckCall, my_commit);
      children.push_back({chk, actor != 1, 0});
      if (my_commit < effective) {
        // OOP first-in vs. a prior-street aggressor uses donk sizes.
        const bool donking = actor == 0 && prev_aggressor == Aggressor::Ip;
        add_sizes(donking ? seat.donks : seat.bets, false);
      }
    } else {
      Node fold = make_node(NodeKind::Terminal, ActionKind::Fold, my_commit);
      fold.terminal_kind = TerminalKind::Fold;
      fold.fold_winner = static_cast<std::uint16_t>(other);
      children.push_back({fold, false, 0});

      // Created as Terminal; street_end() below turns it into a chance node
      // (or keeps it a showdown) when the street ends without a fold.
      Node call = make_node(NodeKind::Terminal, ActionKind::CheckCall, opp_commit);
      children.push_back({call, false, 0});

      // `raises` counts the aggressive actions already made this street, so
      // this one would be number raises + 1. "Don't 3-bet" bars that seat
      // from making number 3 or higher.
      const bool blocked_by_no_3bet = seat.no_3bet && raises >= 2;
      if (raises < sizing.max_raises && !blocked_by_no_3bet && opp_commit < effective) {
        add_sizes(seat.raises, true);
      }
    }

    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    for (Child& c : children) add(c.node);
    tree[id].first_child = first;
    tree[id].num_children = static_cast<std::uint16_t>(children.size());

    for (std::size_t i = 0; i < children.size(); ++i) {
      const NodeId cid = first + static_cast<NodeId>(i);
      const Node& child = tree[cid];
      if (child.action_kind == ActionKind::Fold) continue;

      if (child.action_kind == ActionKind::CheckCall) {
        if (facing == 0 && actor == 0) {
          // OOP checked; IP decides next.
          expand_decision(cid, street, raises, last_increment, prev_aggressor);
        } else {
          // Check-back or call ends the street. Check-backs only happen with
          // no bet this street (raises == 0) -> no aggressor; a call's last
          // bettor is `other` (the seat whose bet is being matched).
          const Aggressor aggressor =
              raises == 0 ? Aggressor::None
                          : (other == 0 ? Aggressor::Oop : Aggressor::Ip);
          street_end(cid, street, aggressor);
        }
      } else {
        // Bet or raise: opponent decides.
        expand_decision(cid, street, raises + 1, children[i].increment, prev_aggressor);
      }
    }
  }
};

}  // namespace

PublicTree build_postflop_tree(const PostflopTreeParams& params) {
  if (params.pot <= 0) throw std::runtime_error("postflop tree needs a positive root pot");
  if (params.effective_stack < 0) throw std::runtime_error("negative effective stack");
  const int board_cards = std::popcount(params.board_mask);
  if (board_cards < 3 || board_cards > 5) {
    throw std::runtime_error("postflop tree needs a 3, 4, or 5 card board");
  }

  Builder builder{params, {}};
  Node root;
  root.kind = NodeKind::Decision;
  root.actor = 0;
  root.street = params.start_street;
  root.pot = params.pot;
  root.board_mask = params.board_mask;
  builder.add(root);
  builder.expand_decision(0, params.start_street, 0, 0, params.preflop_aggressor);
  builder.tree.finalize();
  return builder.tree;
}

}  // namespace engine
