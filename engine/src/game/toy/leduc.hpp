#pragma once
#include <cstdint>
#include <vector>

#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "solver/deal.hpp"

namespace engine::toy {

// Leduc hold'em (OpenSpiel rules): 6-card deck (J,J,Q,Q,K,K), one private
// card each, ante 1. Round 1 bet size 2, then one community card, round 2
// bet size 4; at most 2 raises per round. Pair with the community card wins,
// else high card; ties split. Card ids 0..5, rank = id / 2 (J=0, Q=1, K=2).
class LeducGame final : public Game, public DealGame {
 public:
  LeducGame() {
    range_.assign(6, 1.0f);
    build();
  }

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return 2; }
  int num_hands(int) const override { return 6; }
  const std::vector<float>& initial_range(int) const override { return range_; }
  bool hand_blocks_card(int, int hand, int card) const override { return hand == card; }
  const std::vector<std::uint16_t>& hands_blocking_card(int, int card) const override {
    // A Leduc hand IS its card, so exactly one hand blocks each board card.
    static const std::vector<std::vector<std::uint16_t>> blocking = [] {
      std::vector<std::vector<std::uint16_t>> v(6);  // 6-card deck
      for (int c = 0; c < 6; ++c) v[c] = {static_cast<std::uint16_t>(c)};
      return v;
    }();
    return blocking[static_cast<std::size_t>(card)];
  }
  // 6 cards minus 2 private ones: each community card has probability 1/4
  // conditional on the private hands; blocked cards are masked via reach.
  double chance_weight(NodeId) const override { return 0.25; }
  double total_profile_weight() const override { return 30.0; }  // 6 * 5 deals

