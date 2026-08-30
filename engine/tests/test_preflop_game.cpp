#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "cards/combos.hpp"
#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

std::string full_range() {
  // Every one of the 169 classes at weight 1: nobody folds a hand before the
  // solve gets to decide, which is the whole point of a push/fold chart.
  static const char* kRanks = "AKQJT98765432";
  std::string out;
  for (int i = 0; i < 13; ++i) {
    for (int j = i; j < 13; ++j) {
      if (!out.empty()) out += ",";
      if (i == j) {
        out += std::string{kRanks[i], kRanks[i]};
      } else {
        out += std::string{kRanks[i], kRanks[j], 's'};
        out += ",";
        out += std::string{kRanks[i], kRanks[j], 'o'};
      }
    }
  }
  return out;
}

// blinds 1/2 with 20-chip stacks is 10bb, the spot published Nash push/fold
// charts are quoted at.
SolveConfig pushfold_config(int seats, int pair_count, int iter_count) {
  SolveConfig config;
  config.game = "nlhe_preflop";
  config.chip_scale = 2.0;
  const std::string range = full_range();
  for (int s = 0; s < seats; ++s) {
    PlayerConfig p;
    p.seat = "P" + std::to_string(s);
    p.stack = 20;
    p.range = range;
    config.players.push_back(p);
  }
  config.preflop.small_blind = 1;
  config.preflop.big_blind = 2;
  config.preflop.button = seats - 1;
  config.preflop.ante.assign(static_cast<std::size_t>(seats), 0);
  config.preflop.board_sample.pair_count = pair_count;
  config.preflop.board_sample.iter_count = iter_count;
  config.preflop.board_sample.seed = 20260830;
  config.pot = 3;
  config.threads = 0;
  return config;
}

// Range as a percent of the 1326 combos.
double range_pct(const std::vector<float>& weights) {
  double sum = 0.0;
  for (float w : weights) sum += w;
  return 100.0 * sum / 1326.0;
}

// The average strategy's probability of `action` for every hand at a node.
std::vector<float> action_freq(const CfrSolver& solver, NodeId node, int action, int actions,
                               int hands) {
  std::vector<float> rows;
  solver.average_strategy(node, rows);
  std::vector<float> out(static_cast<std::size_t>(hands));
  for (int h = 0; h < hands; ++h) {
    out[static_cast<std::size_t>(h)] =
        rows[static_cast<std::size_t>(h) * static_cast<std::size_t>(actions) +
             static_cast<std::size_t>(action)];
  }
  return out;
}

}  // namespace

TEST_CASE("heads-up 10bb push/fold: the solved strategy is a hand-by-hand best response") {
  // The cheapest correctness check the multiway work has, and the one that
  // exercises the whole new path at two seats - where the terminal evaluator
  // is the pairwise equity matrix with EXACT card removal and no per-iteration
  // board sampling at all.
  //
  // Self-contained on purpose: rather than compare against a chart file, it
  // recomputes each hand's jam and fold value from Game::terminal_values under
  // the solved opponent strategy and checks the solved frequency against them.
  // Nothing is checked in and nothing can go stale.
  const NlhePreflopGame game(pushfold_config(2, 5000, 1));
  CfrSolver solver(game, UpdateConfig{}, 0);
  solver.run(400);

  const int hands = game.num_hands(0);
  REQUIRE(hands == 1326);

  // r:  fold | jam        (the small blind, first to act preflop heads-up)
  // r.jam: fold | call    (the big blind)
  //
  // Heads-up the BUTTON posts the small blind and acts first, so which seat
  // index that is depends on where the button sits. Read it off the tree
  // rather than assuming, or the test silently checks the wrong seat.
  const PublicTree& tree = game.tree();
  REQUIRE(tree[0].num_children == 2);
  const int sb_seat = tree[0].actor;
  const int bb_seat = 1 - sb_seat;
  const NodeId jam = tree[0].first_child + 1;
  REQUIRE(tree[jam].kind == NodeKind::Decision);
  REQUIRE(tree[jam].num_children == 2);
  const NodeId bb_folds = tree[jam].first_child;
  const NodeId showdown = tree[jam].first_child + 1;
  REQUIRE(tree[bb_folds].terminal_kind == TerminalKind::Fold);
  REQUIRE(tree[showdown].terminal_kind == TerminalKind::Showdown);

  REQUIRE(tree[jam].actor == bb_seat);
  const std::vector<float> sb_jam = action_freq(solver, 0, 1, 2, hands);
  const std::vector<float> bb_call = action_freq(solver, jam, 1, 2, hands);

  // Split the big blind's range by what it does, so each terminal is reached
  // with the reach that actually gets there.
  std::vector<std::vector<float>> folded(2), called(2);
  for (int s = 0; s < 2; ++s) folded[s] = called[s] = game.initial_range(s);
  for (int h = 0; h < hands; ++h) {
    folded[bb_seat][static_cast<std::size_t>(h)] *= 1.0f - bb_call[static_cast<std::size_t>(h)];
    called[bb_seat][static_cast<std::size_t>(h)] *= bb_call[static_cast<std::size_t>(h)];
  }

  std::vector<float> v_fold, v_bb_folds, v_showdown;
  std::vector<std::vector<float>> root(2);
  for (int s = 0; s < 2; ++s) root[s] = game.initial_range(s);
  game.terminal_values(tree[0].first_child, sb_seat, root, v_fold);
  game.terminal_values(bb_folds, sb_seat, folded, v_bb_folds);
  game.terminal_values(showdown, sb_seat, called, v_showdown);

  // Normalize both actions by the same compatible-opponent mass, so the
  // comparison is in chips per hand rather than in unnormalized sums.
  std::vector<float> compat;
  game.compat_weights(sb_seat, root, compat);

  int pure_jam = 0, pure_fold = 0, mixed = 0, wrong = 0;
  double worst_wrong = 0.0;
  for (int h = 0; h < hands; ++h) {
    const double c = compat[static_cast<std::size_t>(h)];
    if (c <= 0.0) continue;
    const double ev_fold = v_fold[static_cast<std::size_t>(h)] / c;
    const double ev_jam =
        (v_bb_folds[static_cast<std::size_t>(h)] + v_showdown[static_cast<std::size_t>(h)]) / c;
    const double gap = ev_jam - ev_fold;
    const double p = sb_jam[static_cast<std::size_t>(h)];

    // Folding is worth exactly the small blind, every time. If that is not
    // true the utility convention has drifted.
    CHECK(ev_fold == doctest::Approx(-1.0).epsilon(1e-6));

    if (p > 0.999) {
      ++pure_jam;
      if (gap < -1e-3) { ++wrong; worst_wrong = std::max(worst_wrong, -gap); }
    } else if (p < 0.001) {
      ++pure_fold;
      if (gap > 1e-3) { ++wrong; worst_wrong = std::max(worst_wrong, gap); }
    } else {
      // A mixed hand must be indifferent: that is what makes it mixable.
      ++mixed;
      if (std::abs(gap) > 1e-2) { ++wrong; worst_wrong = std::max(worst_wrong, std::abs(gap)); }
    }
  }
  CHECK(wrong == 0);
  CHECK(pure_jam > 0);
  CHECK(pure_fold > 0);
  MESSAGE("SB " << pure_jam << " pure jams, " << pure_fold << " pure folds, " << mixed
                << " mixed; worst inconsistency " << worst_wrong << " chips");
}

