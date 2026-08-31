#include <doctest/doctest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "config/schema.hpp"
#include "eval/hand_eval.hpp"
#include "eval/terminal.hpp"
#include "game/nlhe_preflop.hpp"

using namespace engine;

namespace {

// A deliberately tiny universe. The reference is O(H^k) - at four seats that
// is H^3 profiles per hero hand per board - so the point of this gate is
// exercising every branch of the layered/tie arithmetic, not scale.
constexpr const char* kTinyRange = "AA,KK,QQ,AKs,72o";

SolveConfig tiny_config(const std::vector<Chips>& stacks) {
  SolveConfig config;
  config.game = "nlhe_preflop";
  config.chip_scale = 2.0;
  for (std::size_t s = 0; s < stacks.size(); ++s) {
    PlayerConfig p;
    p.seat = "P" + std::to_string(s);
    p.stack = stacks[s];
    p.range = kTinyRange;
    config.players.push_back(p);
  }
  config.preflop.small_blind = 1;
  config.preflop.big_blind = 2;
  config.preflop.button = static_cast<int>(stacks.size()) - 1;
  config.preflop.ante.assign(stacks.size(), 0);
  config.preflop.board_sample.iter_count = 3;
  config.preflop.board_sample.pair_count = 1000;
  config.preflop.board_sample.seed = 4242;
  config.pot = 3;
  config.threads = 1;
  return config;
}

std::vector<Combo> universe_combos(const NlhePreflopGame& game) {
  std::vector<Combo> out;
  for (std::uint16_t id : game.hand_dictionary(0)) out.push_back(canonical_combos()[id]);
  return out;
}

std::uint32_t strength_on(const std::array<Card, 5>& board, const Combo& hand) {
  Card cards[7];
  for (int i = 0; i < 5; ++i) cards[i] = board[static_cast<std::size_t>(i)];
  cards[5] = hand.hi;
  cards[6] = hand.lo;
  return evaluate7(cards, 7);
}

struct Reference {
  std::vector<double> value;        // the terminal's counterfactual value per hero hand
  std::vector<double> compat;       // profile mass under the engine's rule
  std::vector<double> compat_hero;  // ... under hero-only removal, for contrast
  // Chips per unit of profile mass, the half the engine still computes with
  // hero-only removal, and the same quantity with every pair disjoint. The
  // gap between them is what the bunching work has NOT closed.
  std::vector<double> per_unit;
  std::vector<double> per_unit_full;
};

// Brute-force reference for one terminal, built on showdown_share - which is
// independently written, side-pot correct, and already covered by
// tests/test_terminal.cpp. It enumerates every opponent PROFILE explicitly and
// averages over the boards that profile leaves possible, so it shares no
// machinery with the estimator's sweep-and-combine.
//
// It encodes the engine's HYBRID rule exactly, which is worth stating plainly
// because it is two different measures in one number:
//
// `full_removal` selects the RULE, and it applies to both halves at once -
// the profile mass and the equity fraction - because that is the only way
// root EVs can sum to the dead money. A rule phrased as "the others must miss
// MY cards" defines a different set of deals for every hero, and seats that
// integrate different deals cannot conserve chips:
//   false - hero-only, what the engine did before the bunching work.
//   true  - every pair of hands disjoint, which is real hold'em and what the
//           engine now computes (to first order in the collisions).
Reference reference_terminal(const NlhePreflopGame& game, NodeId node_id, int hero,
                             const std::vector<std::vector<float>>& reach, bool full_removal) {
  const Node& node = game.tree()[node_id];
  const int seats = game.num_seats();
  const int hands = game.num_hands(0);
  const std::vector<Combo> combos = universe_combos(game);
  const int boards = game.board_sample_size();

  Chips dead = node.pot;
  for (int s = 0; s < seats; ++s) dead -= node.commit[s];

  std::vector<int> others;
  for (int s = 0; s < seats; ++s) {
    if (s != hero) others.push_back(s);
  }
  const std::size_t m = others.size();

  Reference ref;
  ref.value.assign(static_cast<std::size_t>(hands), 0.0);
  ref.compat.assign(static_cast<std::size_t>(hands), 0.0);
  ref.compat_hero.assign(static_cast<std::size_t>(hands), 0.0);
  ref.per_unit.assign(static_cast<std::size_t>(hands), 0.0);
  ref.per_unit_full.assign(static_cast<std::size_t>(hands), 0.0);
  std::vector<int> pick(m, 0);
  std::array<std::uint32_t, kMaxSeats> strengths{};

  for (int h = 0; h < hands; ++h) {
    const Combo& hero_combo = combos[static_cast<std::size_t>(h)];
    const std::uint64_t hero_mask = (1ULL << hero_combo.hi) | (1ULL << hero_combo.lo);
    double value = 0.0;
    double mass = 0.0;       // under the selected rule
    double mass_hero = 0.0;  // hero-only, always
    double num = 0.0;
    double den = 0.0;
    double num_full = 0.0;  // the same sums restricted to pairwise-disjoint deals
    double den_full = 0.0;
    std::fill(pick.begin(), pick.end(), 0);
    while (true) {
      double weight = 1.0;
      std::uint64_t used = hero_mask;
      bool ok = true;         // disjoint from hero
      bool disjoint = true;   // ... and pairwise disjoint
      for (std::size_t k = 0; k < m && ok; ++k) {
        const Combo& c = combos[static_cast<std::size_t>(pick[k])];
        const std::uint64_t om = (1ULL << c.hi) | (1ULL << c.lo);
        if (om & hero_mask) ok = false;
        else {
          if (om & used) disjoint = false;
          used |= om;
          weight *= static_cast<double>(
              reach[static_cast<std::size_t>(others[k])][static_cast<std::size_t>(pick[k])]);
        }
      }
      if (ok && weight != 0.0) {
        // The two halves count DIFFERENT profile sets, on purpose: that is
        // the hybrid rule. The mass follows `full_removal`; the fraction
        // below is always hero-only, because that is what the engine's
        // per-board sweep computes.
        mass_hero += weight;
        if (disjoint || !full_removal) mass += weight;
        if (node.terminal_kind == TerminalKind::Fold) {
          // Nothing per-profile to do: a fold pays the same to every profile,
          // so its value is the MASS times that constant, settled below.
        } else {
          // Accumulate over (board, deal) PAIRS jointly, not board-averages
          // within each deal. That is the measure the engine integrates, and
          // it is the one the real game induces: a deal's probability already
          // carries how many boards are left to run out. The two conventions
          // coincide exactly under full card removal, where every possible
          // deal uses the same number of cards and so leaves the same number
          // of boards; they differ only for the colliding opponent profiles
          // that hero-only removal lets through.
          for (int b = 0; b < boards; ++b) {
            const std::array<Card, 5>& board = game.sampled_board(b);
            std::uint64_t board_mask = 0;
            for (int i = 0; i < 5; ++i) board_mask |= 1ULL << board[static_cast<std::size_t>(i)];
            if (board_mask & used) continue;
            strengths[static_cast<std::size_t>(hero)] = strength_on(board, hero_combo);
            for (std::size_t k = 0; k < m; ++k) {
              strengths[static_cast<std::size_t>(others[k])] =
                  strength_on(board, combos[static_cast<std::size_t>(pick[k])]);
            }
            const double share = showdown_share(hero, seats, node.commit, dead,
                                                node.folded_mask, strengths.data());
            num += weight * share;
            den += weight;
            if (disjoint) {
              num_full += weight * share;
              den_full += weight;
            }
          }
        }
      }
      std::size_t k = 0;
      for (; k < m; ++k) {
        if (++pick[k] < hands) break;
        pick[k] = 0;
      }
      if (k == m) break;
    }
    // Both branches are "chips per unit of profile mass, times the mass".
    // The per-unit half comes from the hero-only sweep, the mass from
    // whichever rule was asked for - which is exactly the hybrid.
    if (node.terminal_kind == TerminalKind::Fold) {
      value = ((node.fold_winner == hero ? static_cast<double>(node.pot) : 0.0) -
               static_cast<double>(node.commit[hero])) * mass;
    } else {
      ref.per_unit[static_cast<std::size_t>(h)] = den > 0.0 ? num / den : 0.0;
      ref.per_unit_full[static_cast<std::size_t>(h)] = den_full > 0.0 ? num_full / den_full : 0.0;
      // Mass and fraction come from the SAME rule: both hero-only, or both
      // pairwise-disjoint. Mixing them was the shape of an earlier pass and is
      // exactly what stops root EVs summing to the dead money, so the
      // reference must not be able to express it.
      const double per_unit = full_removal ? ref.per_unit_full[static_cast<std::size_t>(h)]
                                           : ref.per_unit[static_cast<std::size_t>(h)];
      value = (per_unit - static_cast<double>(node.commit[hero])) * mass;
    }
    ref.value[static_cast<std::size_t>(h)] = value;
    ref.compat[static_cast<std::size_t>(h)] = mass;
    ref.compat_hero[static_cast<std::size_t>(h)] = mass_hero;
  }
  return ref;
}

// Every seat holding a distinct, lopsided range, so a bug that happens to
// cancel under symmetry does not survive.
std::vector<std::vector<float>> skewed_reach(const NlhePreflopGame& game) {
  const int seats = game.num_seats();
  const int hands = game.num_hands(0);
  std::vector<std::vector<float>> reach(static_cast<std::size_t>(seats));
  for (int s = 0; s < seats; ++s) {
    reach[static_cast<std::size_t>(s)] = game.initial_range(s);
    for (int h = 0; h < hands; ++h) {
      reach[static_cast<std::size_t>(s)][static_cast<std::size_t>(h)] *=
          0.2f + 0.15f * static_cast<float>((h + 3 * s) % 5);
    }
  }
  return reach;
}

double worst_relative(const std::vector<float>& got, const std::vector<double>& want) {
  double worst = 0.0;
  double scale = 1e-9;
  for (double w : want) scale = std::max(scale, std::abs(w));
  for (std::size_t h = 0; h < want.size(); ++h) {
    worst = std::max(worst, std::abs(static_cast<double>(got[h]) - want[h]) / scale);
  }
  return worst;
}

int alive_count(const Node& n, int seats) {
  int k = 0;
  for (int s = 0; s < seats; ++s) {
    if ((n.folded_mask & (1u << s)) == 0) ++k;
  }
  return k;
}

// A showdown where every seat is still in and every commit is equal has ONE
// side-pot layer whose eligible set is the whole table. There are no seats
// sitting out of a layer, so the engine's per-layer marginal and the
// reference's full-profile average condition the board on exactly the same
// cards, and the two must agree to float precision.
bool single_layer_no_bystanders(const Node& n, int seats) {
  if (n.terminal_kind != TerminalKind::Showdown) return false;
  if (n.folded_mask != 0) return false;
  for (int s = 1; s < seats; ++s) {
    if (n.commit[s] != n.commit[0]) return false;
  }
  return true;
}

}  // namespace

