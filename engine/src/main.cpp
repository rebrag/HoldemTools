#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>

#include "cli/args.hpp"
#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "io/artifact_format.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_writer.hpp"
#include "io/dump_json.hpp"
#include "solver/agents.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "solver/memory.hpp"
#include "util/parallel.hpp"

namespace {

using namespace engine;

std::unique_ptr<Game> make_game(const SolveConfig& config) {
  if (config.game == "kuhn") return std::make_unique<toy::KuhnGame>();
  if (config.game == "leduc") return std::make_unique<toy::LeducGame>();
  return std::make_unique<NlhePostflopGame>(config);
}

int check_memory(const Game& game, const SolveConfig& config, bool print_always) {
  const MemoryEstimate estimate =
      estimate_memory(game, config.threads, config.recalc.enabled, config.update.precision);
  if (print_always) std::cout << estimate.to_string() << "\n";
  const double limit_bytes = config.memory_limit_gb * 1024.0 * 1024.0 * 1024.0;
  if (static_cast<double>(estimate.total()) > limit_bytes) {
    std::cerr << "FATAL: " << estimate.to_string() << " exceeds memory_limit_gb ("
              << config.memory_limit_gb << " GB). Shrink the tree (fewer sizes, "
              << "fewer raises) or raise the limit.\n";
    return 1;
  }
  return 0;
}

int run_solve(const SolveConfig& config, bool dry_run) {
  const int threads = resolve_thread_count(config.threads);
  const auto setup_start = std::chrono::steady_clock::now();
  const auto game = make_game(config);
  AgentMap::from_config(config, game->num_seats());  // validates identity/no-collusion
  const double setup_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - setup_start).count();

  if (dry_run) {
    const MemoryEstimate estimate =
        estimate_memory(*game, config.threads, config.recalc.enabled, config.update.precision);
    std::cout << estimate.to_string() << "\n";
    std::cout << "tree: " << game->tree().size() << " nodes ("
              << game->tree().num_decision_nodes << " decision, "
              << game->tree().num_terminal_nodes << " terminal)\n";
    std::cout << "threads: " << threads << " (setup took " << setup_s << " s)\n";
    return check_memory(*game, config, false);
  }
  if (int rc = check_memory(*game, config, true); rc != 0) return rc;

  std::cout << "setup " << setup_s << " s (tree + showdown tables) on " << threads
            << " thread" << (threads == 1 ? "" : "s") << "\n";
  CfrSolver solver(*game, config.update, config.threads, config.recalc, config.sampling,
                   config.qre);
  const auto start = std::chrono::steady_clock::now();
  double nashconv = 0.0;
  double qre_gap = 0.0;
  BrResult br;
  std::uint64_t done = 0;
  const double pot = static_cast<double>(config.pot);