TEST_CASE("heads-up 10bb push/fold lands on the published Nash ranges") {
  // A band, not a chart file. Published heads-up 10bb Nash push/fold ranges
  // (HoldemResources, SnapShove and friends) put the small blind's jam near
  // 58-60% of combos and the big blind's call near 37-40%. The band is wide
  // enough that it is not a golden-file test in disguise, and narrow enough
  // that a broken terminal evaluator cannot pass it - a solver that mispriced
  // all-in equity would be out by tens of percent, not by two.
  const NlhePreflopGame game(pushfold_config(2, 5000, 1));
  CfrSolver solver(game, UpdateConfig{}, 0);
  solver.run(400);

  const int hands = game.num_hands(0);
  const PublicTree& tree = game.tree();
  const NodeId jam = tree[0].first_child + 1;

  const double sb = range_pct(action_freq(solver, 0, 1, 2, hands));
  const double bb = range_pct(action_freq(solver, jam, 1, 2, hands));
  MESSAGE("SB jams " << sb << "% of combos, BB calls " << bb << "%");
  CHECK(sb > 50.0);
  CHECK(sb < 68.0);
  CHECK(bb > 30.0);
  CHECK(bb < 46.0);
}

TEST_CASE("4-way 10bb push/fold: position ordering, and the cost of dropping bunching") {
  const NlhePreflopGame game(pushfold_config(4, 5000, 200));
  CfrSolver solver(game, UpdateConfig{}, 0);
  solver.run(200);

  const int hands = game.num_hands(0);
  const PublicTree& tree = game.tree();

  // Button on seat 3 puts the blinds on 0 and 1 and starts the action on 2,
  // so the open-jam nodes are the root and the first two fold children.
  const NodeId co = 0;
  const NodeId btn = tree[co].first_child;
  const NodeId sb = tree[btn].first_child;
  REQUIRE(tree[co].actor == 2);
  REQUIRE(tree[btn].actor == 3);
  REQUIRE(tree[sb].actor == 0);

  const double co_pct = range_pct(action_freq(solver, co, 1, 2, hands));
  const double btn_pct = range_pct(action_freq(solver, btn, 1, 2, hands));
  const double sb_pct = range_pct(action_freq(solver, sb, 1, 2, hands));
  MESSAGE("open jams: CO " << co_pct << "%, BTN " << btn_pct << "%, SB " << sb_pct << "%");

  // The fewer players left to act, the wider you open. This is the single
  // most robust qualitative fact about a push/fold chart, and it does not
  // depend on the board sample at all.
  CHECK(co_pct < btn_pct);
  CHECK(btn_pct < sb_pct);
  // The small blind is heads-up against the big blind, so its open jam is the
  // heads-up range, and the earlier seats are meaningfully tighter.
  CHECK(sb_pct > 50.0);
  CHECK(co_pct < 35.0);

  // Chip conservation, MEASURED not asserted tight. Root EVs would sum to the
  // dead money (zero here) if the terminal measure were seat-symmetric. It is
  // not: hero-only card removal lets seat 0's measure admit opponent profiles
  // in which seats 1 and 2 hold the same card, and seat 1's admits a
  // different set, so the sums differ by exactly the bunching term the engine
  // drops at 3+ seats. This number is what that costs on the target spot.
  const BrResult br = compute_best_response(game, solver);
  double total = 0.0;
  for (double ev : br.ev) total += ev;
  MESSAGE("root EVs " << br.ev[0] << " " << br.ev[1] << " " << br.ev[2] << " " << br.ev[3]
                      << "; they sum to " << total << " chips instead of 0 - the size of the "
                      << "dropped opponent-vs-opponent card removal");
  // Loose, and it is a regression guard rather than an accuracy claim: an
  // order-of-magnitude jump here would mean a new asymmetry, not bunching.
  CHECK(std::abs(total) < 0.5);
}
