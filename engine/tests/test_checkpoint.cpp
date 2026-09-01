#include <doctest/doctest.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "io/checkpoint.hpp"
#include "solver/agents.hpp"
#include "solver/sampled_cfr.hpp"

using namespace engine;

namespace {

std::string full_range() {
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

SolveConfig ck_config(int seats) {
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
  config.preflop.board_sample.pair_count = 2000;
  config.preflop.board_sample.iter_count = 3;
  config.preflop.board_sample.seed = 20260830;
  config.pot = 3;
  config.threads = 0;
  config.sampled.enabled = true;
  // resume_key() hashes the canonical raw config, so the test configs need a
  // raw form to hash. Only the fields the key keeps have to be present.
  config.raw = nlohmann::json{{"game", "nlhe_preflop"},
                              {"players", seats},
                              {"algorithm", {{"family", "sampled"}}}};
  return config;
}

SampledConfig ck_solver_config() {
  SampledConfig config;
  config.enabled = true;
  config.seed = 20260830;
  config.batch = 256;
  config.lanes = 8;
  return config;
}

AgentMap team_of(int seats, int a, int b) {
  AgentMap map = AgentMap::identity(seats);
  map.teammate_of[static_cast<std::size_t>(a)] = b;
  map.teammate_of[static_cast<std::size_t>(b)] = a;
  map.seat_to_agent[static_cast<std::size_t>(b)] =
      map.seat_to_agent[static_cast<std::size_t>(a)];
  map.num_agents = seats - 1;
  return map;
}

bool same_bits(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() &&
         std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}

}  // namespace

TEST_CASE("checkpoint resume is bitwise identical to an uninterrupted run") {
  // The property the whole feature rests on: the sampled core's deal stream
  // is sample_deal(seed, t) and its discount scales by ABSOLUTE iteration,
  // so restoring (regrets, strategy sums, t) and continuing must reproduce
  // exactly what running straight through would have produced.
  const SolveConfig config = ck_config(3);
  NlhePreflopGame game(config);
  const std::uint64_t kHalf = 2048;  // whole batches, as a real resume is

  SampledCfrSolver whole(game, game, ck_solver_config(), config.threads);
  whole.run(kHalf * 2);

  const std::string path = "test_checkpoint_plain.htck";
  {
    SampledCfrSolver first(game, game, ck_solver_config(), config.threads);
    first.run(kHalf);
    CheckpointExtras extras;
    write_checkpoint(path, first, config, extras);
  }
  SampledCfrSolver second(game, game, ck_solver_config(), config.threads);
  CheckpointExtras extras;
  std::string err;
  REQUIRE(read_checkpoint(path, second, config, extras, err));
  CHECK(second.iteration() == kHalf);
  second.run(kHalf);
  CHECK(second.iteration() == whole.iteration());
  CHECK(same_bits(whole.regrets(), second.regrets()));
  CHECK(same_bits(whole.strategy_sums(), second.strategy_sums()));
  std::remove(path.c_str());
}

TEST_CASE("checkpoint carries team state: frozen rows, EVs and conditioned EVs") {
  // A team checkpoint has to round-trip more than the two big arrays: the
  // frozen baseline rows phase 2 plays against, the baseline EVs the uplift
  // is measured from, and the conditioned-EV accumulators. Miss any of them
  // and a resumed run silently changes game.
  const SolveConfig config = ck_config(3);
  NlhePreflopGame game(config);
  const std::uint64_t kHalf = 1024;
  const AgentMap agents = team_of(3, 0, 2);
  std::vector<bool> frozen(3, false);
  frozen[1] = true;

  SampledCfrSolver baseline(game, game, ck_solver_config(), config.threads);
  baseline.run(2048);
  const std::vector<double> base_ev = baseline.sampled_ev(4000, 99);

  SampledCfrSolver whole(game, game, ck_solver_config(), config.threads, agents);
  whole.freeze_seats_from(baseline, frozen);
  whole.run(kHalf * 2);

  const std::string path = "test_checkpoint_team.htck";
  {
    SampledCfrSolver first(game, game, ck_solver_config(), config.threads, agents);
    first.freeze_seats_from(baseline, frozen);
    first.run(kHalf);
    CheckpointExtras extras;
    extras.baseline_iterations = baseline.iteration();
    extras.baseline_ev_chips = base_ev;
    write_checkpoint(path, first, config, extras);
  }
  // Resumed WITHOUT calling freeze_seats_from: the frozen rows must come
  // back from the file, exactly as they do in a real resumed run where the
  // baseline solver no longer exists.
  SampledCfrSolver second(game, game, ck_solver_config(), config.threads, agents);
  CheckpointExtras extras;
  std::string err;
  REQUIRE(read_checkpoint(path, second, config, extras, err));
  CHECK(extras.baseline_iterations == baseline.iteration());
  REQUIRE(extras.baseline_ev_chips.size() == base_ev.size());
  for (std::size_t i = 0; i < base_ev.size(); ++i) {
    CHECK(extras.baseline_ev_chips[i] == doctest::Approx(base_ev[i]));
  }
  second.run(kHalf);
  CHECK(same_bits(whole.regrets(), second.regrets()));
  CHECK(same_bits(whole.strategy_sums(), second.strategy_sums()));
  CHECK(same_bits(whole.ev_sums(), second.ev_sums()));
  CHECK(same_bits(whole.ev_weights(), second.ev_weights()));
  std::remove(path.c_str());
}

TEST_CASE("a checkpoint from a different spot is refused, not reinterpreted") {
  // The dangerous failure is not a crash, it is a confident wrong answer
  // from continuing another spot's regrets.
  const SolveConfig config = ck_config(3);
  NlhePreflopGame game(config);
  const std::string path = "test_checkpoint_mismatch.htck";
  {
    SampledCfrSolver first(game, game, ck_solver_config(), config.threads);
    first.run(512);
    CheckpointExtras extras;
    write_checkpoint(path, first, config, extras);
  }

  SolveConfig other = config;
  other.raw["players"] = 4;  // a different spot entirely
  SampledCfrSolver second(game, game, ck_solver_config(), config.threads);
  CheckpointExtras extras;
  std::string err;
  CHECK_FALSE(read_checkpoint(path, second, other, extras, err));
  CHECK(err.find("different spot") != std::string::npos);
  CHECK(second.iteration() == 0);

  // Raising the BUDGET must still resume - that is the whole point.
  SolveConfig bigger = config;
  bigger.raw["budget"] = nlohmann::json{{"iterations", 999999}};
  bigger.iterations = 999999;
  SampledCfrSolver third(game, game, ck_solver_config(), config.threads);
  CHECK(read_checkpoint(path, third, bigger, extras, err));
  CHECK(third.iteration() == 512);

  CHECK_FALSE(read_checkpoint("no_such_file.htck", third, config, extras, err));
  std::remove(path.c_str());
}

TEST_CASE("solve identity ignores the budget but not the spot") {
  // Everything above rests on this: raising the budget (or renaming the
  // output, or naming the lineage) must NOT change what counts as the same
  // solve, while any change to the spot must. The rule is written as a
  // subtraction from the whole config so a new solve-defining key is covered
  // the day it appears - which only works if the subtraction list stays this
  // short.
  SolveConfig a = ck_config(3);
  const std::string key = config_solve_key(a);

  SolveConfig same = a;
  same.raw["budget"] = nlohmann::json{{"iterations", 999999}, {"max_seconds", 120}};
  same.raw["output"] = nlohmann::json{{"path", "elsewhere.hta"}};
  same.raw["solve"] = nlohmann::json{{"id", "a-different-name"}};
  same.raw["threads"] = 4;
  same.raw["memory_limit_gb"] = 32;
  CHECK(config_solve_key(same) == key);

  SolveConfig other = a;
  other.raw["players"] = 4;
  CHECK(config_solve_key(other) != key);

  SolveConfig reseeded = a;
  reseeded.raw["algorithm"] = nlohmann::json{{"family", "sampled"}, {"sampled", {{"seed", 7}}}};
  CHECK(config_solve_key(reseeded) != key);
}
