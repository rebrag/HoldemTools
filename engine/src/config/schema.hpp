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

// How a preflop all-in showdown averages over the board.
//
// There is no board in the tree - a runout as a chance node would make the
// cards PUBLIC, which is a different game. The average lives inside
// NlhePreflopGame::terminal_values, and this is its budget.
//
// `pair_count` builds the exact-in-the-limit pairwise equity matrix, whose
// cost is paid once at construction and never per iteration (heads-up, the
// board expectation commutes with the sum over opponent hands, so a static
// matrix is exact). `iter_count` is the per-iteration sample the 3+ way
// terminals average over, where no such factorization exists.
//
// The sample is FIXED across iterations, unlike SamplingConfig: that makes
// the solve an exact solve of a well-defined sampled game rather than a noisy
// estimate of the true one, which is what lets the accuracy stop mean
// something. Every number here lands in artifact metadata so a result is
// reproducible from (seed, iter_count, pair_count).
struct BoardSampleConfig {
  // Both defaults are MEASURED, by tools/bench_board_sample.py, not picked.
  // On heads-up 10bb push/fold the 169-class chart is stable to 1-3 boundary
  // classes from pair_count 5000 upward and the jam percentage moves by under
  // a point all the way to 200000, while setup time is linear in it: 1.2 s,
  // 4.7 s, 18.9 s, 47.2 s at 5000 / 20000 / 80000 / 200000. 20000 is the knee
  // that fits an on-demand solve.
  int iter_count = 500;
  int pair_count = 20000;
  std::uint64_t seed = 20260830;
};

// The preflop game's structure. Seats are `players[i]` clockwise; the blinds
// are derived from `button` (SB = button+1, BB = button+2, heads-up the
// button IS the small blind).
struct PreflopConfig {
  Chips small_blind = 0;
  Chips big_blind = 0;
  std::vector<Chips> ante;  // one per seat; a scalar in JSON broadcasts
  int button = 0;
  Chips dead = 0;  // straddle / dead money already in the middle
  std::string action_set = "jam_fold";
  BoardSampleConfig board_sample;
};

// Parsed and validated solve configuration (config schema v1). The raw
// canonical JSON is kept for hashing and artifact metadata embedding.
// Keys for QRE, multiway, and collusion are parsed and validated so configs
// are forward-compatible, but only nash / identity-partition / no-collusion
// values are accepted until those passes land.
struct SolveConfig {
  int schema = 1;
  std::string game = "nlhe";  // nlhe | nlhe_preflop | kuhn | leduc
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
  PreflopConfig preflop;  // game == "nlhe_preflop" only

  UpdateConfig update;   // algorithm.update / dcfr params
  RecalcConfig recalc;   // algorithm.recalc - chance-child revisit schedule
  SamplingConfig sampling;  // algorithm.sampling - chance-node subsampling
  SampledConfig sampled;    // algorithm.family "sampled" - the deal-sampling core
  // Collapse suit-equivalent runout subtrees (lossless relabeling). Disabled
  // automatically when the ranges are not suit-symmetric.
  bool isomorphism = true;

  // "nash" | "qre". The mode string is kept separate from the parsed config
  // because it is what the artifact metadata records and what every
  // downstream refusal (the Pio harness, the solutions exporter) keys off.
  std::string qre_mode = "nash";
  // Team solves (one 2-seat hand-sharing group in agents.partition):
  // "aware" trains everyone together (opponents adapt to the team);
  // "unaware" freezes opponents at a no-team baseline solved first and
  // trains only the team - the joint best response. Empty when no team.
  std::string awareness;
  // Iterations for the unaware baseline phase; 0 = budget.iterations.
  std::uint64_t baseline_iterations = 0;
  QreConfig qre;  // qre.lambda / qre.anneal - only read when qre_mode == "qre"

  std::vector<std::vector<int>> partition;  // seat indices per agent
  std::string collusion_mode = "none";
  double collusion_p = 0.0;

  std::uint64_t iterations = 100000;
  double target_nashconv = 0.0;  // chips; 0 = no NashConv stop
  // Pio-style accuracy stop: per-player exploitability ("exploitable for",
  // = NashConv / 2) as a percent of the root pot. 0 = disabled. Pio's
  // default UI value is 0.02 (% of the pot).
  double target_exploitable_pct = 0.0;
  // Wall-clock ceiling for the WHOLE run in seconds; 0 = none. On expiry the
  // solve stops at the next slice and writes the artifact for the iterations
  // it completed, with metadata.stopped_reason = "time_budget". This exists
  // so an externally imposed deadline (a watcher's kill) cannot discard the
  // whole solve: the artifact is only written at the end, so a killed run
  // yields nothing at all. Set it BELOW the external deadline, leaving room
  // for the EV pass and the artifact export.
  double max_seconds = 0.0;
  std::uint64_t checkpoint_every = 1000;
  double memory_limit_gb = 12.0;

  // Solver checkpoint (sampled family only). When set, the solve RESUMES
  // from this file if it exists and matches, and writes it back afterwards -
  // so re-running the same config with a larger budget.iterations continues
  // toward the target instead of starting over. budget.iterations is
  // therefore a TOTAL, not a per-run amount.
  std::string checkpoint_path;
  // Identity of the SOLVE LINEAGE, not of one run: checkpoints are named
  // after it, so "resume solve X" is a thing you can say. Defaults to a short
  // hash of the spot, which makes re-solving the same spot continue it; set
  // it explicitly to keep separate lineages for the same spot. Reusing an id
  // for a DIFFERENT spot is refused, not silently reinterpreted.
  std::string solve_id;
  // "auto"    - continue from a checkpoint when one matches (the default)
  // "never"   - ignore any checkpoint and start over, overwriting it
  // "require" - fail unless there is a checkpoint to continue, so a typo in
  //             the id cannot silently start a ten-hour solve from zero
  std::string resume_mode = "auto";
  // Extending phase 1 moves the baseline that phase 2's regrets were a best
  // response to, which makes them stale. That is refused unless this says
  // otherwise, in which case phase 2 restarts against the new baseline.
  bool rebase = false;
  // Alternative to naming the file: a directory in which the checkpoint is
  // named after the solve's own identity hash, so identical spots share one
  // automatically and different spots can never collide. A caller that
  // queues many jobs (the watcher) sets this and nothing else.
  std::string checkpoint_dir;
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

// The identity of the SOLVE rather than of the file: config_hash over
// everything except the fields that legitimately differ between chunks of one
// long run (budget, output paths, threads, memory limit,
// agents.baseline_iterations). Two configs sharing this key describe the same
// spot and the same deal stream, so a checkpoint from one may be resumed by
// the other - which is exactly what raising budget.iterations does.
std::string config_solve_key(const SolveConfig& config);

}  // namespace engine