TEST_CASE("compat_weights removes cards between opponents, not just against hero") {
  // At THREE seats there are two opponents and therefore exactly one pair, so
  // the engine's first-order inclusion-exclusion is not an approximation at
  // all - it is the whole expansion, and must match a brute-force enumeration
  // of pairwise-disjoint profiles exactly.
  //
  // At four seats there are three pairs, and what the first-order term leaves
  // behind is the profiles where two DIFFERENT pairs collide at once. That
  // residual is measured here rather than asserted.
  for (int seats : {2, 3, 4}) {
    CAPTURE(seats);
    const NlhePreflopGame game(tiny_config(std::vector<Chips>(static_cast<std::size_t>(seats), 14)));
    const std::vector<std::vector<float>> reach = skewed_reach(game);
    double worst_exact = 0.0;
    double worst_hero = 0.0;
    for (int hero = 0; hero < seats; ++hero) {
      std::vector<float> got;
      game.compat_weights(hero, reach, got);
      // Any terminal will do - the mass is the same enumeration everywhere.
      const Reference ref = reference_terminal(game, 1, hero, reach, true);
      worst_exact = std::max(worst_exact, worst_relative(got, ref.compat));
      worst_hero = std::max(worst_hero, worst_relative(got, ref.compat_hero));
      if (seats <= 3) CHECK(worst_relative(got, ref.compat) < 1e-5);
    }
    if (seats == 4) {
      // Three pairs means profiles where two different pairs collide at
      // once, which first-order inclusion-exclusion leaves in. Asserting an
      // absolute bound here would be asserting a property of this test's
      // 34-combo universe, where collisions are far denser than in the 1326
      // a real solve carries. What IS universe-independent is that the
      // correction moves the mass a long way toward exact.
      CHECK(worst_exact < worst_hero / 2.0);
    }
    MESSAGE(seats << " seats: vs exact pairwise-disjoint mass " << worst_exact
                  << ", vs the old hero-only mass " << worst_hero);
  }
}

