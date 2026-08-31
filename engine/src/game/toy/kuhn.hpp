#pragma once
#include <cstdint>
#include <vector>

#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "solver/deal.hpp"

namespace engine::toy {

// Kuhn poker. 3 cards (J=0, Q=1, K=2), one per player, ante 1 each.
// P0 checks or bets 1; facing a bet: fold or call; check-check shows down.
// Analytic equilibrium family: P0 bets J with frequency a in [0, 1/3],
// bets K with 3a, bets Q never; game value for P0 is -1/18 (net of ante).
// Utilities here follow the engine convention (pot share minus post-root
// commitment), so EV_p0 at the root = ante + net value = 1 - 1/18 = 17/18.
class KuhnGame final : public Game, public DealGame {
 public:
  KuhnGame() {
    range_ = {1.0f, 1.0f, 1.0f};
    build();
  }

  const PublicTree& tree() const override { return tree_; }
  int num_seats() const override { return 2; }
  int num_hands(int) const override { return 3; }
  const std::vector<float>& initial_range(int) const override { return range_; }
  // A Kuhn hand IS its card. The vectorized core never asks (no chance
  // nodes), but the sampled core masks the hero universe against the other
  // seat's dealt card through these.
  bool hand_blocks_card(int, int hand, int card) const override { return hand == card; }
  const std::vector<std::uint16_t>& hands_blocking_card(int, int card) const override {
    static const std::vector<std::vector<std::uint16_t>> blocking = [] {
      std::vector<std::vector<std::uint16_t>> v(3);
      for (int c = 0; c < 3; ++c) v[c] = {static_cast<std::uint16_t>(c)};
      return v;
    }();
    return blocking[static_cast<std::size_t>(card)];
  }
  double chance_weight(NodeId) const override { return 1.0; }
  double total_profile_weight() const override { return 6.0; }  // 3 * 2 deals

  void compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                      std::vector<float>& out) const override {
    const std::vector<float>& opp = reach[1 - seat];
    out.assign(3, 0.0f);
    for (int h = 0; h < 3; ++h) {
      for (int o = 0; o < 3; ++o) {
        if (o != h) out[h] += opp[o];
      }
    }
  }

  std::vector<std::uint16_t> hand_dictionary(int) const override { return {0, 1, 2}; }

  void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const override {
    std::uint8_t cards[2];
    deal_cards(seed, iter, 3, 2, cards);
    out.hole_per_seat = 1;
    out.board_count = 0;
    for (int s = 0; s < 2; ++s) {
      out.hole[static_cast<std::size_t>(s)] = cards[s];
      out.hand[static_cast<std::size_t>(s)] = cards[s];  // a Kuhn hand IS its card
    }
  }

  void deal_showdown_values(NodeId id, int seat, const Deal& deal,
                            const std::vector<std::uint32_t>&,
                            std::vector<float>& out) const override {
    const Node& node = tree_[id];
    const int o = deal.hand[static_cast<std::size_t>(1 - seat)];
    const double my_commit = static_cast<double>(node.commit[seat]);
    out.assign(3, 0.0f);
    for (int h = 0; h < 3; ++h) {
      const double share =
          h > o ? static_cast<double>(node.pot) : (h < o ? 0.0 : node.pot / 2.0);
      out[static_cast<std::size_t>(h)] = static_cast<float>(share - my_commit);
    }
  }

  void terminal_values(NodeId id, int seat,
                       const std::vector<std::vector<float>>& reach,
                       std::vector<float>& out) const override {
    const Node& node = tree_[id];
    const std::vector<float>& opp = reach[1 - seat];
    const Chips my_commit = node.commit[seat];
    for (int h = 0; h < 3; ++h) {
      float v = 0.0f;
      for (int o = 0; o < 3; ++o) {
        if (o == h) continue;  // same card cannot be held by both
        double share = 0.0;
        if (node.terminal_kind == TerminalKind::Fold) {
          share = (node.fold_winner == seat) ? static_cast<double>(node.pot) : 0.0;
        } else {
          share = h > o ? static_cast<double>(node.pot) : (h < o ? 0.0 : node.pot / 2.0);
        }
        v += opp[o] * static_cast<float>(share - static_cast<double>(my_commit));
      }
      out[h] = v;
    }
  }

 private:
  void build() {
    // Nodes appended so that children are contiguous; laid out level by level.
    auto add = [this](Node n) {
      tree_.nodes.push_back(n);
      return static_cast<NodeId>(tree_.nodes.size() - 1);
    };
    auto decision = [](std::uint16_t actor, NodeId parent, ActionKind ak, Chips amount,
                       Chips pot, Chips c0, Chips c1) {
      Node n;
      n.kind = NodeKind::Decision;
      n.actor = actor;
      n.parent = parent;
      n.action_kind = ak;
      n.action_amount = amount;
      n.pot = pot;
      n.commit[0] = c0;
      n.commit[1] = c1;
      return n;
    };
    auto terminal = [](TerminalKind tk, std::uint16_t winner, NodeId parent, ActionKind ak,
                       Chips amount, Chips pot, Chips c0, Chips c1) {
      Node n;
      n.kind = NodeKind::Terminal;
      n.terminal_kind = tk;
      n.fold_winner = winner;
      n.parent = parent;
      n.action_kind = ak;
      n.action_amount = amount;
      n.pot = pot;
      n.commit[0] = c0;
      n.commit[1] = c1;
      return n;
    };

    // 0: P0 to act (pot 2 from antes).
    const NodeId root = add(decision(0, kNoNode, ActionKind::Root, 0, 2, 0, 0));
    // 1: P0 checked -> P1 to act. 2: P0 bet 1 -> P1 to act.
    const NodeId chk = add(decision(1, root, ActionKind::CheckCall, 0, 2, 0, 0));
    const NodeId bet = add(decision(1, root, ActionKind::Bet, 1, 3, 1, 0));
    tree_[root].first_child = chk;
    tree_[root].num_children = 2;
    // Children of chk: check-check showdown, P1 bets -> P0 to act.
    const NodeId chk_chk = add(terminal(TerminalKind::Showdown, kNoSeat, chk,
                                        ActionKind::CheckCall, 0, 2, 0, 0));
    const NodeId chk_bet = add(decision(0, chk, ActionKind::Bet, 1, 3, 0, 1));
    tree_[chk].first_child = chk_chk;
    tree_[chk].num_children = 2;
    // Children of bet: P1 folds, P1 calls.
    const NodeId bet_fold = add(terminal(TerminalKind::Fold, 0, bet, ActionKind::Fold, 0, 3, 1, 0));
    const NodeId bet_call = add(terminal(TerminalKind::Showdown, kNoSeat, bet,
                                         ActionKind::CheckCall, 1, 4, 1, 1));
    tree_[bet].first_child = bet_fold;
    tree_[bet].num_children = 2;
    // Children of chk_bet: P0 folds, P0 calls.
    const NodeId cb_fold = add(terminal(TerminalKind::Fold, 1, chk_bet, ActionKind::Fold, 0, 3, 0, 1));
    const NodeId cb_call = add(terminal(TerminalKind::Showdown, kNoSeat, chk_bet,
                                        ActionKind::CheckCall, 1, 4, 1, 1));
    tree_[chk_bet].first_child = cb_fold;
    tree_[chk_bet].num_children = 2;
    (void)cb_fold;
    (void)cb_call;
    (void)bet_fold;
    (void)bet_call;
    tree_.finalize();
  }

  PublicTree tree_;
  std::vector<float> range_;
};

}  // namespace engine::toy
