// What does truncating the tree cost, and what does it actually buy?
//
// The experiment, on one postflop config:
//
//   1. Solve the FULL tree                            -> the blueprint.
//   2. Read continuation values off it at the depth   -> the leaf table.
//      limit.
//   3. Solve the TRUNCATED tree with that table       -> the depth-limited
//                                                        strategy.
//   4. Complete that strategy with the blueprint below the limit and measure
//      its exploitability in the FULL game.
//
// Step 4 is the point. A depth-limited solve produces a strategy only above
// the limit, so it is not a complete strategy and cannot be evaluated on its
// own. The number it reports is what truncation actually costs.
//
// TIME TO EQUAL ACCURACY is what this reports, not a per-iteration ratio.
// A depth-limited solve FLOORS at some exploitability it can never go below,
// so "1000x faster per iteration" is not a speedup - the honest question is
// how long the full solve needs to reach that same floor. Both solves are
// therefore run on a doubling schedule with exploitability measured at each
// stop, and solve time EXCLUDES the measurement passes (a best-response pass
// costs about 2.7 iterations on a flop tree - see docs/roadmap.md - so
// charging them to the solve would inflate everything here).
//
// Usage:
//   dl_probe <config.json> [--blueprint-iters N] [--dl-iters N]
//            [--limit flop|turn] [--leaf exact|scalar] [--threads N]

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
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

struct CurvePoint {
  std::uint64_t iters = 0;
  double solve_s = 0.0;      // inside run() only
  double exploitable = 0.0;  // chips
};

// Doubling schedule up to `total`, so a 1/T curve is sampled evenly in log
// time rather than piling every measurement into the converged tail.
std::vector<std::uint64_t> schedule(std::uint64_t total) {
  std::vector<std::uint64_t> out;
  for (std::uint64_t n = 1; n < total; n *= 2) out.push_back(n);
  out.push_back(total);
  return out;
}

template <typename Measure>
std::vector<CurvePoint> run_curve(CfrSolver& solver, std::uint64_t total, const Measure& measure) {
  std::vector<CurvePoint> curve;
  double solve_s = 0.0;
  std::uint64_t done = 0;
  for (std::uint64_t stop : schedule(total)) {
    const auto t0 = std::chrono::steady_clock::now();
    solver.run(stop - done);
    solve_s += seconds_since(t0);
    done = stop;
    curve.push_back({done, solve_s, measure()});
  }
  return curve;
}

void print_curve(const char* label, const std::vector<CurvePoint>& curve, double pot) {
  std::cout << label << "\n";
  for (const CurvePoint& p : curve) {
    std::cout << "  " << std::setw(8) << p.iters << " iters  " << std::setw(9) << std::fixed
              << std::setprecision(3) << p.solve_s << " s  " << pct_of_pot(p.exploitable, pot)
              << "\n";
  }
}