  // A fixed-lambda QRE is not a Nash equilibrium, and its PLAIN exploitability
  // floors out at roughly 2 * D * log(A) / lambda chips (D = a player's own
  // remaining decision points, A = actions per node). Someone who sets a tight
  // accuracy target on a soft lambda is asking for something arithmetically
  // unreachable, so say so up front rather than after they have waited out the
  // iteration cap. The stop itself uses the QRE gap, which does converge.
  if (config.qre.enabled) {
    std::cout << "QRE mode: lambda";
    for (double l : config.qre.lambda) std::cout << " " << l;
    if (config.qre.anneal_full_at != 0 && config.qre.anneal_factor > 1.0) {
      std::cout << ", annealing x" << config.qre.anneal_factor << " by iteration "
                << config.qre.anneal_full_at;
    }
    std::cout << "\n";
    if (config.target_exploitable_pct > 0.0 && pot > 0.0 && !config.qre.lambda.empty()) {
      // DECISION nodes only. A chance node's 48 runouts are not actions
      // anybody chooses between, and counting them inflates the bound wildly.
      int max_actions = 0;
      for (const Node& n : game->tree().nodes) {
        if (n.kind != NodeKind::Decision) continue;
        max_actions = std::max(max_actions, static_cast<int>(n.num_children));
      }
      // The lambda actually in force when the accuracy stop is allowed to
      // fire. Under annealing that is the FINAL lambda, not the starting one -
      // warning off the starting value would claim a floor 'factor' times too
      // high for a run that is explicitly climbing away from it.
      const bool annealing =
          config.qre.anneal_full_at != 0 && config.qre.anneal_factor > 1.0;
      const double effective =
          *std::min_element(config.qre.lambda.begin(), config.qre.lambda.end()) *
          (annealing ? config.qre.anneal_factor : 1.0);
      // 2 * D * log(A) / lambda, with D = a player's own remaining decision
      // points. A LOOSE UPPER BOUND on the floor, not the floor itself - the
      // realized plateau is typically well under it. It is here to answer one
      // question only: can this lambda reach this target at all?
      const double d = 3.0;
      const double bound =
          2.0 * d * std::log(static_cast<double>(std::max(2, max_actions))) / effective;
      const double target_chips = config.target_exploitable_pct / 100.0 * pot;
      if (bound > target_chips && !annealing) {
        std::cout << "  note: at this lambda the strategy is deliberately not Nash, so "
                     "plain exploitability will PLATEAU rather than reach the "
                  << config.target_exploitable_pct << "%-of-pot target ("
                  << target_chips << " chips). The solve stops on the QRE gap instead, "
                     "which does converge. Raise lambda if you wanted a near-Nash "
                     "strategy - the plateau is bounded above by roughly "
                  << bound << " chips.\n";
      } else if (bound > target_chips) {
        // Annealing targets plain Nash exploitability, so an unreachable
        // target here is a genuine dead end rather than a change of metric.
        std::cout << "  note: even the annealed lambda (" << effective
                  << ") may not reach the " << config.target_exploitable_pct
                  << "%-of-pot target (" << target_chips
                  << " chips): the floor is bounded above by roughly " << bound
                  << " chips. Raise qre.anneal.factor if the run stalls.\n";
      }
    }
  }
  while (done < config.iterations) {
    const std::uint64_t step =
        std::min<std::uint64_t>(config.checkpoint_every, config.iterations - done);
    solver.run(step);
    done += step;
    br = compute_best_response(*game, solver);
    nashconv = br.nashconv();
    // Under QRE this is the number the solve is actually minimizing; the plain
    // one above is kept as the diagnostic that shows the lambda-dependent
    // plateau. Best-response checkpoints were measured at 0.06% of solve time,
    // so running both costs nothing worth optimizing.
    const bool qre_on = config.qre.enabled;
    if (qre_on) qre_gap = compute_qre_best_response(*game, solver).nashconv();
    const double driving = qre_on ? qre_gap : nashconv;
    // "exploitable" follows Pio's convention: the per-player average gain
    // from best-responding = NashConv / num_seats for 2 players.
    const double exploitable = nashconv / game->num_seats();
    const double qre_exploitable = driving / game->num_seats();
    // Feed the recalc schedule its annealing budget: subtrees may be frozen
    // only while their movement is small against CURRENT exploitability. Under
    // QRE that has to be the REGULARIZED number - the plain one plateaus, and
    // the schedule's feedback controller reads a plateau as "frozen subtrees
    // are stalling the solve" and quarters its aggressiveness on nothing.
    solver.set_recalc_budget(qre_exploitable);
    std::cout << "iter " << done << "  nashconv " << nashconv
              << "  exploitable " << exploitable;
    if (pot > 0.0) std::cout << " (" << 100.0 * exploitable / pot << "% of pot)";
    if (qre_on) {
      std::cout << "  qre_gap " << qre_gap << " (" << qre_exploitable;
      if (pot > 0.0) std::cout << ", " << 100.0 * qre_exploitable / pot << "% of pot";
      std::cout << " per player)";
    }
    std::cout << "  ev";
    for (double ev : br.ev) std::cout << " " << ev;
    std::cout << "\n";
    // The accuracy stop must not fire while the solver is still subsampling
    // runouts. Exploitability itself is honest (best response always
    // enumerates), but the average strategy it is rating is still noisy, so a
    // lucky checkpoint could stop the solve at a strategy that is not there.
    //
    // Lambda annealing gets the same guard for the same reason: while lambda
    // is still moving the strategy is on its way to a different game, so a
    // Nash target must not be allowed to fire early on the way past.
    const bool may_stop = solver.sampling_exact() && solver.qre_annealed();
    // Which number the target refers to. Plain Nash for a nash solve; the QRE
    // gap for a fixed-lambda QRE solve, whose plain exploitability cannot
    // reach a tight target at all; and back to plain Nash once lambda has
    // annealed, because that is the point of annealing.
    const bool annealing = qre_on && config.qre.anneal_full_at != 0 &&
                           config.qre.anneal_factor > 1.0;
    const double target_metric = (qre_on && !annealing) ? qre_exploitable : exploitable;
    const double target_conv = (qre_on && !annealing) ? qre_gap : nashconv;
    const char* metric_name = (qre_on && !annealing) ? "qre gap" : "exploitability";
    if (may_stop && config.target_nashconv > 0.0 && target_conv <= config.target_nashconv) {
      std::cout << "target_nashconv reached (" << metric_name << ")\n";
      break;
    }
    if (may_stop && config.target_exploitable_pct > 0.0 && pot > 0.0 &&
        target_metric <= config.target_exploitable_pct / 100.0 * pot) {
      std::cout << "target_exploitable_pct reached (" << metric_name << ")\n";
      break;
    }
  }
  const double wall_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();