  void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                      std::vector<float>& out) const override {
    const std::vector<float>& opp = reach[1 - seat];
    out.assign(6, 0.0f);
    for (int h = 0; h < 6; ++h) {
      for (int o = 0; o < 6; ++o) {
        if (o != h) out[h] += opp[o];
      }
    }
  }

  std::vector<std::uint16_t> hand_dictionary(int) const override {
    return {0, 1, 2, 3, 4, 5};
  }

  void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const override {
    std::uint8_t cards[3];
    deal_cards(seed, iter, 6, 3, cards);
    out.hole_per_seat = 1;
    out.board_count = 1;
    for (int s = 0; s < 2; ++s) {
      out.hole[static_cast<std::size_t>(s)] = cards[s];
      out.hand[static_cast<std::size_t>(s)] = cards[s];  // a Leduc hand IS its card
    }
    out.board[0] = cards[2];
  }

  void deal_showdown_values(NodeId id, int seat, const Deal& deal,
                            const std::vector<std::uint32_t>&,
                            std::vector<float>& out) const override {
    const Node& node = tree_[id];
    // The sampled traversal only reaches terminals whose chance path matches
    // the deal, so the node's own community card and deal.board[0] agree.
    const int comm = comm_card_[id];
    const int o = deal.hand[static_cast<std::size_t>(1 - seat)];
    const int so = strength(o, comm);
    const double my_commit = static_cast<double>(node.commit[seat]);
    out.assign(6, 0.0f);
    for (int h = 0; h < 6; ++h) {
      const int sh = strength(h, comm);
      const double share =
          sh > so ? static_cast<double>(node.pot) : (sh < so ? 0.0 : node.pot / 2.0);
      out[static_cast<std::size_t>(h)] = static_cast<float>(share - my_commit);
    }
  }

  void terminal_values(NodeId id, int seat,
                       const std::vector<std::vector<float>>& reach,
                       std::vector<float>& out) const override {
    const Node& node = tree_[id];
    const std::vector<float>& opp = reach[1 - seat];
    const Chips my_commit = node.commit[seat];
    const int comm = comm_card_[id];
    for (int h = 0; h < 6; ++h) {
      if (h == comm) {
        out[h] = 0.0f;  // impossible holding; masked by the caller anyway
        continue;
      }
      float v = 0.0f;
      for (int o = 0; o < 6; ++o) {
        if (o == h || o == comm) continue;
        double share = 0.0;
        if (node.terminal_kind == TerminalKind::Fold) {
          share = (node.fold_winner == seat) ? static_cast<double>(node.pot) : 0.0;
        } else {
          const int sh = strength(h, comm);
          const int so = strength(o, comm);
          share = sh > so ? static_cast<double>(node.pot) : (sh < so ? 0.0 : node.pot / 2.0);
        }
        v += opp[o] * static_cast<float>(share - static_cast<double>(my_commit));
      }
      out[h] = v;
    }
  }

 private:
  static int strength(int hand, int comm) {
    const int rank = hand / 2;
    return (comm >= 0 && comm / 2 == rank) ? 10 + rank : rank;
  }

  NodeId add(Node n, int comm) {
    tree_.nodes.push_back(n);
    comm_card_.push_back(comm);
    return static_cast<NodeId>(tree_.nodes.size() - 1);
  }

  // Recursively expand a betting-round decision node. `facing` is the
  // outstanding bet delta the actor must match; `raises` counts bets+raises
  // made this round. When the round ends without a fold, round 1 leads to
  // the chance node (community card) and round 2 to showdown.
  void expand_decision(NodeId id, int round, int raises) {
    const Node parent = tree_[id];
    const int comm = comm_card_[id];
    const int actor = parent.actor;
    const int other = 1 - actor;
    const Chips bet_size = round == 1 ? 2 : 4;
    const Chips facing = parent.commit[other] - parent.commit[actor];

    std::vector<Node> children;
    std::vector<int> child_round_raises;  // raises after this action; -1 = not a decision

    auto make_child = [&](NodeKind kind, ActionKind ak, Chips extra) {
      Node n;
      n.kind = kind;
      n.parent = id;
      n.action_kind = ak;
      n.actor = kind == NodeKind::Decision ? static_cast<std::uint16_t>(other) : kNoSeat;
      n.commit = parent.commit;
      n.commit[actor] += extra;
      n.action_amount = n.commit[actor];
      n.pot = parent.pot + extra;
      return n;
    };

    if (facing == 0) {
      // Check: round ends if the actor is P1 (both checked), else P1 acts.
      Node chk = make_child(actor == 1 ? NodeKind::Terminal : NodeKind::Decision,
                            ActionKind::CheckCall, 0);
      if (actor == 1) round_end(chk, round);
      children.push_back(chk);
      child_round_raises.push_back(actor == 1 ? -1 : 0);
      // Bet.
      Node bet = make_child(NodeKind::Decision, ActionKind::Bet, bet_size);
      children.push_back(bet);
      child_round_raises.push_back(1);
    } else {
      // Fold.
      Node fold = make_child(NodeKind::Terminal, ActionKind::Fold, 0);
      fold.terminal_kind = TerminalKind::Fold;
      fold.fold_winner = static_cast<std::uint16_t>(other);
      children.push_back(fold);
      child_round_raises.push_back(-1);
      // Call: round ends.
      Node call = make_child(NodeKind::Terminal, ActionKind::CheckCall, facing);
      round_end(call, round);
      children.push_back(call);
      child_round_raises.push_back(-1);
      // Raise.
      if (raises < 2) {
        Node raise = make_child(NodeKind::Decision, ActionKind::Bet, facing + bet_size);
        children.push_back(raise);
        child_round_raises.push_back(raises + 1);
      }
    }

    const NodeId first = static_cast<NodeId>(tree_.nodes.size());
    for (Node& c : children) add(c, comm);
    tree_[id].first_child = first;
    tree_[id].num_children = static_cast<std::uint16_t>(children.size());

    for (std::size_t i = 0; i < children.size(); ++i) {
      const NodeId cid = first + static_cast<NodeId>(i);
      if (tree_[cid].kind == NodeKind::Decision) {
        expand_decision(cid, round, child_round_raises[i]);
      } else if (tree_[cid].kind == NodeKind::Chance) {
        expand_chance(cid);
      }
    }
  }

  // A round-1 round-end becomes the community-card chance node; a round-2
  // round-end becomes a showdown terminal.
  void round_end(Node& n, int round) {
    if (round == 1) {
      n.kind = NodeKind::Chance;
      n.actor = kNoSeat;
      n.terminal_kind = TerminalKind::None;
    } else {
      n.kind = NodeKind::Terminal;
      n.terminal_kind = TerminalKind::Showdown;
      n.fold_winner = kNoSeat;
    }
  }

  void expand_chance(NodeId id) {
    const Node parent = tree_[id];
    const NodeId first = static_cast<NodeId>(tree_.nodes.size());
    for (int card = 0; card < 6; ++card) {
      Node n;
      n.kind = NodeKind::Decision;
      n.parent = id;
      n.action_kind = ActionKind::Deal;
      n.dealt_card = static_cast<std::int16_t>(card);
      n.actor = 0;  // P0 opens round 2
      n.commit = parent.commit;
      n.pot = parent.pot;
      add(n, card);
    }
    tree_[id].first_child = first;
    tree_[id].num_children = 6;
    for (int card = 0; card < 6; ++card) {
      expand_decision(first + static_cast<NodeId>(card), 2, 0);
    }
  }

  void build() {
    Node root;
    root.kind = NodeKind::Decision;
    root.actor = 0;
    root.pot = 2;  // antes
    add(root, -1);
    expand_decision(0, 1, 0);
    tree_.finalize();
  }

  PublicTree tree_;
  std::vector<int> comm_card_;
  std::vector<float> range_;
};

}  // namespace engine::toy