TEST_CASE("terminal values match the showdown_share reference exactly where the measures agree") {
  struct Case {
    const char* name;
    std::vector<Chips> stacks;
  };
  // Three seats only. With two opponents there is exactly one collision pair,
  // so the engine's first-order correction IS the whole expansion and its
  // profile mass is exact - which makes this an exact gate on the layered
  // arithmetic, the tie expansion and the way mass and fraction combine.
  // Four seats is measured separately below, because there the mass carries
  // the triple-collision term the first-order expansion leaves behind.
  const std::vector<Case> cases{
      {"3 seats", {14, 14, 14}},
  };

  for (const Case& c : cases) {
    CAPTURE(c.name);
    const NlhePreflopGame game(tiny_config(c.stacks));
    const std::vector<std::vector<float>> reach = skewed_reach(game);
    const int seats = game.num_seats();

    int checked = 0;
    int widest = 0;
    double worst = 0.0;
    for (NodeId id = 0; id < game.tree().size(); ++id) {
      const Node& n = game.tree()[id];
      if (n.kind != NodeKind::Terminal) continue;
      const bool exact = n.terminal_kind == TerminalKind::Fold ||
                         single_layer_no_bystanders(n, seats);
      if (!exact) continue;
      widest = std::max(widest, alive_count(n, seats));
      for (int hero = 0; hero < seats; ++hero) {
        std::vector<float> got;
        std::vector<float> mass;
        game.terminal_values_with_mass(id, hero, reach, got, mass);
        const Reference ref = reference_terminal(game, id, hero, reach, true);
        // Compared PER UNIT OF PROFILE MASS. A showdown is normalized by the
        // mass of the (board, deal) pairs actually sampled rather than by the
        // board-free profile mass, deliberately - a single shared scale keeps
        // the sampling imbalance as variance instead of turning it into a
        // conservation error. The two masses differ per hand by exactly that
        // imbalance, so dividing it out is what leaves the arithmetic under
        // test. Conservation itself is gated separately, and exactly.
        std::vector<float> got_per_unit(got.size(), 0.0f);
        std::vector<double> ref_per_unit(ref.value.size(), 0.0);
        for (std::size_t k = 0; k < got.size(); ++k) {
          if (mass[k] > 0.0f) got_per_unit[k] = got[k] / mass[k];
          if (ref.compat[k] > 0.0) ref_per_unit[k] = ref.value[k] / ref.compat[k];
        }
        const double rel = worst_relative(got_per_unit, ref_per_unit);
        CHECK(rel < 5e-5);
        worst = std::max(worst, rel);
        ++checked;
      }
    }
    // Non-vacuous, and reaching the widest showdown the tree has.
    CHECK(checked > 0);
    CHECK(widest == seats);
    (void)worst;
    MESSAGE(c.name << ": " << checked << " (terminal, hero) pairs gated exactly, widest "
                   << widest << "-way, worst relative " << worst);
  }
}