  SolveStats stats;
  stats.iterations = solver.iteration();
  stats.nashconv = nashconv;
  stats.ev_seat0 = br.ev.size() > 0 ? br.ev[0] : 0.0;
  stats.ev_seat1 = br.ev.size() > 1 ? br.ev[1] : 0.0;
  stats.wall_time_s = wall_s;
  stats.setup_time_s = setup_s;
  stats.threads = threads;
  stats.recalc_skips = solver.recalc_skips();
  // Solve-phase peak only. The artifact export pass that write_artifact runs
  // next allocates one record per decision node and is the real high-water
  // mark; write_artifact samples that itself, after the pass. Both numbers go
  // into the metadata.
  stats.peak_rss_bytes = peak_rss_bytes();
  stats.qre_gap = qre_gap;

  LocalStore store;
  write_artifact(store, config.output_path, *game, solver, config, stats);
  const PeakMemory peak = peak_memory();
  std::cout << "solve time " << wall_s << " s (" << done << " iters on " << threads
            << " thread" << (threads == 1 ? "" : "s") << ", "
            << (wall_s > 0.0 ? static_cast<double>(done) / wall_s : 0.0) << " iters/s)\n";
  std::cout << "wrote " << config.output_path << "  (wall " << wall_s + setup_s
            << " s including setup, peak RSS "
            << peak.working_set / (1024.0 * 1024.0) << " MB";
  // Commit is what the process asked for; the working set is what the OS kept
  // resident, and it is trimmed under memory pressure. They usually agree
  // closely, and when they do not the commit figure is the honest one.
  if (peak.commit > 0) std::cout << ", commit " << peak.commit / (1024.0 * 1024.0) << " MB";
  std::cout << "; solve phase " << stats.peak_rss_bytes / (1024.0 * 1024.0) << " MB)\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const CliArgs args = parse_args(argc, argv);
  if (!args.valid) {
    std::cerr << args.error << "\n" << usage();
    return 2;
  }
  try {
    if (args.subcommand == "version") {
      std::cout << "htsolver 0.1.0 (artifact format v" << artifact::kFormatVersion << ")\n";
      return 0;
    }
    if (args.subcommand == "dump-json") {
      LocalStore store;
      if (args.meta_only) {
        ArtifactReader reader(store, args.input_path);
        std::cout << reader.metadata().dump(2) << "\n";
        return 0;
      }
      const nlohmann::json dump = dump_artifact_json(store, args.input_path, args.node,
                                                     args.runouts, args.fields);
      const std::string text = args.compact ? dump.dump() : dump.dump(2);
      if (args.out_path) {
        std::ofstream out(*args.out_path, std::ios::binary);
        if (!out) throw std::runtime_error("cannot open --out path: " + *args.out_path);
        out << text << "\n";
        out.close();
        if (!out) throw std::runtime_error("failed writing --out path: " + *args.out_path);
        std::cerr << "wrote " << *args.out_path << " (" << text.size() << " bytes)\n";
      } else {
        std::cout << text << "\n";
      }
      return 0;
    }
    const SolveConfig config = load_config(args.input_path);
    return run_solve(config, args.subcommand == "dry-run");
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
