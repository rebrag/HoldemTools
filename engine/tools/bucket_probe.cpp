// bucket_probe: how much does a hand abstraction cost, by itself?
//
// Takes an exact vectorized solve of a spot the vectorized core can hold (a
// 3-way turn root, say) and, for a grid of bucket counts and both feature
// methods, projects it onto the bucket map (solver/bucket_projection.hpp)
// and rates the projection with the exact best response. That is the
// abstraction's representational error in chips with no sampling noise in
// it, cheap enough to sweep before any bucketed sampled solve is run.
//
// The exact strategy comes either from an artifact written with f32
// strategy (--artifact, the cheap way: the solve happens once) or from an
// in-process vectorized solve to the config's own budget.
//
//   bucket_probe <config.json> [--artifact solve.hta] [--turn 50,100,200]
//                [--river 50,100,200] [--flop 0] [--methods equity,histogram]
//                [--bins 16] [--no-board-iso] [--json out.json]
//
// Read the caveats in bucket_projection.hpp before quoting a number: the
// projection weights by range where the solve weights by reach, and CFR on
// the abstract game can land above or below it. It ranks candidates; the
// bucketed solve's own best response is the gate.

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "io/artifact_format.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_store.hpp"
#include "solver/artifact_source.hpp"
#include "solver/best_response.hpp"
#include "solver/bucket_projection.hpp"
#include "solver/cfr.hpp"
#include "solver/infoset_indexer.hpp"
#include "util/parallel.hpp"

using namespace engine;

