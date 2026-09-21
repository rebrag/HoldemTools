#include "solver/plan.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <string>

#include "game/deal_game.hpp"
#include "solver/memory.hpp"
#include "solver/updates.hpp"
#include "util/parallel.hpp"

namespace engine {

namespace {

// Measured 2026-09-20 at ee48fc3 on the 3-way Ts6h9h flop spot (7,282,835
// nodes, 1176-hand universe, histogram 0/200/200; 4,311 nodes per runout,
// 753 log entries per deal (ceiling) under external sampling and 11,340
// under chance sampling), 16 threads, ENGINE_SIMD AVX2, 9800X3D: 384k
// deals/s pinned+external, 83.6k pinned+chance, 144 deals/s vectorized
// hero. Expressed per unit of work so a different tree scales, each
// constant = threads / (measured rate x work per deal):
//   pinned    seconds per log-entry CEILING per thread (the ceiling is the
//             tree walk in memory.cpp, not the average, so the constant is
//             calibrated to it and reads far below a real entry's cost);
//   vectorized  seconds per (node per runout x hand x seat) per thread;
//   exact     seconds per (decision node x hand x seat) per iteration per
//             thread, the vectorized core's full-tree pass (calibrated on
//             the Ts6h9h9c 3-way turn, 25,164 decision nodes x 1128 hands).
// Factor-of-two estimates. Re-measure and move these when the numbers in
// the solve metadata drift.
constexpr double kPinnedExternalSecondsPerEntry = 16.0 / (384000.0 * 753.0);
constexpr double kPinnedChanceSecondsPerEntry = 16.0 / (83600.0 * 11340.0);
constexpr double kVectorizedSecondsPerNodeHand = 16.0 / (144.0 * 4311.0 * 1176.0 * 3.0);
constexpr double kExactSecondsPerNodeHandSeat = 16.0 / (0.124 * 25164.0 * 1128.0 * 3.0);  // 250 iters in 2013 s on the turn

// Nodes one deal walks with every action enumerated (one child at chance
// nodes), the vectorized hero's per-deal work unit.
std::uint64_t runout_nodes(const PublicTree& tree, NodeId id) {
  const Node& node = tree[id];
  std::uint64_t count = 1;
  if (node.kind == NodeKind::Terminal) return count;
  if (node.kind == NodeKind::Chance) return count + runout_nodes(tree, node.first_child);
  for (int c = 0; c < node.num_children; ++c) {
    count += runout_nodes(tree, node.first_child + static_cast<NodeId>(c));
  }
  return count;
}

std::uint64_t showdown_runouts(const PublicTree& tree, NodeId id) {
  const Node& node = tree[id];
  if (node.kind == NodeKind::Terminal) return 1;
  if (node.kind == NodeKind::Chance) {
    std::uint64_t total = 0;
    for (int c = 0; c < node.num_children; ++c) {
      total += showdown_runouts(tree, node.first_child + static_cast<NodeId>(c));
    }
    return total;
  }
  return showdown_runouts(tree, node.first_child);
}

std::size_t entries_per_deal(const Game& game, HeroMode hero, UpdateScheme update) {
  SampledConfig sc;
  sc.enabled = true;
  sc.hero = hero;
  sc.update = update;
  sc.batch = 1;
  sc.lanes = 1;
  return pinned_log_entries_per_lane(game, sc);
}

SampledConfig sampled_for(const SolveConfig& config, HeroMode hero, UpdateScheme update,
                          bool monker) {
  SampledConfig sc = config.sampled;
  sc.enabled = true;
  sc.hero = hero;
  sc.update = update;
  if (monker) {
    sc.abstraction.enabled = true;
    sc.abstraction.preset = "monker";
    sc.abstraction.method = "moments";
    sc.abstraction.flop = 30;
    sc.abstraction.turn = 30;
    sc.abstraction.river = 30;
    sc.abstraction.tiers = 4;
  }
  return sc;
}

nlohmann::json abstraction_json(const SampledConfig& sc) {
  if (!sc.abstraction.enabled) return nullptr;
  const AbstractionConfig& ab = sc.abstraction;
  nlohmann::json j = {{"method", ab.method},
                      {"flop", ab.flop},
                      {"turn", ab.turn},
                      {"river", ab.river},
                      {"tiers", ab.tiers},
                      {"board_isomorphism", ab.board_isomorphism}};
  if (!ab.preset.empty()) j["preset"] = ab.preset;
  return j;
}

}  // namespace

nlohmann::json make_plan(const SolveConfig& config, const Game& game, const PlanRequest& request,
                         double setup_seconds) {
  const PublicTree& tree = game.tree();
  const int threads = resolve_thread_count(request.threads != 0 ? request.threads : config.threads);
  const int seats = game.num_seats();
  const bool postflop = config.game == "nlhe";
  const double memory_limit_gb =
      request.memory_limit_gb > 0.0 ? request.memory_limit_gb : config.memory_limit_gb;
  const std::size_t memory_limit = static_cast<std::size_t>(memory_limit_gb * 1024.0 * 1024.0 * 1024.0);
  std::size_t max_hands = 0;
  for (int s = 0; s < seats; ++s) {
    max_hands = std::max(max_hands, static_cast<std::size_t>(game.num_hands(s)));
  }
  const std::uint64_t per_runout = runout_nodes(tree, tree.root());
  const double td = static_cast<double>(threads);

  nlohmann::json out;
  out["game"] = config.game;
  out["seats"] = seats;
  out["nodes"] = tree.size();
  out["decision_nodes"] = tree.num_decision_nodes;
  out["terminal_nodes"] = tree.num_terminal_nodes;
  out["universe_hands"] = max_hands;
  out["nodes_per_runout"] = per_runout;
  out["runouts"] = showdown_runouts(tree, tree.root());
  out["threads"] = threads;
  out["setup_seconds"] = setup_seconds;
  out["memory_limit_gb"] = memory_limit_gb;
  out["time_budget_seconds"] = request.time_budget_s;
  out["target_exploitable_pct"] = request.target_pct;
  out["rate_model"] = "measured 2026-09-20 at ee48fc3 (16 threads, AVX2, 9800X3D); factor-of-two estimates";

  nlohmann::json cores = nlohmann::json::object();

  // The exact core: full-tree passes, an exact best response, no
  // abstraction. Only up to three seats postflop.
  {
    const bool supported = game.vectorized_terminals() && !config.sampled.enabled;
    nlohmann::json c;
    c["supported"] = game.vectorized_terminals();
    const MemoryEstimate est = estimate_memory(game, threads, config.recalc.enabled,
                                               config.update.precision, nullptr, false);
    c["memory_bytes"] = est.total();
    c["fits_memory"] = est.total() <= memory_limit;
    const double per_iter = static_cast<double>(tree.num_decision_nodes) *
                            static_cast<double>(max_hands) * static_cast<double>(seats) *
                            kExactSecondsPerNodeHandSeat / td;
    c["predicted_iterations_per_second"] = per_iter > 0.0 ? 1.0 / per_iter : 0.0;
    c["exact_best_response"] = game.vectorized_terminals();
    c["hand_abstraction"] = false;
    (void)supported;
    cores["vectorized"] = c;
  }
  // The sampled core's three walks, each with and without the monker preset
  // where buckets apply (postflop only).
  const auto sampled_entry = [&](const char* name, HeroMode hero, UpdateScheme update, bool monker) {
    if (monker && !postflop) return;
    SampledConfig sc = sampled_for(config, hero, update, monker);
    if (!monker) sc.abstraction = config.sampled.abstraction;
    if (!monker && !postflop) sc.abstraction.enabled = false;
    nlohmann::json c;
    c["hero"] = hero == HeroMode::Pinned ? "pinned" : "vectorized";
    c["update"] = update == UpdateScheme::External ? "external" : "chance";
    c["abstraction"] = abstraction_json(sc);
    bool ok = true;
    std::string why;
    try {
      const MemoryEstimate est = estimate_memory(game, threads, false, Precision::F32, &sc,
                                                 sc.abstraction.enabled);
      c["memory_bytes"] = est.total();
      c["fits_memory"] = est.total() <= memory_limit;
    } catch (const std::exception& e) {
      ok = false;
      why = e.what();
    }
    double rate = 0.0;
    if (hero == HeroMode::Pinned) {
      const std::size_t entries = entries_per_deal(game, hero, update);
      c["log_entries_per_deal"] = entries;
      const double per_entry = update == UpdateScheme::External
                                   ? kPinnedExternalSecondsPerEntry
                                   : kPinnedChanceSecondsPerEntry;
      rate = entries > 0 ? td / (static_cast<double>(entries) * per_entry) : 0.0;
    } else {
      const double work = static_cast<double>(per_runout) * static_cast<double>(max_hands) *
                          static_cast<double>(seats);
      rate = work > 0.0 ? td / (work * kVectorizedSecondsPerNodeHand) : 0.0;
    }
    c["predicted_deals_per_second"] = rate;
    c["supported"] = ok;
    if (!ok) c["reason"] = why;
    c["exact_best_response"] = game.vectorized_terminals();
    cores[name] = c;
  };
  sampled_entry("sampled_vectorized", HeroMode::Vectorized, UpdateScheme::Chance, false);
  sampled_entry("sampled_pinned_chance", HeroMode::Pinned, UpdateScheme::Chance, postflop);
  sampled_entry("sampled_pinned_external", HeroMode::Pinned, UpdateScheme::External, postflop);
  out["cores"] = cores;

  // The recommendation. Two seats: the exact core. Three seats: the exact
  // core when it fits and a budget is either absent or long enough for its
  // predicted pass rate to matter; otherwise the pinned hero with external
  // sampling and the monker preset. Four seats and up: pinned + external,
  // the only core there is.
  nlohmann::json rec;
  const bool team = !config.partition.empty() && config.partition.size() < static_cast<std::size_t>(seats);
  const bool exact_fits = cores["vectorized"]["fits_memory"].get<bool>();
  const double exact_rate = cores["vectorized"]["predicted_iterations_per_second"].get<double>();
  // Rule of thumb from the flop benchmarks: a few hundred exact iterations
  // reach 0.3% of pot on an SPR 4-10 flop tree (M7.1's gamma table).
  constexpr double kExactIterationsToTarget = 300.0;
  const bool exact_in_budget =
      request.time_budget_s <= 0.0 || exact_rate * request.time_budget_s >= kExactIterationsToTarget;
  bool use_exact = game.vectorized_terminals() && exact_fits && !team && !config.sampled.enabled &&
                   (seats <= 2 || exact_in_budget);
  if (!postflop && seats <= 3 && !team) use_exact = true;  // the preflop factorized estimator is exact there
  if (use_exact) {
    rec["family"] = "vectorized";
    rec["reason"] = seats <= 2 ? "heads-up: the exact, Pio-gated core"
                               : "three seats with an exact showdown, and the budget covers it";
    rec["predicted_iterations_per_second"] = exact_rate;
    rec["iterations"] = request.time_budget_s > 0.0
                            ? std::max<std::uint64_t>(100, static_cast<std::uint64_t>(exact_rate * request.time_budget_s))
                            : config.iterations;
    rec["checkpoint_every"] = 25;
  } else {
    // Postflop: the pinned hero with external sampling and the monker
    // preset. Preflop (push/fold, 29 nodes): the vectorized hero, which
    // trains every class row on every deal and is the path the Monker
    // 4-way band was measured on (M8c); a pinned deal there would train one
    // of 169 rows.
    const char* pick = postflop ? "sampled_pinned_external" : "sampled_vectorized";
    const nlohmann::json& c = cores[pick];
    const double rate = c["predicted_deals_per_second"].get<double>();
    rec["family"] = "sampled";
    rec["hero"] = c["hero"];
    rec["update"] = c["update"];
    rec["abstraction"] = c["abstraction"];
    rec["lanes"] = threads;
    // About a hundred regret-matching steps a second: batches below a few
    // hundred deals pay the pool dispatch, above a few tens of thousands
    // they starve the strategy of refreshes.
    std::uint64_t batch = static_cast<std::uint64_t>(rate * 0.01);
    batch = std::max<std::uint64_t>(256, std::min<std::uint64_t>(65536, batch));
    batch = std::max<std::uint64_t>(1, batch / static_cast<std::uint64_t>(threads)) *
            static_cast<std::uint64_t>(threads);
    rec["batch"] = batch;
    rec["predicted_deals_per_second"] = rate;
    rec["iterations"] = request.time_budget_s > 0.0
                            ? std::max<std::uint64_t>(batch, static_cast<std::uint64_t>(rate * request.time_budget_s))
                            : config.iterations;
    rec["checkpoint_every"] = rec["iterations"];
    if (game.vectorized_terminals() && request.time_budget_s > 0.0) {
      // An exact best response at the end and at a few marks, where one
      // exists. Its cost on a big tree is minutes, so no more than three.
      nlohmann::json marks = nlohmann::json::array();
      for (double frac : {0.1, 0.5}) {
        const double m = request.time_budget_s * frac;
        if (m >= 30.0) marks.push_back(m);
      }
      rec["measure_at_seconds"] = marks;
    }
    rec["reason"] = seats > 3 ? "past three seats only the sampled core has a showdown"
                    : team    ? "a hand-sharing team runs on the sampled core"
                              : "three seats: the exact core would not reach the target inside the budget";
  }
  rec["memory_limit_gb"] = memory_limit_gb;
  if (request.time_budget_s > 0.0) rec["max_seconds"] = request.time_budget_s;
  out["recommendation"] = rec;
  return out;
}

}  // namespace engine
