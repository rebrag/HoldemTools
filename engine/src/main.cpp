#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <memory>

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

namespace {

using namespace engine;

std::unique_ptr<Game> make_game(const SolveConfig& config) {
  if (config.game == "kuhn") return std::make_unique<toy::KuhnGame>();
  if (config.game == "leduc") return std::make_unique<toy::LeducGame>();
  return std::make_unique<NlhePostflopGame>(config);
}

int check_memory(const Game& game, const SolveConfig& config, bool print_always) {
  const MemoryEstimate estimate = estimate_memory(game);
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
  const auto game = make_game(config);
  AgentMap::from_config(config, game->num_seats());  // validates identity/no-collusion

  if (dry_run) {
    const MemoryEstimate estimate = estimate_memory(*game);
    std::cout << estimate.to_string() << "\n";
    std::cout << "tree: " << game->tree().size() << " nodes ("
              << game->tree().num_decision_nodes << " decision, "
              << game->tree().num_terminal_nodes << " terminal)\n";
    return check_memory(*game, config, false);
  }
  if (int rc = check_memory(*game, config, true); rc != 0) return rc;

  CfrSolver solver(*game, config.update);
  const auto start = std::chrono::steady_clock::now();
  double nashconv = 0.0;
  BrResult br;
  std::uint64_t done = 0;
  const double pot = static_cast<double>(config.pot);
  while (done < config.iterations) {
    const std::uint64_t step =
        std::min<std::uint64_t>(config.checkpoint_every, config.iterations - done);
    solver.run(step);
    done += step;
    br = compute_best_response(*game, solver);
    nashconv = br.nashconv();
    // "exploitable" follows Pio's convention: the per-player average gain
    // from best-responding = NashConv / num_seats for 2 players.
    const double exploitable = nashconv / game->num_seats();
    std::cout << "iter " << done << "  nashconv " << nashconv
              << "  exploitable " << exploitable;
    if (pot > 0.0) std::cout << " (" << 100.0 * exploitable / pot << "% of pot)";
    std::cout << "  ev";
    for (double ev : br.ev) std::cout << " " << ev;
    std::cout << "\n";
    if (config.target_nashconv > 0.0 && nashconv <= config.target_nashconv) {
      std::cout << "target_nashconv reached\n";
      break;
    }
    if (config.target_exploitable_pct > 0.0 && pot > 0.0 &&
        exploitable <= config.target_exploitable_pct / 100.0 * pot) {
      std::cout << "target_exploitable_pct reached\n";
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
  stats.peak_rss_bytes = peak_rss_bytes();

  LocalStore store;
  write_artifact(store, config.output_path, *game, solver, config, stats);
  std::cout << "wrote " << config.output_path << "  (wall " << wall_s << " s, peak RSS "
            << stats.peak_rss_bytes / (1024.0 * 1024.0) << " MB)\n";
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
      std::cout << dump_artifact_json(store, args.input_path, args.node, args.runouts).dump(2)
                << "\n";
      return 0;
    }
    const SolveConfig config = load_config(args.input_path);
    return run_solve(config, args.subcommand == "dry-run");
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