namespace {

std::vector<int> parse_ints(const std::string& text) {
  std::vector<int> out;
  std::stringstream ss(text);
  std::string item;
  while (std::getline(ss, item, ',')) {
    if (!item.empty()) out.push_back(std::stoi(item));
  }
  return out;
}

std::vector<std::string> parse_words(const std::string& text) {
  std::vector<std::string> out;
  std::stringstream ss(text);
  std::string item;
  while (std::getline(ss, item, ',')) {
    if (!item.empty()) out.push_back(item);
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: bucket_probe <config.json> [--artifact solve.hta] [--turn a,b] "
                 "[--river a,b] [--flop a,b] [--methods equity,histogram] [--bins N] "
                 "[--no-board-iso] [--json out.json]\n";
    return 2;
  }
  std::string config_path = argv[1];
  std::string artifact_path;
  std::vector<int> turn_counts = {50, 100, 200, 400};
  std::vector<int> river_counts = {50, 100, 200};
  std::vector<int> flop_counts = {0};
  std::vector<std::string> methods = {"equity", "histogram"};
  int bins = 16;
  bool board_iso = true;
  std::string json_out;
  for (int i = 2; i < argc; ++i) {
    const std::string arg = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) throw std::runtime_error("missing value after " + arg);
      return argv[++i];
    };
    if (arg == "--artifact") artifact_path = next();
    else if (arg == "--turn") turn_counts = parse_ints(next());
    else if (arg == "--river") river_counts = parse_ints(next());
    else if (arg == "--flop") flop_counts = parse_ints(next());
    else if (arg == "--methods") methods = parse_words(next());
    else if (arg == "--bins") bins = std::stoi(next());
    else if (arg == "--no-board-iso") board_iso = false;
    else if (arg == "--json") json_out = next();
    else {
      std::cerr << "unknown argument " << arg << "\n";
      return 2;
    }
  }

  SolveConfig config = load_config(config_path);
  if (config.game != "nlhe") {
    std::cerr << "bucket_probe needs a postflop nlhe config\n";
    return 2;
  }
  if (config.sampled.enabled) {
    std::cerr << "give bucket_probe the VECTORIZED config of the spot; it builds the "
                 "sampled abstraction itself\n";
    return 2;
  }
  const auto setup_start = std::chrono::steady_clock::now();
  NlhePostflopGame game(config);
  std::cout << "tree " << game.tree().size() << " nodes, " << game.tree().num_decision_nodes
            << " decision, universe " << game.num_hands(0) << " hands, "
            << game.abstraction_symmetries() << " root symmetries\n";
  if (!game.vectorized_terminals()) {
    std::cerr << "no exact best response past three seats; use a 2 or 3 seat spot\n";
    return 2;
  }

  // The exact strategy.
  std::unique_ptr<CfrSolver> solver;
  std::unique_ptr<ArtifactStrategySource> from_artifact;
  LocalStore store;
  std::unique_ptr<ArtifactReader> reader;
  const StrategySource* exact = nullptr;
  if (!artifact_path.empty()) {
    reader = std::make_unique<ArtifactReader>(store, artifact_path);
    if (reader->flags() & artifact::kFlagStrategyU8) {
      std::cerr << "warning: the artifact stores u8 strategy; the projection reads quantized "
                   "rows (write it with strategy_quantize_u8 false for an exact reference)\n";
    }
    from_artifact = std::make_unique<ArtifactStrategySource>(game, *reader, config.threads);
    exact = from_artifact.get();
    std::cout << "exact strategy from " << artifact_path << " ("
              << reader->metadata().value("iterations", 0) << " iterations)\n";
  } else {
    solver = std::make_unique<CfrSolver>(game, config.update, config.threads, config.recalc,
                                         config.sampling, config.qre);
    const double pot = static_cast<double>(config.pot);
    std::uint64_t done = 0;
    while (done < config.iterations) {
      const std::uint64_t slice = std::min<std::uint64_t>(config.checkpoint_every,
                                                          config.iterations - done);
      solver->run(slice);
      done += slice;
      const BrResult br = compute_best_response(game, *solver);
      const double per_seat = br.nashconv() / game.num_seats();
      std::cout << "  exact iter " << done << " nashconv " << br.nashconv() << " exploitable "
                << per_seat << " (" << per_seat / pot * 100.0 << "% pot)\n";
      if (config.target_exploitable_pct > 0.0 && per_seat / pot * 100.0 <= config.target_exploitable_pct) {
        break;
      }
    }
  }
  // CfrStrategySource above is a temporary; hold a stable one.
  std::unique_ptr<CfrStrategySource> held;
  if (solver) {
    held = std::make_unique<CfrStrategySource>(*solver);
    exact = held.get();
  }
  const double setup_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - setup_start).count();

  const BrResult reference = compute_best_response(game, *exact);
  const double pot = static_cast<double>(config.pot);
  std::cout << "reference: nashconv " << reference.nashconv() << ", exploitable "
            << reference.nashconv() / game.num_seats() << " chips/seat ("
            << reference.nashconv() / game.num_seats() / pot * 100.0 << "% pot), ev";
  for (double v : reference.ev) std::cout << " " << v;
  std::cout << "  [setup " << setup_s << " s]\n";

  nlohmann::json results = nlohmann::json::array();
  std::cout << "\nmethod     flop  turn  river   rows        groups   exploitable/seat   % pot   "
               "delta vs exact   ev\n";
  for (const std::string& method : methods) {
    for (int flop : flop_counts) {
      for (int turn : turn_counts) {
        for (int river : river_counts) {
          SampledConfig sc;
          sc.enabled = true;
          sc.abstraction.enabled = true;
          sc.abstraction.method = method;
          sc.abstraction.flop = flop;
          sc.abstraction.turn = turn;
          sc.abstraction.river = river;
          sc.abstraction.bins = bins;
          sc.abstraction.board_isomorphism = board_iso;
          const auto t0 = std::chrono::steady_clock::now();
          InfosetIndexer ix = InfosetIndexer::plan(game, game, sc, {}, 0);
          ix.fit(game, sc, exact->pool());
          BucketProjectedSource projected(game, *exact, ix);
          const BrResult br = compute_best_response(game, projected);
          const double per_seat = br.nashconv() / game.num_seats();
          const double secs =
              std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
          std::cout << method << std::string(11 - method.size(), ' ') << flop << "     " << turn
                    << "    " << river << "     " << ix.store_total << "   " << ix.num_groups
                    << "   " << per_seat << "   " << per_seat / pot * 100.0 << "   "
                    << per_seat - reference.nashconv() / game.num_seats() << "   ";
          for (double v : br.ev) std::cout << v << " ";
          std::cout << "  [" << secs << " s]\n";
          results.push_back({{"method", method},
                             {"flop", flop},
                             {"turn", turn},
                             {"river", river},
                             {"storage_rows", ix.store_total},
                             {"storage_groups", ix.num_groups},
                             {"nashconv", br.nashconv()},
                             {"exploitable_chips", per_seat},
                             {"exploitable_pct_pot", per_seat / pot * 100.0},
                             {"ev_chips", br.ev},
                             {"seconds", secs}});
        }
      }
    }
  }
  if (!json_out.empty()) {
    nlohmann::json out;
    out["config"] = config_path;
    out["artifact"] = artifact_path;
    out["reference"] = {{"nashconv", reference.nashconv()},
                        {"exploitable_chips", reference.nashconv() / game.num_seats()},
                        {"ev_chips", reference.ev}};
    out["results"] = results;
    std::ofstream(json_out) << out.dump(1) << "\n";
    std::cout << "wrote " << json_out << "\n";
  }
  return 0;
}
