#include <doctest/doctest.h>

#include <cstddef>
#include <cstdint>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "io/artifact_writer.hpp"
#include "solver/cfr.hpp"
#include "solver/memory.hpp"

using namespace engine;

namespace {

// sizeof(std::vector<T>) is 3 pointers in a release build and 4 under MSVC's
// iterator debugging, so the expected values below are written in terms of it
// rather than as a literal. Everything else about the sizing is fixed.
constexpr std::size_t kVec = sizeof(std::vector<float>);

SolveConfig turn_config() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "Ah Kh 7c 2c";
  config.pot = 100;
  config.players = {{"OOP", 200, "AA,KK,QQ,JJ,TT,99,88"}, {"IP", 200, "AA,KK,QQ,JJ,TT,99,88"}};
  config.turn_sizing.oop.bets = {75.0};
  config.turn_sizing.ip.bets = {75.0};
  config.turn_sizing.max_raises = 0;
  config.river_sizing = config.turn_sizing;
  return config;
}

}  // namespace

TEST_CASE("memory estimate matches the sizing rule") {
  toy::KuhnGame game;
  // Kuhn: 4 decision nodes, 3 hands, 2 actions each. Regret + strategy
  // arrays: 4 * 3 * 2 cells * 2 arrays * 4 bytes = 192 bytes - the
  // nodes x hands x actions x 8 rule - plus a u32 discount stamp per
  // decision node, which the estimator must count because the solver
  // allocates it.
  constexpr std::size_t kStamps = 4 * sizeof(std::uint32_t);
  CHECK(CfrSolver::state_bytes(game) == 4 * 3 * 2 * 8 + kStamps);

  const MemoryEstimate estimate = estimate_memory(game);
  CHECK(estimate.regret_strategy_bytes == 192 + kStamps);
  CHECK(estimate.tree_bytes == game.tree().size() * sizeof(Node));

  // Workspace: one arena per concurrently walked subtree, (max_depth + 2)
  // levels deep, each level holding sigma (hands x actions) plus one
  // hands-wide buffer per remaining slot. Kuhn is 2 seats, 3 hands, 2
  // actions, and 3 levels deep from the root. Asserted exactly, not just
  // "> 0" - the term this test used to wave through is the one the
  // fail-fast check leans on.
  //
  // The three non-sigma slots are kSlotChild, kSlotHandScratch and
  // kSlotCompat, then one saved-reach slot per seat. kSlotCompat holds the
  // QRE dilation weights and is counted whether or not QRE is on, because the
  // arena is sized by kSlotsPerLevel and not by a runtime flag - this test
  // read (2 + seats) until that slot landed, which made it the one red case
  // in the suite.
  const std::size_t per_level = 3 * 2 + (3 + 2) * 3;
  const std::size_t arena = (3 + 2) * per_level * sizeof(float);
  CHECK(estimate.workspace_bytes == arena * max_live_arenas(1, 0));

  // No chance nodes, so no cache slots - only the per-node base index array,
  // which the solver assigns whether or not the schedule is enabled.
  CHECK(estimate.recalc_bytes == game.tree().size() * sizeof(std::uint32_t));
  CHECK(estimate_memory(game, 1, false).recalc_bytes == estimate.recalc_bytes);

  // Artifact export: one slice per decision node in ONE flat float buffer, all
  // of them alive at once (io/artifact_writer.cpp). Per node with 2 seats, 3
  // hands and 2 actions: reach + ev_cond = 2 x 2 x 3 floats, strategy = 3 x 2,
  // action_ev = 2 x 3. Nothing else per node - no vector headers and no heap
  // blocks, which is the point of the flat store: this is the exact size of
  // the allocation, where the per-node vectors it replaced were ten heap
  // blocks a node and the estimate had to guess what the allocator added.
  const std::size_t per_node = (2 * 2 * 3 + 2 * 2 * 3) * sizeof(float);
  // The prefix-sum offset table: one entry per decision node and one past
  // the end.
  const std::size_t offsets = (4 + 1) * sizeof(std::size_t);
  // Plus the encode window alive beside the store while the blobs are
  // written: one buffer per decision node up to the window (all four here),
  // each sized for the largest blob a node can produce - the 8-byte header, a
  // kept-count per seat, 12 bytes per seat per hand (index, reach, EV), 8 per
  // hand per action (strategy, action EV), and the 169-class rollup block,
  // which is charged whether or not this game writes one.
  const std::size_t max_blob = 8 + 2 * 4 + 2 * 3 * 12 + 3 * 2 * 8 + 169 * (8 + 2 * 2);
  const std::size_t window = 4 * (max_blob + kVec + kHeapBlockOverhead);
  CHECK(estimate.export_bytes == 4 * per_node + offsets + window);
  CHECK(estimate.export_bytes == export_pass_bytes(game));

  CHECK(estimate.total() == estimate.regret_strategy_bytes + estimate.tree_bytes +
                                estimate.showdown_bytes + estimate.recalc_bytes +
                                estimate.workspace_bytes + estimate.export_bytes);
}

TEST_CASE("chance nodes add recalc cache slots") {
  toy::LeducGame game;
  const MemoryEstimate on = estimate_memory(game, 1, true);
  const MemoryEstimate off = estimate_memory(game, 1, false);
  // With the schedule off only the per-node base index array is allocated.
  CHECK(off.recalc_bytes == game.tree().size() * sizeof(std::uint32_t));
  // Leduc deals a board card, so turning the schedule on has to cost more.
  CHECK(on.recalc_bytes > off.recalc_bytes);
  CHECK(on.recalc_bytes == CfrSolver::recalc_state_bytes(game, true));
}

TEST_CASE("the export term covers what the export pass actually holds") {
  // Independent lower bound, deliberately simpler than the estimator's own
  // formula so this is a real check and not a restatement of it: whatever
  // else the export pass costs, it holds at least these floats live - two
  // hand-wide vectors per seat and two per action, at EVERY decision node at
  // once. An estimator that stops bounding them has drifted.
  const NlhePostflopGame game(turn_config());
  const PublicTree& tree = game.tree();
  const std::size_t hands = static_cast<std::size_t>(game.num_hands(0));
  std::size_t payload = 0;
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Decision) continue;
    payload += (2 * 2 + 2 * n.num_children) * hands * sizeof(float);
  }
  CHECK(payload > 0);
  CHECK(estimate_memory(game).export_bytes >= payload);
}

TEST_CASE("peak memory is reported") {
  const PeakMemory peak = peak_memory();
  CHECK(peak.working_set > 0);
  CHECK(peak_rss_bytes() == peak.working_set);
#if defined(_WIN32)
  // Peak private commit is a Windows-only counter; POSIX has no equivalent
  // and reports 0 rather than faking one from the resident figure.
  CHECK(peak.commit > 0);
#endif
}
