#include "eval/terminal3.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

#include "eval/hand_eval.hpp"
#include "eval/terminal.hpp"

namespace engine {

namespace {

// Running sums over some set of opponent hands: the total, the per-card
// totals, and the same two for the elementwise PRODUCT of the two opponents'
// reaches (which is what the diagonal correction needs).
struct SetSums {
  double tot1 = 0.0;
  double tot2 = 0.0;
  double totd = 0.0;
  std::array<double, kNumCards> card1{};
  std::array<double, kNumCards> card2{};
  std::array<double, kNumCards> cardd{};

  void add(const Combo& c, double a, double b) {
    tot1 += a;
    tot2 += b;
    totd += a * b;
    card1[c.hi] += a;
    card1[c.lo] += a;
    card2[c.hi] += b;
    card2[c.lo] += b;
    cardd[c.hi] += a * b;
    cardd[c.lo] += a * b;
  }
  void clear() { *this = SetSums{}; }
};

}  // namespace

Showdown3::Showdown3(const std::vector<Card>& board, const std::vector<Combo>& universe) {
  if (board.size() != 5) throw std::runtime_error("Showdown3 needs a 5-card board");
  const std::uint64_t board_mask = cards_mask(board);
  combos_ = universe;
  const int hands = static_cast<int>(combos_.size());
  masks_.resize(static_cast<std::size_t>(hands));
  strength_.assign(static_cast<std::size_t>(hands), 0);
  valid_.assign(static_cast<std::size_t>(hands), 0);
  pair_index_.assign(static_cast<std::size_t>(kNumCards) * kNumCards, -1);

  Card cards[7];
  for (int i = 0; i < 5; ++i) cards[i] = board[static_cast<std::size_t>(i)];
  for (int i = 0; i < hands; ++i) {
    masks_[static_cast<std::size_t>(i)] =
        (1ULL << combos_[static_cast<std::size_t>(i)].hi) |
        (1ULL << combos_[static_cast<std::size_t>(i)].lo);
    if (masks_[static_cast<std::size_t>(i)] & board_mask) continue;
    valid_[static_cast<std::size_t>(i)] = 1;
    const Combo& c = combos_[static_cast<std::size_t>(i)];
    cards[5] = c.hi;
    cards[6] = c.lo;
    strength_[static_cast<std::size_t>(i)] = evaluate7(cards, 7);
    sorted_.push_back(i);
    pair_index_[static_cast<std::size_t>(c.hi) * kNumCards + c.lo] = i;
    pair_index_[static_cast<std::size_t>(c.lo) * kNumCards + c.hi] = i;
  }
  std::sort(sorted_.begin(), sorted_.end(), [this](int a, int b) {
    return strength_[static_cast<std::size_t>(a)] < strength_[static_cast<std::size_t>(b)];
  });
  for (std::size_t begin = 0; begin < sorted_.size();) {
    std::size_t end = begin + 1;
    while (end < sorted_.size() &&
           strength_[static_cast<std::size_t>(sorted_[end])] ==
               strength_[static_cast<std::size_t>(sorted_[begin])]) {
      ++end;
    }
    groups_.emplace_back(static_cast<int>(begin), static_cast<int>(end));
    begin = end;
  }
}

std::vector<Showdown3::Layer> Showdown3::layers_from_commits(const std::array<Chips, 3>& commit,
                                                             Chips dead, std::uint8_t folded) {
  // Distinct commit levels of ALIVE seats define the layers; every seat's
  // chips (folded included) fill the layers up to their own commitment. Same
  // rule as showdown_share, which is the reference this must reproduce.
  std::vector<Chips> levels;
  for (int s = 0; s < 3; ++s) {
    if (folded & (1u << s)) continue;
    levels.push_back(commit[static_cast<std::size_t>(s)]);
  }
  std::sort(levels.begin(), levels.end());
  levels.erase(std::unique(levels.begin(), levels.end()), levels.end());

  std::vector<Layer> out;
  Chips prev = 0;
  bool first = true;
  for (Chips level : levels) {
    Layer layer;
    layer.amount = first ? static_cast<double>(dead) : 0.0;
    first = false;
    for (int s = 0; s < 3; ++s) {
      const Chips c = commit[static_cast<std::size_t>(s)];
      const Chips lo = c < prev ? c : prev;
      const Chips hi = c < level ? c : level;
      if (hi > lo) layer.amount += static_cast<double>(hi - lo);
    }
    for (int s = 0; s < 3; ++s) {
      if (folded & (1u << s)) continue;
      if (commit[static_cast<std::size_t>(s)] < level) continue;
      layer.eligible |= static_cast<std::uint8_t>(1u << s);
    }
    if (layer.amount > 0.0) out.push_back(layer);
    prev = level;
  }
  return out;
}

void Showdown3::showdown(const float* r1, const float* r2, double pot, double my_delta,
                         float* out) const {
  const std::vector<Layer> single{{pot, 0b111}};
  showdown(r1, r2, single, my_delta, out);
}

void Showdown3::showdown(const float* r1, const float* r2, const std::vector<Layer>& layers,
                         double my_delta, float* out) const {
  const int hands = num_hands();
  for (int i = 0; i < hands; ++i) out[i] = 0.0f;

  // Sums over every valid hand, for the normalizer.
  SetSums all;
  for (int i : sorted_) {
    all.add(combos_[static_cast<std::size_t>(i)], r1[i], r2[i]);
  }

  SetSums worse;  // strictly-worse prefix, grown group by group
  SetSums group;

  for (const auto& [begin, end] : groups_) {
    group.clear();
    for (int s = begin; s < end; ++s) {
      const int i = sorted_[static_cast<std::size_t>(s)];
      group.add(combos_[static_cast<std::size_t>(i)], r1[i], r2[i]);
    }
    const std::uint32_t a = strength_[static_cast<std::size_t>(sorted_[static_cast<std::size_t>(begin)])];

    for (int s = begin; s < end; ++s) {
      const int i = sorted_[static_cast<std::size_t>(s)];
      const Card x = combos_[static_cast<std::size_t>(i)].hi;
      const Card y = combos_[static_cast<std::size_t>(i)].lo;
      const double h1 = r1[i];
      const double h2 = r2[i];

      // tot'(S): the set's mass restricted to hands that do not block the
      // hero. A hand holding both x and y IS the hero's hand, so it is
      // subtracted twice and added back once - it nets out excluded, which is
      // correct, and it is why the +r[i] term appears for sets containing the
      // hero (ties, and everything) but not for the strictly-worse set.
      const double w1 = worse.tot1 - worse.card1[x] - worse.card1[y];
      const double w2 = worse.tot2 - worse.card2[x] - worse.card2[y];
      const double t1 = group.tot1 - group.card1[x] - group.card1[y] + h1;
      const double t2 = group.tot2 - group.card2[x] - group.card2[y] + h2;
      const double a1 = all.tot1 - all.card1[x] - all.card1[y] + h1;
      const double a2 = all.tot2 - all.card2[x] - all.card2[y] + h2;

      // diag(S): the same restriction applied to the elementwise product,
      // which is the correction for the two opponents holding the identical
      // combo. Only sets intersecting themselves contribute, so the mixed
      // tie-versus-worse terms carry no diagonal at all.
      const double wd = worse.totd - worse.cardd[x] - worse.cardd[y];
      const double td = group.totd - group.cardd[x] - group.cardd[y] + h1 * h2;
      const double ad = all.totd - all.cardd[x] - all.cardd[y] + h1 * h2;

      // The 52-wide coupling term, fused across all four set pairs. card'(S,c)
      // is the set's per-card mass minus the two combos {c,x} and {c,y}, which
      // are the only members that hold c AND block the hero. Cards the hero
      // holds contribute nothing on either side.
      double cross_ww = 0.0, cross_tw = 0.0, cross_wt = 0.0, cross_tt = 0.0, cross_aa = 0.0;
      double cross_w1a = 0.0, cross_t1a = 0.0, cross_aw2 = 0.0, cross_at2 = 0.0;
      for (int c = 0; c < kNumCards; ++c) {
        if (c == x || c == y) continue;
        const std::int32_t px = pair_at(static_cast<Card>(c), x);
        const std::int32_t py = pair_at(static_cast<Card>(c), y);
        double wx1 = 0.0, wx2 = 0.0, tx1 = 0.0, tx2 = 0.0, ax1 = 0.0, ax2 = 0.0;
        if (px >= 0) {
          const std::uint32_t sp = strength_[static_cast<std::size_t>(px)];
          ax1 += r1[px];
          ax2 += r2[px];
          if (sp < a) { wx1 += r1[px]; wx2 += r2[px]; }
          else if (sp == a) { tx1 += r1[px]; tx2 += r2[px]; }
        }
        if (py >= 0) {
          const std::uint32_t sp = strength_[static_cast<std::size_t>(py)];
          ax1 += r1[py];
          ax2 += r2[py];
          if (sp < a) { wx1 += r1[py]; wx2 += r2[py]; }
          else if (sp == a) { tx1 += r1[py]; tx2 += r2[py]; }
        }
        const double cw1 = worse.card1[c] - wx1;
        const double cw2 = worse.card2[c] - wx2;
        const double ct1 = group.card1[c] - tx1;
        const double ct2 = group.card2[c] - tx2;
        const double ca1 = all.card1[c] - ax1;
        const double ca2 = all.card2[c] - ax2;
        cross_ww += cw1 * cw2;
        cross_tw += ct1 * cw2;
        cross_wt += cw1 * ct2;
        cross_tt += ct1 * ct2;
        cross_aa += ca1 * ca2;
        cross_w1a += cw1 * ca2;
        cross_t1a += ct1 * ca2;
        cross_aw2 += ca1 * cw2;
        cross_at2 += ca1 * ct2;
      }

      // S(A,B) for every set pair a layer can ask for. The diagonal is the
      // correction for both opponents holding the identical combo, so it is
      // non-zero exactly when the two sets intersect - which rules it out for
      // the mixed tie-versus-worse terms and keeps it as W, T or ALL
      // everywhere else.
      const double s_ww = w1 * w2 - cross_ww + wd;
      const double s_tw = t1 * w2 - cross_tw;  // T and W are disjoint: no diagonal
      const double s_wt = w1 * t2 - cross_wt;
      const double s_tt = t1 * t2 - cross_tt + td;
      const double s_w1a = w1 * a2 - cross_w1a + wd;
      const double s_t1a = t1 * a2 - cross_t1a + td;
      const double s_aw2 = a1 * w2 - cross_aw2 + wd;
      const double s_at2 = a1 * t2 - cross_at2 + td;
      const double compat = a1 * a2 - cross_aa + ad;

      // One kernel per layer shape. An ineligible opponent is marginalized by
      // taking its set as ALL, which keeps its card removal exact - a folded
      // seat still holds cards.
      double value = 0.0;
      for (const Layer& layer : layers) {
        if ((layer.eligible & 1u) == 0) continue;  // hero cannot win this layer
        double share = 0.0;
        switch (layer.eligible) {
          case 0b111:
            share = s_ww + 0.5 * (s_tw + s_wt) + (1.0 / 3.0) * s_tt;
            break;
          case 0b011: share = s_w1a + 0.5 * s_t1a; break;
          case 0b101: share = s_aw2 + 0.5 * s_at2; break;
          default: share = compat; break;  // 0b001: hero alone takes it
        }
        value += layer.amount * share;
      }
      out[i] = static_cast<float>(value - compat * my_delta);
    }

    for (int s = begin; s < end; ++s) {
      const int i = sorted_[static_cast<std::size_t>(s)];
      worse.add(combos_[static_cast<std::size_t>(i)], r1[i], r2[i]);
    }
  }
}

void Showdown3::compat(const float* r1, const float* r2, float* out) const {
  const int hands = num_hands();
  for (int i = 0; i < hands; ++i) out[i] = 0.0f;

  SetSums all;
  for (int i : sorted_) all.add(combos_[static_cast<std::size_t>(i)], r1[i], r2[i]);

  for (int i : sorted_) {
    const Card x = combos_[static_cast<std::size_t>(i)].hi;
    const Card y = combos_[static_cast<std::size_t>(i)].lo;
    const double a1 = all.tot1 - all.card1[x] - all.card1[y] + r1[i];
    const double a2 = all.tot2 - all.card2[x] - all.card2[y] + r2[i];
    const double ad = all.totd - all.cardd[x] - all.cardd[y] + double{r1[i]} * r2[i];
    double cross = 0.0;
    for (int c = 0; c < kNumCards; ++c) {
      if (c == x || c == y) continue;
      const std::int32_t px = pair_at(static_cast<Card>(c), x);
      const std::int32_t py = pair_at(static_cast<Card>(c), y);
      double ax1 = 0.0, ax2 = 0.0;
      if (px >= 0) { ax1 += r1[px]; ax2 += r2[px]; }
      if (py >= 0) { ax1 += r1[py]; ax2 += r2[py]; }
      cross += (all.card1[c] - ax1) * (all.card2[c] - ax2);
    }
    out[i] = static_cast<float>(a1 * a2 - cross + ad);
  }
}

void Showdown3::showdown_slow(const float* r1, const float* r2,
                              const std::array<Chips, 3>& commit, Chips dead,
                              std::uint8_t folded, double my_delta, float* out) const {
  const int hands = num_hands();
  std::array<Chips, kMaxSeats> seat_commit{};
  for (int s = 0; s < 3; ++s) seat_commit[static_cast<std::size_t>(s)] = commit[static_cast<std::size_t>(s)];

  for (int i = 0; i < hands; ++i) {
    out[i] = 0.0f;
    if (!valid(i)) continue;
    const std::uint64_t hm = masks_[static_cast<std::size_t>(i)];
    double v = 0.0;
    for (int o1 : sorted_) {
      if (masks_[static_cast<std::size_t>(o1)] & hm) continue;
      const double a = r1[o1];
      if (a == 0.0) continue;
      const std::uint64_t m1 = hm | masks_[static_cast<std::size_t>(o1)];
      for (int o2 : sorted_) {
        if (masks_[static_cast<std::size_t>(o2)] & m1) continue;
        const double b = r2[o2];
        if (b == 0.0) continue;
        const std::uint32_t str[3] = {strength_[static_cast<std::size_t>(i)],
                                      strength_[static_cast<std::size_t>(o1)],
                                      strength_[static_cast<std::size_t>(o2)]};
        // The canonical rule, layers and all - not a second guess at it.
        const double share = showdown_share(0, 3, seat_commit, dead, folded, str);
        v += a * b * (share - my_delta);
      }
    }
    out[i] = static_cast<float>(v);
  }
}

}  // namespace engine
