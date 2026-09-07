// Does depth-limited solving buy what the perf plan claims, and what does it
// cost in exploitability?
//
// The experiment, on one postflop config:
//
//   1. Solve the FULL tree                            -> the blueprint.
//   2. Read continuation values off it at the depth   -> the leaf table.
//      limit, as conditional per-hand values.
//   3. Solve the TRUNCATED tree with that table       -> the depth-limited
//                                                        strategy.
//   4. Complete that strategy with the blueprint below the limit and measure
//      its exploitability in the FULL game.
//
// Step 4 is the point. A depth-limited solve produces a strategy only above
// the limit, so it is not a complete strategy and cannot be evaluated on its
// own. The number it reports is what truncation actually costs.
//
// This is the SINGLE-CONTINUATION version, which is the unsound one: the leaf
// value freezes the opponent's range shape at the limit, so the solver is
// implicitly assuming the opponent plays the blueprint continuation. Its
// exploitability is therefore the BASELINE a continuation portfolio has to
// beat, not a shippable result. See docs/perf-plan.md, "The fork".
//
// Usage:
//   dl_probe <config.json> [--blueprint-iters N] [--dl-iters N]
//            [--limit flop|turn] [--threads N]

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "solver/depth_limit.hpp"
#include "solver/memory.hpp"
#include "solver/strategy_source.hpp"

using namespace engine;

namespace {

double seconds_since(const std::chrono::steady_clock::time_point& t0) {
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
}

std::size_t count_kind(const PublicTree& tree, NodeKind kind) {
  std::size_t n = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind == kind) ++n;
  }
  return n;
}

std::string pct_of_pot(double chips, double pot) {
  std::ostringstream os;
  os << std::fixed << std::setprecision(4) << (100.0 * chips / pot) << "%";
  return os.str();
}

const char* action_name(const Node& child) {
  switch (child.action_kind) {
    case ActionKind::Fold: return "fold";
    case ActionKind::CheckCall: return "check/call";
    case ActionKind::Bet: return "bet/raise";
    default: return "?";
  }
}