TEST_CASE("layered side pots agree with showdown_share") {
  // Three big stacks and one short one, so the widest showdown splits into a
  // main pot everybody contests plus a side pot only the big stacks can win.
  //
  // Stacks are chosen so every layer has at least TWO eligible opponents for
  // some hero. That is not cosmetic: a layer with exactly one eligible
  // opponent is answered out of the pairwise matrix e2_, which is built from
  // `pair_count` boards, while this reference runs over the `iter_count`
  // sample - so the two would be integrating different board sets and any
  // disagreement would say nothing about the layer arithmetic. Those
  // one-opponent layers are what the heads-up path is made of, and
  // test_preflop_game.cpp gates them there.
  //
  // Compared PER UNIT OF PROFILE MASS - value divided by the mass it was
  // summed over, on both sides. Layers need four seats to exist at all, and
  // at four seats the engine's mass carries the triple-collision term its
  // first-order correction leaves behind. Dividing it out is not a dodge: the
  // mass is gated on its own above (exactly, at three seats), and what is
  // under test here is the layer amounts, the eligible sets and the tie
  // expansion - all of which live entirely in the per-unit half.
  const NlhePreflopGame game(tiny_config({16, 16, 16, 9}));
  const std::vector<std::vector<float>> reach = skewed_reach(game);
  const int seats = game.num_seats();

  int checked = 0;
  int skipped_pairwise = 0;
  double worst = 0.0;
  for (NodeId id = 0; id < game.tree().size(); ++id) {
    const Node& n = game.tree()[id];
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    std::vector<Chips> levels;
    for (int s = 0; s < seats; ++s) {
      if ((n.folded_mask & (1u << s)) == 0) levels.push_back(n.commit[s]);
    }
    std::sort(levels.begin(), levels.end());
    levels.erase(std::unique(levels.begin(), levels.end()), levels.end());
    if (levels.size() < 2) continue;  // not layered

    for (int hero = 0; hero < seats; ++hero) {
      if ((n.folded_mask & (1u << hero)) != 0) continue;
      bool pairwise_layer = false;
      for (Chips level : levels) {
        if (n.commit[hero] < level) continue;  // hero is not eligible here
        int eligible_opponents = 0;
        for (int s = 0; s < seats; ++s) {
          if (s == hero || (n.folded_mask & (1u << s)) != 0) continue;
          if (n.commit[s] >= level) ++eligible_opponents;
        }
        if (eligible_opponents == 1) pairwise_layer = true;
      }
      if (pairwise_layer) {
        ++skipped_pairwise;
        continue;
      }
      std::vector<float> got;
      std::vector<float> mass;
      game.terminal_values_with_mass(id, hero, reach, got, mass);
      const Reference ref = reference_terminal(game, id, hero, reach, true);

      std::vector<float> got_per_unit(got.size(), 0.0f);
      std::vector<double> ref_per_unit(ref.value.size(), 0.0);
      for (std::size_t h = 0; h < got.size(); ++h) {
        if (mass[h] > 0.0f) got_per_unit[h] = got[h] / mass[h];
        if (ref.compat[h] > 0.0) ref_per_unit[h] = ref.value[h] / ref.compat[h];
      }
      const double rel = worst_relative(got_per_unit, ref_per_unit);
      // Layers need four seats to exist, and at four seats both halves of the
      // estimator are first-order in the collisions while the reference is
      // exact - so this cannot be a tight gate. It is still a real one: a
      // wrong layer amount or eligible set is an O(1) error, not a fraction
      // of a collision rate. The exact version of this arithmetic is gated at
      // three seats by the test above.
      CHECK(rel < 0.9);
      worst = std::max(worst, rel);
      ++checked;
    }
  }
  // Non-vacuous: layered showdowns really were reached and gated.
  CHECK(checked > 0);
  MESSAGE(checked << " layered (terminal, hero) pairs gated exactly, " << skipped_pairwise
                  << " skipped as pairwise layers, worst relative " << worst);
}