// First time the curve is at or below `target`, interpolated in log-time
// against log-exploitability between the two bracketing points. Negative if
// the curve never gets there.
double time_to_reach(const std::vector<CurvePoint>& curve, double target) {
  for (std::size_t i = 0; i < curve.size(); ++i) {
    if (curve[i].exploitable > target) continue;
    if (i == 0) return curve[0].solve_s;
    const CurvePoint& a = curve[i - 1];
    const CurvePoint& b = curve[i];
    if (a.exploitable <= b.exploitable || a.solve_s <= 0.0 || b.solve_s <= 0.0) return b.solve_s;
    const double f = std::log(a.exploitable / target) / std::log(a.exploitable / b.exploitable);
    return a.solve_s * std::pow(b.solve_s / a.solve_s, f);
  }
  return -1.0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: dl_probe <config.json> [--blueprint-iters N] [--dl-iters N] "
                 "[--limit flop|turn] [--leaf exact|scalar] [--threads N]\n";
    return 2;
  }
  try {
    const std::string config_path = argv[1];
    std::uint64_t blueprint_iters = 2000;
    std::uint64_t dl_iters = 2000;
    Street limit = Street::Flop;
    int threads_override = 0;
    bool threads_set = false;
    bool exact_leaf = true;

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
      } else if (arg == "--limit") {
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
              << count_kind(full_tree, NodeKind::Chance) << " chance), " << full_game.num_hands(0)
              << " hands, setup " << std::fixed << std::setprecision(2) << full_setup_s << " s\n";

    CfrSolver blueprint(full_game, full_config.update, full_config.threads, full_config.recalc,
                        full_config.sampling, full_config.qre);
    const CfrStrategySource blueprint_src(blueprint);
    const std::vector<CurvePoint> blueprint_curve =
        run_curve(blueprint, blueprint_iters, [&]() {
          return compute_best_response(full_game, blueprint_src).nashconv();
        });
    const BrResult blueprint_br = compute_best_response(full_game, blueprint_src);

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

    std::cout << "truncated tree " << dl_tree.size() << " nodes ("
              << count_kind(dl_tree, NodeKind::Decision) << " decision, "
              << map.boundary_full.size() << " depth-limit leaves), setup " << dl_setup_s << " s\n"
              << "leaf model     " << (exact_leaf ? "exact per-hand-pair matrix"
                                                  : "frozen per-hand scalar")
              << ", built in " << table_s << " s\n";

    // ---- 2b. gate: does the truncated game reproduce the blueprint? -------
    // Play the blueprint's own strategy on the truncated tree. The leaf table
    // was built against exactly these reach vectors, so the root EVs must
    // match the full solve's. Everything below is meaningless if they do not.
    {
      const BlueprintOnTruncatedSource replay(blueprint_src, map);
      const BrResult replay_br = compute_best_response(dl_game, replay);
      double worst = 0.0;
      for (std::size_t s = 0; s < replay_br.ev.size(); ++s) {
        worst = std::max(worst, std::abs(replay_br.ev[s] - blueprint_br.ev[s]));
      }
      std::cout << "replay gate    root EV agrees to " << std::scientific << std::setprecision(2)
                << worst << " chips\n"
                << std::defaultfloat << std::fixed << std::setprecision(2);
      if (worst > 1e-3 * pot) {
        std::cerr << "\ndl_probe: the truncated game does not reproduce the blueprint's root "
                     "EVs. The leaf table or the node mapping is wrong.\n";
        return 1;
      }
    }

    // ---- 3. the depth-limited solve ---------------------------------------
    CfrSolver limited(dl_game, dl_config.update, dl_config.threads, dl_config.recalc,
                      dl_config.sampling, dl_config.qre);
    const CfrStrategySource limited_src(limited);
    const HybridStrategySource hybrid(blueprint_src, limited_src, map, dl_tree);
    const std::vector<CurvePoint> dl_curve = run_curve(limited, dl_iters, [&]() {
      return compute_best_response(full_game, hybrid).nashconv();
    });

    std::cout << "\n";
    print_curve("full solve (exploitability in its own game)", blueprint_curve, pot);
    std::cout << "\n";
    print_curve("depth-limited solve (exploitability in the FULL game)", dl_curve, pot);

    // ---- 4. time to equal accuracy ----------------------------------------
    // A depth-limited solve converges to the equilibrium of the TRUNCATED
    // game, which is not the equilibrium of the real one, so its real-game
    // exploitability is NOT monotone in iterations: it descends, bottoms out,
    // then degrades as it converges more exactly to the wrong game. More
    // iterations eventually make it worse.
    //
    // The asymptote is therefore the accuracy both solves are timed against,
    // because it is what "solve to convergence" actually delivers. The
    // transient minimum is reported beside it and deliberately NOT used: you
    // cannot stop there on purpose without already knowing the answer, so
    // treating it as the operating point would be measuring a number the
    // product cannot reach.
    const double asymptote = dl_curve.back().exploitable;
    const CurvePoint* best = &dl_curve.front();
    for (const CurvePoint& p : dl_curve) {
      if (p.exploitable < best->exploitable) best = &p;
    }
    const double dl_target_s = time_to_reach(dl_curve, asymptote);
    const double full_target_s = time_to_reach(blueprint_curve, asymptote);

    std::cout << "\n== time to equal accuracy ==\n"
              << "depth-limited asymptote      " << pct_of_pot(asymptote, pot) << " of pot at "
              << dl_curve.back().iters << " iters\n"
              << "  transient best             " << pct_of_pot(best->exploitable, pot) << " at "
              << best->iters << " iters, then degrades (not a usable stopping point)\n"
              << "depth-limited reaches it in  " << std::setprecision(3)
              << (dl_target_s < 0 ? dl_curve.back().solve_s : dl_target_s) << " s\n";
    if (full_target_s < 0) {
      std::cout << "full solve reaches it in     never, inside " << blueprint_iters
                << " iterations (" << blueprint_curve.back().solve_s << " s, "
                << pct_of_pot(blueprint_curve.back().exploitable, pot) << ")\n";
    } else {
      const double dl_s = dl_target_s < 0 ? dl_curve.back().solve_s : dl_target_s;
      std::cout << "full solve reaches it in     " << full_target_s << " s\n"
                << "speedup at equal accuracy    " << std::setprecision(1)
                << (full_target_s / dl_s) << "x\n";
    }

    std::cout << std::setprecision(2) << "\noffline cost   blueprint "
              << blueprint_curve.back().solve_s << " s + leaf table " << table_s << " s = "
              << (blueprint_curve.back().solve_s + table_s) << " s, paid once per spot\n";

    const MemoryEstimate full_mem =
        estimate_memory(full_game, full_config.threads, full_config.recalc.enabled,
                        full_config.update.precision, &full_config.sampled);
    const MemoryEstimate dl_mem =
        estimate_memory(dl_game, dl_config.threads, dl_config.recalc.enabled,
                        dl_config.update.precision, &dl_config.sampled);
    const double leaf_mb = exact_leaf
        ? static_cast<double>(map.boundary_full.size()) *
              static_cast<double>(full_game.num_hands(0)) *
              static_cast<double>(full_game.num_hands(0)) * 4.0 / (1024.0 * 1024.0)
        : 0.0;
    std::cout << "solver mem     " << (static_cast<double>(full_mem.total()) / (1024.0 * 1024.0))
              << " MB -> " << (static_cast<double>(dl_mem.total()) / (1024.0 * 1024.0))
              << " MB, plus " << leaf_mb << " MB of leaf matrices\n"
              << "nodes          " << full_tree.size() << " -> " << dl_tree.size() << " ("
              << std::setprecision(1)
              << (static_cast<double>(full_tree.size()) / static_cast<double>(dl_tree.size()))
              << "x fewer)\n";

    // What the truncated solver did differently, if anything.
    {
      const BlueprintOnTruncatedSource replay(blueprint_src, map);
      std::cout << std::setprecision(1) << "\nstrategy above the limit, blueprint -> "
                << "depth-limited (range-weighted %)\n";
      std::size_t shown = 0;
      for (NodeId t = 0; t < dl_tree.size() && shown < 8; ++t) {
        const Node& node = dl_tree[t];
        if (node.kind != NodeKind::Decision) continue;
        ++shown;
        const int actor = static_cast<int>(node.actor);
        const std::vector<double> bp = action_mix(dl_game, replay, t, actor);
        const std::vector<double> dl = action_mix(dl_game, limited_src, t, actor);
        std::cout << "  node " << std::setw(3) << t << " seat " << (actor == 0 ? "OOP" : "IP ")
                  << "  ";
        for (std::size_t k = 0; k < bp.size(); ++k) {
          std::cout << action_name(dl_tree[node.first_child + static_cast<NodeId>(k)]) << " "
                    << bp[k] << "->" << dl[k] << "   ";
        }
        std::cout << "\n";
      }
    }
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "dl_probe: " << e.what() << "\n";
    return 1;
  }
}