// Range-weighted action frequencies at one decision node. Not reach-weighted:
// the two strategies being compared induce different reaches, and the point
// here is to see the strategies themselves.
std::vector<double> action_mix(const Game& game, const StrategySource& src, NodeId node,
                               int actor) {
  std::vector<float> sigma;
  src.average_strategy(node, sigma);
  const std::vector<float>& range = game.initial_range(actor);
  const std::size_t hands = range.size();
  const std::size_t actions = game.tree()[node].num_children;
  std::vector<double> mix(actions, 0.0);
  double total = 0.0;
  for (std::size_t h = 0; h < hands; ++h) {
    total += range[h];
    for (std::size_t k = 0; k < actions; ++k) mix[k] += range[h] * sigma[h * actions + k];
  }
  if (total > 0.0) {
    for (double& m : mix) m = 100.0 * m / total;
  }
  return mix;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: dl_probe <config.json> [--blueprint-iters N] [--dl-iters N] "
                 "[--limit flop|turn] [--threads N]\n";
    return 2;
  }
  try {
    const std::string config_path = argv[1];
    std::uint64_t blueprint_iters = 2000;
    std::uint64_t dl_iters = 2000;
    Street limit = Street::Flop;
    int threads_override = 0;
    bool threads_set = false;
    bool exact_leaf = false;

    for (int i = 2; i < argc; ++i) {
      const std::string arg = argv[i];
      const auto next = [&]() -> std::string {
        if (i + 1 >= argc) throw std::runtime_error("missing value for " + arg);
        return argv[++i];
      };
      if (arg == "--blueprint-iters") blueprint_iters = std::stoull(next());
      else if (arg == "--dl-iters") dl_iters = std::stoull(next());
      else if (arg == "--threads") { threads_override = std::stoi(next()); threads_set = true; }
      else if (arg == "--leaf") {
        const std::string v = next();
        if (v == "exact") exact_leaf = true;
        else if (v == "scalar") exact_leaf = false;
        else throw std::runtime_error("--leaf must be exact or scalar");
      }
      else if (arg == "--limit") {
        const std::string v = next();
        if (v == "flop") limit = Street::Flop;
        else if (v == "turn") limit = Street::Turn;
        else throw std::runtime_error("--limit must be flop or turn");
      } else {
        throw std::runtime_error("unknown argument: " + arg);
      }
    }

    SolveConfig full_config = load_config(config_path);
    if (full_config.game != "nlhe") {
      throw std::runtime_error("dl_probe needs a postflop \"nlhe\" config");
    }
    if (threads_set) full_config.threads = threads_override;
    full_config.depth_limit = Street::None;

    SolveConfig dl_config = full_config;
    dl_config.depth_limit = limit;

    const double pot = static_cast<double>(full_config.pot);

    // ---- 1. the blueprint -------------------------------------------------
    auto t0 = std::chrono::steady_clock::now();
    NlhePostflopGame full_game(full_config);
    const double full_setup_s = seconds_since(t0);
    const PublicTree& full_tree = full_game.tree();

    std::cout << "full tree      " << full_tree.size() << " nodes ("
              << count_kind(full_tree, NodeKind::Decision) << " decision, "
              << count_kind(full_tree, NodeKind::Chance) << " chance), setup "
              << std::fixed << std::setprecision(2) << full_setup_s << " s\n";

    CfrSolver blueprint(full_game, full_config.update, full_config.threads, full_config.recalc,
                        full_config.sampling, full_config.qre);
    t0 = std::chrono::steady_clock::now();
    blueprint.run(blueprint_iters);
    const double blueprint_solve_s = seconds_since(t0);
    const CfrStrategySource blueprint_src(blueprint);
    const BrResult blueprint_br = compute_best_response(full_game, blueprint_src);

    std::cout << "blueprint      " << blueprint_iters << " iters in " << blueprint_solve_s
              << " s, exploitable " << pct_of_pot(blueprint_br.nashconv(), pot) << " of pot\n";

    // ---- 2. the truncated tree and its leaf table -------------------------
    t0 = std::chrono::steady_clock::now();
    NlhePostflopGame dl_game(dl_config);
    const double dl_setup_s = seconds_since(t0);
    const PublicTree& dl_tree = dl_game.tree();

    const TruncationMap map = map_truncated_tree(dl_tree, full_tree);

    t0 = std::chrono::steady_clock::now();
    if (exact_leaf) {
      dl_game.set_leaf_matrices(blueprint_leaf_matrices(full_game, blueprint_src, map,
                                                        dl_tree.num_terminal_nodes, dl_tree));
    } else {
      dl_game.set_leaf_values(blueprint_leaf_values(full_game, blueprint_src, map,
                                                    dl_tree.num_terminal_nodes, dl_tree));
    }
    const double table_s = seconds_since(t0);
    std::cout << "leaf model     " << (exact_leaf ? "exact per-hand-pair matrix"
                                                  : "frozen per-hand scalar")
              << "\n";

    std::cout << "truncated tree " << dl_tree.size() << " nodes ("
              << count_kind(dl_tree, NodeKind::Decision) << " decision, "
              << map.boundary_full.size() << " depth-limit leaves), setup " << dl_setup_s
              << " s\n"
              << "leaf table     " << table_s << " s to extract\n";

    // ---- 2b. gate: does the truncated game reproduce the blueprint? -------
    // Play the blueprint's own flop strategy on the truncated tree. The leaf
    // table was built against exactly these reach vectors, so the root EVs
    // must match the full solve's. Everything reported below is meaningless
    // if they do not.
    {
      const BlueprintOnTruncatedSource replay(blueprint_src, map);
      const BrResult replay_br = compute_best_response(dl_game, replay);
      double worst = 0.0;
      for (std::size_t s = 0; s < replay_br.ev.size(); ++s) {
        const double d = std::abs(replay_br.ev[s] - blueprint_br.ev[s]);
        if (d > worst) worst = d;
      }
      std::cout << "replay gate    root EV agrees to " << std::scientific << std::setprecision(2)
                << worst << " chips (" << pct_of_pot(worst, pot) << " of pot)\n"
                << std::defaultfloat << std::fixed << std::setprecision(2);
      if (worst > 1e-3 * pot) {
        std::cerr << "\ndl_probe: the truncated game does not reproduce the blueprint's root "
                     "EVs. The leaf table or the node mapping is wrong; the exploitability "
                     "numbers below would be measuring a bug.\n";
        return 1;
      }
    }

    // ---- 3. the depth-limited solve ---------------------------------------
    CfrSolver limited(dl_game, dl_config.update, dl_config.threads, dl_config.recalc,
                      dl_config.sampling, dl_config.qre);
    t0 = std::chrono::steady_clock::now();
    limited.run(dl_iters);
    const double dl_solve_s = seconds_since(t0);
    const CfrStrategySource limited_src(limited);

    // ---- 4. what it is worth in the full game -----------------------------
    const HybridStrategySource hybrid(blueprint_src, limited_src, map, dl_tree);
    const BrResult hybrid_br = compute_best_response(full_game, hybrid);

    std::cout << "depth-limited  " << dl_iters << " iters in " << dl_solve_s
              << " s, exploitable " << pct_of_pot(hybrid_br.nashconv(), pot)
              << " of pot (measured in the FULL game)\n";

    // What the truncated solver thinks it earns, against what that same
    // strategy actually earns once the opponent is allowed to respond below
    // the limit. The gap is the frozen continuation's self-deception, and it
    // is the quantity a continuation portfolio exists to close.
    const BrResult believed = compute_best_response(dl_game, limited_src);
    double believed_sum = 0.0, actual_sum = 0.0;
    std::cout << "self-deception ";
    for (std::size_t s = 0; s < believed.ev.size(); ++s) {
      believed_sum += believed.ev[s];
      actual_sum += hybrid_br.ev[s];
      std::cout << (s == 0 ? "OOP " : "  IP ") << "believes " << believed.ev[s] << " chips, gets "
                << hybrid_br.ev[s];
    }
    // The utility convention makes root EVs sum to the root pot. The real
    // game therefore always conserves; the truncated one only conserves at
    // the blueprint's operating point, because each seat's leaf table is
    // scaled by the OTHER seat's live reach while its own shape stays frozen.
    // Off that point the two tables stop describing one game and CFR is no
    // longer minimizing regret in any zero-sum game at all. This residual is
    // the cleanest single measure of that, and a leaf model that is zero-sum
    // by construction would hold it at zero.
    std::cout << "\nconservation   truncated game pays out " << believed_sum << " chips into a "
              << pot << " chip pot (residual " << (believed_sum - pot) << "); the full game pays "
              << actual_sum << "\n\n";

    // What the truncated solver actually did differently. On a small tree this
    // is the whole diagnosis; on a wide one, read the first few nodes.
    {
      const BlueprintOnTruncatedSource replay(blueprint_src, map);
      std::cout << "flop strategy, blueprint -> depth-limited (range-weighted %)\n";
      std::size_t shown = 0;
      for (NodeId t = 0; t < dl_tree.size() && shown < 12; ++t) {
        const Node& node = dl_tree[t];
        if (node.kind != NodeKind::Decision) continue;
        ++shown;
        const int actor = static_cast<int>(node.actor);
        const std::vector<double> bp = action_mix(dl_game, replay, t, actor);
        const std::vector<double> dl = action_mix(dl_game, limited_src, t, actor);
        std::cout << "  node " << t << " seat " << (actor == 0 ? "OOP" : "IP ") << "  ";
        for (std::size_t k = 0; k < bp.size(); ++k) {
          std::cout << action_name(dl_tree[node.first_child + static_cast<NodeId>(k)]) << " "
                    << std::setprecision(1) << bp[k] << "->" << dl[k] << "   ";
        }
        std::cout << "\n";
      }
      std::cout << std::setprecision(2) << "\n";
    }

    const MemoryEstimate full_mem =
        estimate_memory(full_game, full_config.threads, full_config.recalc.enabled,
                        full_config.update.precision, &full_config.sampled);
    const MemoryEstimate dl_mem =
        estimate_memory(dl_game, dl_config.threads, dl_config.recalc.enabled,
                        dl_config.update.precision, &dl_config.sampled);

    const double node_ratio =
        static_cast<double>(full_tree.size()) / static_cast<double>(dl_tree.size());
    const double iter_ratio = (blueprint_solve_s / static_cast<double>(blueprint_iters)) /
                              (dl_solve_s / static_cast<double>(dl_iters));

    std::cout << std::setprecision(1) << "nodes      " << node_ratio << "x fewer\n"
              << "per-iter   " << iter_ratio << "x faster\n"
              << "solver mem " << std::setprecision(2)
              << (static_cast<double>(full_mem.total()) / (1024.0 * 1024.0)) << " MB -> "
              << (static_cast<double>(dl_mem.total()) / (1024.0 * 1024.0)) << " MB\n"
              << "cost       " << pct_of_pot(hybrid_br.nashconv(), pot) << " exploitable vs "
              << pct_of_pot(blueprint_br.nashconv(), pot) << " for the blueprint it was cut from\n";
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "dl_probe: " << e.what() << "\n";
    return 1;
  }
}