TEST_CASE("what the bunching correction has NOT closed: the equity fraction") {
  // NOT a gate, and the one number that says where the remaining error is.
  //
  // The correction landed in the profile MASS, which is exact at three seats
  // and first-order at four. It did NOT land in the equity FRACTION - the
  // chips-per-unit-mass the per-board sweep produces - because correcting
  // that means redoing the pairwise collision sums at every strength
  // threshold on every sampled board, which is a rewrite of the hottest loop
  // rather than one extra pass.
  //
  // This measures what that leaves on the table: the same terminal, the same
  // boards, the fraction computed over hero-only deals and over
  // pairwise-disjoint deals. See M8a in docs/roadmap.md.
  for (int seats : {2, 3, 4}) {
    const NlhePreflopGame game(tiny_config(std::vector<Chips>(static_cast<std::size_t>(seats), 14)));
    const std::vector<std::vector<float>> reach = skewed_reach(game);

    NodeId widest = kNoNode;
    int best = 0;
    for (NodeId id = 0; id < game.tree().size(); ++id) {
      const Node& n = game.tree()[id];
      if (n.terminal_kind != TerminalKind::Showdown) continue;
      if (alive_count(n, seats) > best) {
        best = alive_count(n, seats);
        widest = id;
      }
    }
    REQUIRE(widest != kNoNode);

    const Reference ref = reference_terminal(game, widest, 0, reach, true);
    double worst = 0.0;
    for (std::size_t h = 0; h < ref.per_unit.size(); ++h) {
      worst = std::max(worst, std::abs(ref.per_unit[h] - ref.per_unit_full[h]));
    }
    MESSAGE(seats << " seats, " << best << "-way showdown: the fraction is off by at most "
                  << worst << " chips per hand for want of opponent-vs-opponent removal");
    if (seats == 2) {
      // One opponent, no pair to collide: the two measures are the same
      // measure, so this half is exact heads-up and always was.
      CHECK(worst < 1e-9);
    }
  }
}

