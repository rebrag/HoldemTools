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
  std::vector<double> value;   // the terminal's counterfactual value per hero hand
  std::vector<double> compat;  // the opponent-profile mass it was summed over
};

// Brute-force reference for one terminal, built on showdown_share - which is
// independently written, side-pot correct, and already covered by
// tests/test_terminal.cpp. It enumerates every opponent PROFILE explicitly and
// averages over the boards that profile leaves possible, so it shares no
// machinery with the estimator's sweep-and-combine.
//
// `full_removal` selects the measure:
//   false - each opponent disjoint from HERO only, the rule the engine uses.
//   true  - every pair of hands disjoint, i.e. real hold'em.
// The gap between the two is the size of the dropped bunching correction.
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
  std::vector<int> pick(m, 0);
  std::array<std::uint32_t, kMaxSeats> strengths{};

  for (int h = 0; h < hands; ++h) {
    const Combo& hero_combo = combos[static_cast<std::size_t>(h)];
    const std::uint64_t hero_mask = (1ULL << hero_combo.hi) | (1ULL << hero_combo.lo);
    double value = 0.0;
    double mass = 0.0;
    double num = 0.0;
    double den = 0.0;
    std::fill(pick.begin(), pick.end(), 0);
    while (true) {
      double weight = 1.0;
      std::uint64_t used = hero_mask;
      bool ok = true;
      for (std::size_t k = 0; k < m && ok; ++k) {
        const Combo& c = combos[static_cast<std::size_t>(pick[k])];
        const std::uint64_t om = (1ULL << c.hi) | (1ULL << c.lo);
        if (om & hero_mask) ok = false;
        else if (full_removal && (om & used)) ok = false;
        else {
          used |= om;
          weight *= static_cast<double>(
              reach[static_cast<std::size_t>(others[k])][static_cast<std::size_t>(pick[k])]);
        }
      }
      if (ok && weight != 0.0) {
        mass += weight;
        if (node.terminal_kind == TerminalKind::Fold) {
          value += weight *
                   ((node.fold_winner == hero ? static_cast<double>(node.pot) : 0.0) -
                    static_cast<double>(node.commit[hero]));
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
            num += weight * showdown_share(hero, seats, node.commit, dead, node.folded_mask,
                                           strengths.data());
            den += weight;
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
    if (node.terminal_kind != TerminalKind::Fold) {
      // value = amount won per unit of profile mass, times the whole profile
      // mass, minus what hero put in on every one of them.
      const double per_unit = den > 0.0 ? num / den : 0.0;
      value = (per_unit - static_cast<double>(node.commit[hero])) * mass;
    }
    ref.value[static_cast<std::size_t>(h)] = value;
    ref.compat[static_cast<std::size_t>(h)] = mass;
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

TEST_CASE("compat_weights matches the enumerated profile mass") {
  for (int seats : {2, 3, 4}) {
    CAPTURE(seats);
    const NlhePreflopGame game(tiny_config(std::vector<Chips>(static_cast<std::size_t>(seats), 14)));
    const std::vector<std::vector<float>> reach = skewed_reach(game);
    for (int hero = 0; hero < seats; ++hero) {
      std::vector<float> got;
      game.compat_weights(hero, reach, got);
      // Any terminal will do - the reference's mass is the same enumeration.
      const Reference ref = reference_terminal(game, 1, hero, reach, false);
      CHECK(worst_relative(got, ref.compat) < 1e-5);
    }
  }
}

TEST_CASE("terminal values match the showdown_share reference exactly where the measures agree") {
  struct Case {
    const char* name;
    std::vector<Chips> stacks;
  };
  const std::vector<Case> cases{
      {"3 seats", {14, 14, 14}},
      {"4 seats", {14, 14, 14, 14}},
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
        game.terminal_values(id, hero, reach, got);
        const Reference ref = reference_terminal(game, id, hero, reach, false);
        // f32 accumulation, and the two sides sum in completely different
        // orders over a few thousand profiles.
        const double rel = worst_relative(got, ref.value);
        CHECK(rel < 5e-5);
        worst = std::max(worst, rel);
        ++checked;
      }
    }
    // Non-vacuous, and reaching the widest showdown the tree has.
    CHECK(checked > 0);
    CHECK(widest == seats);
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
      game.terminal_values(id, hero, reach, got);
      const Reference ref = reference_terminal(game, id, hero, reach, false);
      const double rel = worst_relative(got, ref.value);
      CHECK(rel < 5e-5);
      worst = std::max(worst, rel);
      ++checked;
    }
  }
  // Non-vacuous: layered showdowns really were reached and gated.
  CHECK(checked > 0);
  MESSAGE(checked << " layered (terminal, hero) pairs gated exactly, " << skipped_pairwise
                  << " skipped as pairwise layers, worst relative " << worst);
}

TEST_CASE("the size of the dropped opponent-vs-opponent card removal") {
  // NOT a gate. The engine drops bunching at 3+ seats (it is exact at 2), and
  // this measures what that costs so the number lives somewhere other than an
  // argument. See M8a in docs/roadmap.md.
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

    const Reference hero_only = reference_terminal(game, widest, 0, reach, false);
    const Reference exact = reference_terminal(game, widest, 0, reach, true);
    // Both are unnormalized sums over different profile sets, so compare the
    // CONDITIONAL EV: value divided by the mass it was summed over.
    double worst = 0.0;
    for (std::size_t h = 0; h < hero_only.value.size(); ++h) {
      if (hero_only.compat[h] <= 0.0 || exact.compat[h] <= 0.0) continue;
      const double a = hero_only.value[h] / hero_only.compat[h];
      const double b = exact.value[h] / exact.compat[h];
      worst = std::max(worst, std::abs(a - b));
    }
    MESSAGE(seats << " seats, " << best << "-way showdown: hero-only vs full card removal, "
                  << "worst per-hand conditional-EV gap " << worst << " chips");
    if (seats == 2) {
      // One opponent means no opponent pair to collide, so the two measures
      // are the same measure and this has to be exact.
      CHECK(worst < 1e-9);
    }
  }
}
