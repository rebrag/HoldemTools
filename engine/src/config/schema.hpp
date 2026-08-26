#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "game/betting_tree.hpp"
#include "game/types.hpp"
#include "solver/updates.hpp"

namespace engine {

struct PlayerConfig {
  std::string seat;   // display label ("OOP", "IP", "BB", ...)
  Chips stack = 0;    // chips behind at the root
  std::string range;  // range string, resolved from @file: at load time
};

// Parsed and validated solve configuration (config schema v1). The raw
// canonical JSON is kept for hashing and artifact metadata embedding.
// Keys for QRE, multiway, and collusion are parsed and validated so configs
// are forward-compatible, but only nash / identity-partition / no-collusion
// values are accepted until those passes land.
struct SolveConfig {
  int schema = 1;
  std::string game = "nlhe";  // nlhe | kuhn | leduc
  std::string board;          // 3 cards = flop solve, 4 = turn, 5 = river
  Chips pot = 0;
  double chip_scale = 100.0;  // chips per display-money unit
  std::vector<PlayerConfig> players;
  StreetSizing flop_sizing;
  StreetSizing turn_sizing;
  StreetSizing river_sizing;
  // Aggressor on the street before the root (preflop for flop solves);
  // gates whether OOP's first-in sizes come from donks or bets.
  Aggressor preflop_aggressor = Aggressor::None;

  UpdateConfig update;   // algorithm.update / dcfr params
  RecalcConfig recalc;   // algorithm.recalc - chance-child revisit schedule
  // Collapse suit-equivalent runout subtrees (lossless relabeling). Disabled
  // automatically when the ranges are not suit-symmetric.
  bool isomorphism = true;

  std::string qre_mode = "nash";  // nash | qre (qre lands in M7)

  std::vector<std::vector<int>> partition;  // seat indices per agent
  std::string collusion_mode = "none";
  double collusion_p = 0.0;

  std::uint64_t iterations = 100000;
  double target_nashconv = 0.0;  // chips; 0 = no NashConv stop
  // Pio-style accuracy stop: per-player exploitability ("exploitable for",
  // = NashConv / 2) as a percent of the root pot. 0 = disabled. Pio's
  // default UI value is 0.02 (% of the pot).
  double target_exploitable_pct = 0.0;
  std::uint64_t checkpoint_every = 1000;
  double memory_limit_gb = 12.0;

  std::string output_path = "out/solve.hta";
  bool strategy_quantize_u8 = true;
  bool ev_float32 = true;
  bool rollups_169 = true;
  int threads = 0;

  nlohmann::json raw;  // canonical parsed config (comments stripped)
};

// Load + validate a config file (JSON, comments allowed). @file: ranges are
// resolved relative to the config file's directory. Throws std::runtime_error
// with a actionable message on any invalid or not-yet-supported value.
SolveConfig load_config(const std::string& path);

// SHA-256 hex of the canonical (sorted-key, compact) config JSON.
std::string config_hash(const SolveConfig& config);

}  // namespace engine