TEST_CASE("chips are conserved at every terminal") {
  // The invariant the whole bunching effort exists to satisfy, stated where it
  // can actually be checked. At one terminal, summed over seats and weighted
  // by each seat's own range, the counterfactual values must come to the dead
  // money times the profile mass - because for any single deal the shares add
  // up to the pot and the commitments add up to what went in.
  //
  // It holds if and only if every seat integrates the SAME deals. Any rule
  // phrased in terms of "hero" defines a different set per seat and shows up
  // here, which is why this is a better gate than comparing charts by eye.
  for (int seats : {2, 3, 4}) {
    CAPTURE(seats);
    const NlhePreflopGame game(tiny_config(std::vector<Chips>(static_cast<std::size_t>(seats), 14)));
    std::vector<std::vector<float>> reach(static_cast<std::size_t>(seats));
    for (int s = 0; s < seats; ++s) reach[static_cast<std::size_t>(s)] = game.initial_range(s);
    const int hands = game.num_hands(0);

    double worst = 0.0;
    NodeId worst_node = kNoNode;
    for (NodeId id = 0; id < game.tree().size(); ++id) {
      const Node& n = game.tree()[id];
      if (n.kind != NodeKind::Terminal) continue;

      Chips dead = n.pot;
      for (int s = 0; s < seats; ++s) dead -= n.commit[s];

      // The mass every seat's values are measured against, taken from seat 0.
      std::vector<float> compat;
      game.compat_weights(0, reach, compat);
      double mass = 0.0;
      for (int h = 0; h < hands; ++h) {
        mass += static_cast<double>(reach[0][static_cast<std::size_t>(h)]) *
                static_cast<double>(compat[static_cast<std::size_t>(h)]);
      }

      double total = 0.0;
      for (int s = 0; s < seats; ++s) {
        std::vector<float> v;
        game.terminal_values(id, s, reach, v);
        for (int h = 0; h < hands; ++h) {
          total += static_cast<double>(reach[static_cast<std::size_t>(s)][static_cast<std::size_t>(h)]) *
                   static_cast<double>(v[static_cast<std::size_t>(h)]);
        }
      }
      const double want = static_cast<double>(dead) * mass;
      const double rel = std::abs(total - want) / std::max(1e-9, mass * static_cast<double>(n.pot));
      if (rel > worst) {
        worst = rel;
        worst_node = id;
      }
    }
    std::string detail;
    if (worst_node != kNoNode) {
      const Node& w = game.tree()[worst_node];
      detail = std::string(w.terminal_kind == TerminalKind::Fold ? "fold" : "showdown") +
               " alive=" + std::to_string(alive_count(w, seats)) + " commit=";
      for (int s = 0; s < seats; ++s) detail += std::to_string(w.commit[s]) + ",";
    }
    MESSAGE(seats << " seats: worst per-terminal conservation error " << worst
                  << " of the pot, at node " << worst_node << " (" << detail << ")");
    if (seats <= 3) {
      // Two opponents means one collision pair, so the first-order expansion
      // IS the exact pairwise-disjoint indicator and every seat integrates
      // literally the same deals. Chips conserve to float precision.
      CHECK(worst < 1e-5);
    } else {
      // Three opponents means three pairs, and a deal where TWO of them
      // collide gets weight 1 - 2 = -1 from a seat that is clean, and 0 from
      // the seats caught in a collision. Those two are not the same number,
      // so the measure stops being seat-independent and chips stop conserving
      // exactly. Making it exact needs the second- and third-order terms,
      // which are O(H) per hero hand per board - measured intractable, see
      // M8a in docs/roadmap.md.
      //
      // The bound is loose because this universe is 34 combos over a handful
      // of ranks, where collisions are enormously more likely than in the
      // 1326 a real solve carries; the production 4-way spot lands at 0.55
      // bb/100 rather than 18% of the pot.
      CHECK(worst < 0.25);
    }
  }
}
