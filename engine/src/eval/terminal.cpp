#include "eval/terminal.hpp"

#include <algorithm>
#include <stdexcept>

#include "eval/hand_eval.hpp"

namespace engine {

RiverEvaluator::RiverEvaluator(const std::vector<Card>& board) {
  if (board.size() != 5) throw std::runtime_error("RiverEvaluator needs a 5-card board");
  board_mask_ = cards_mask(board);
  strength_.assign(kNumCombos, 0);
  valid_.assign(kNumCombos, 0);
  Card cards[7];
  for (int i = 0; i < 5; ++i) cards[i] = board[i];
  const std::vector<Combo>& combos = canonical_combos();
  for (int i = 0; i < kNumCombos; ++i) {
    if (combo_mask(i) & board_mask_) continue;
    valid_[i] = 1;
    cards[5] = combos[i].hi;
    cards[6] = combos[i].lo;
    strength_[i] = evaluate7(cards, 7);
    sorted_.push_back(i);
  }
  std::sort(sorted_.begin(), sorted_.end(),
            [this](int a, int b) { return strength_[a] < strength_[b]; });
  for (std::size_t begin = 0; begin < sorted_.size();) {
    std::size_t end = begin + 1;
    while (end < sorted_.size() && strength_[sorted_[end]] == strength_[sorted_[begin]]) ++end;
    groups_.emplace_back(static_cast<int>(begin), static_cast<int>(end));
    begin = end;
  }
}

void RiverEvaluator::compat_reach(const float* opp_reach, float* out) const {
  double total = 0.0;
  double per_card[kNumCards] = {};
  const std::vector<Combo>& combos = canonical_combos();
  for (int i : sorted_) {
    const double r = opp_reach[i];
    total += r;
    per_card[combos[i].hi] += r;
    per_card[combos[i].lo] += r;
  }
  for (int i = 0; i < kNumCombos; ++i) {
    if (!valid_[i]) {
      out[i] = 0.0f;
      continue;
    }
    out[i] = static_cast<float>(total - per_card[combos[i].hi] - per_card[combos[i].lo] +
                                opp_reach[i]);
  }
}

void RiverEvaluator::showdown_2p(const float* opp_reach, double pot, double my_delta,
                                 float* out) const {
  const std::vector<Combo>& combos = canonical_combos();

  // Totals over the full opponent range (for R(h)).
  double total = 0.0;
  double per_card[kNumCards] = {};
  for (int i : sorted_) {
    const double r = opp_reach[i];
    total += r;
    per_card[combos[i].hi] += r;
    per_card[combos[i].lo] += r;
  }

  for (int i = 0; i < kNumCombos; ++i) out[i] = 0.0f;

  // Ascending sweep: worse_* accumulate strictly-worse groups.
  double worse_total = 0.0;
  double worse_per_card[kNumCards] = {};
  for (const auto& [begin, end] : groups_) {
    // Tie-group sums (this group's own reach).
    double group_total = 0.0;
    double group_per_card[kNumCards] = {};
    for (int s = begin; s < end; ++s) {
      const int i = sorted_[s];
      const double r = opp_reach[i];
      group_total += r;
      group_per_card[combos[i].hi] += r;
      group_per_card[combos[i].lo] += r;
    }
    for (int s = begin; s < end; ++s) {
      const int i = sorted_[s];
      const Card hi = combos[i].hi;
      const Card lo = combos[i].lo;
      // Strictly worse: the identical combo is never in the worse set, so
      // the pairwise inclusion-exclusion term is zero.
      const double w = worse_total - worse_per_card[hi] - worse_per_card[lo];
      // Ties: the identical combo is in this group and blocked; the +reach
      // term cancels its double subtraction so it nets out excluded.
      const double t = group_total - group_per_card[hi] - group_per_card[lo] + opp_reach[i];
      const double compat = total - per_card[hi] - per_card[lo] + opp_reach[i];
      out[i] = static_cast<float>(w * pot + t * (pot * 0.5) - compat * my_delta);
    }
    worse_total += group_total;
    for (int s = begin; s < end; ++s) {
      const int i = sorted_[s];
      worse_per_card[combos[i].hi] += opp_reach[i];
      worse_per_card[combos[i].lo] += opp_reach[i];
    }
  }
}

void RiverEvaluator::showdown_2p_slow(const float* opp_reach, double pot, double my_delta,
                                      float* out) const {
  for (int i = 0; i < kNumCombos; ++i) {
    out[i] = 0.0f;
    if (!valid_[i]) continue;
    const std::uint64_t mask = combo_mask(i);
    double v = 0.0;
    for (int o = 0; o < kNumCombos; ++o) {
      if (!valid_[o] || (combo_mask(o) & mask)) continue;
      const double r = opp_reach[o];
      if (r == 0.0) continue;
      double share = 0.0;
      if (strength_[i] > strength_[o]) share = pot;
      else if (strength_[i] == strength_[o]) share = pot * 0.5;
      v += r * (share - my_delta);
    }
    out[i] = static_cast<float>(v);
  }
}

double RiverEvaluator::total_profile_weight_2p(const float* r0, const float* r1) const {
  // Sum over disjoint pairs via inclusion-exclusion: sum_i r0[i] * (T1 -
  // per-card sums + r1[i]).
  double total1 = 0.0;
  double per_card1[kNumCards] = {};
  const std::vector<Combo>& combos = canonical_combos();
  for (int i : sorted_) {
    total1 += r1[i];
    per_card1[combos[i].hi] += r1[i];
    per_card1[combos[i].lo] += r1[i];
  }
  double z = 0.0;
  for (int i : sorted_) {
    z += static_cast<double>(r0[i]) *
         (total1 - per_card1[combos[i].hi] - per_card1[combos[i].lo] + r1[i]);
  }
  return z;
}

double showdown_share(int seat, int num_seats, const std::array<Chips, kMaxSeats>& commit,
                      Chips dead, std::uint16_t folded_mask, const std::uint32_t* strengths) {
  // Distinct commit levels of ALIVE seats define the layers; every seat's
  // chips (folded included) fill the layers up to their own commitment.
  std::vector<Chips> levels;
  for (int s = 0; s < num_seats; ++s) {
    if (folded_mask & (1u << s)) continue;
    levels.push_back(commit[s]);
  }
  std::sort(levels.begin(), levels.end());
  levels.erase(std::unique(levels.begin(), levels.end()), levels.end());

  double share = 0.0;
  Chips prev = 0;
  bool first = true;
  for (Chips level : levels) {
    double layer = first ? static_cast<double>(dead) : 0.0;
    first = false;
    for (int s = 0; s < num_seats; ++s) {
      const Chips lo = commit[s] < prev ? commit[s] : prev;
      const Chips hi = commit[s] < level ? commit[s] : level;
      if (hi > lo) layer += static_cast<double>(hi - lo);
    }
    // Eligible: alive seats committed at least to this level.
    std::uint32_t best = 0;
    int winners = 0;
    bool seat_wins = false;
    for (int s = 0; s < num_seats; ++s) {
      if (folded_mask & (1u << s)) continue;
      if (commit[s] < level) continue;
      if (strengths[s] > best) {
        best = strengths[s];
        winners = 1;
        seat_wins = (s == seat);
      } else if (strengths[s] == best) {
        ++winners;
        if (s == seat) seat_wins = true;
      }
    }
    if (seat_wins) share += layer / winners;
    prev = level;
  }
  return share;
}

}  // namespace engine
