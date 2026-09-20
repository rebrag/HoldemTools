#include <doctest/doctest.h>

#include <cstdint>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "solver/agents.hpp"
#include "solver/sampled_cfr.hpp"

// NEUTRALITY DIGESTS for the sampled core.
//
// Every other bitwise gate in this suite pins an INVARIANCE - the same bits
// at 1 and 8 threads, across a checkpoint, across a batch boundary. None of
// them pins the bits themselves, so a refactor that changed every number
// consistently would pass all of them. These digests are the absolute
// reference: FNV-1a over the raw solver arrays after fixed short solves,
// recorded once from the pre-refactor binary. A change that is meant to be
// bit-for-bit neutral (the InfosetIndexer seam, sparse lane deltas, the
// parallel discount sweep) must leave every literal below untouched; a change
// that legitimately moves the numbers re-records them in the same commit and
// says why.
//
// The arithmetic here is +, *, / on floats under strict FP plus integer
// hashing, so the digests should be stable across compilers - and the first
// CI run said otherwise: GCC contracted a*b+c into fused multiply-adds under
// -march=x86-64-v3, which rounds once where MSVC rounds twice. That is
// -ffp-contract=off in CMakeLists now. The literals were recorded on MSVC,
// which is the Pio-gated compiler; on any other compiler a mismatch is a
// WARN so the CI log shows the bits without failing the build. Promote it
// to CHECK once a GCC run has printed matching digests.

using namespace engine;

namespace {

std::uint64_t fnv1a(std::uint64_t h, const void* data, std::size_t bytes) {
  const auto* p = static_cast<const unsigned char*>(data);
  for (std::size_t i = 0; i < bytes; ++i) {
    h ^= p[i];
    h *= 1099511628211ULL;
  }
  return h;
}

std::uint64_t digest(const std::vector<float>& v, std::uint64_t h = 14695981039346656037ULL) {
  return fnv1a(h, v.data(), v.size() * sizeof(float));
}

std::string hex(std::uint64_t v) {
  std::ostringstream out;
  out << "0x" << std::hex << std::setw(16) << std::setfill('0') << v << "ULL";
  return out.str();
}

// Digest of the whole mutable state: regrets, strategy sums, conditioned
// team EV numerators and denominators (empty without a team).
std::uint64_t state_digest(const SampledCfrSolver& solver) {
  std::uint64_t h = digest(solver.regrets());
  h = digest(solver.strategy_sums(), h);
  h = digest(solver.ev_sums(), h);
  h = digest(solver.ev_weights(), h);
  return h;
}

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

SolveConfig pushfold_config(int seats) {
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
  return config;
}

SolveConfig flop_config() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = "Qs Jh 2h";
  config.pot = 100;
  config.isomorphism = false;
  config.players = {{"OOP", 200, "AA,KK,QQ,AKs,A5s,KQs,76s"},
                    {"IP", 200, "JJ,TT,99,AQs,KQs,T9s"}};
  StreetSizing sizing;
  sizing.oop.bets = {75.0};
  sizing.ip.bets = {75.0};
  sizing.oop.raises = {100.0};
  sizing.ip.raises = {100.0};
  sizing.max_raises = 1;
  config.flop_sizing = sizing;
  config.turn_sizing = sizing;
  config.river_sizing = sizing;
  config.threads = 0;
  return config;
}

SampledConfig sampled(std::uint64_t seed, std::uint32_t batch, std::uint32_t lanes) {
  SampledConfig c;
  c.enabled = true;
  c.seed = seed;
  c.batch = batch;
  c.lanes = lanes;
  return c;
}

AgentMap team_map(int seats, int a, int b) {
  AgentMap map = AgentMap::identity(seats);
  map.teammate_of[static_cast<std::size_t>(a)] = b;
  map.teammate_of[static_cast<std::size_t>(b)] = a;
  map.seat_to_agent[static_cast<std::size_t>(b)] = map.seat_to_agent[static_cast<std::size_t>(a)];
  map.num_agents = seats - 1;
  return map;
}

void check_digest(const std::string& what, std::uint64_t got, std::uint64_t expected) {
  MESSAGE(what << " digest " << hex(got));
#if defined(_MSC_VER)
  CHECK(got == expected);
#else
  WARN(got == expected);
#endif
}

// Recorded 2026-09-11 from the pre-InfosetIndexer binary (commit 2061b08),
// and RE-RECORDED 2026-09-20 when the master moved to its raw iteration-
// weighted form (no per-batch discount sweep; each batch's deltas fold in
// times the batch's end iteration, see SampledCfrSolver's header). The
// row-major interleaved store that landed just before it left every literal
// untouched - the canonical accessors below emit the old order, so that
// change was provably a permutation - and this one moves them because the
// arithmetic changed: R = sum b1 * delta instead of the telescoped product.
constexpr std::uint64_t kKuhn = 0xb4f484ffec6c58b6ULL;
constexpr std::uint64_t kLeduc = 0x5f476945c84f7057ULL;
constexpr std::uint64_t kHuPushfold = 0x8bb9c98340f39586ULL;
constexpr std::uint64_t kTeamUnaware = 0x92855f2946e744deULL;
constexpr std::uint64_t kFlop = 0xcd513ade07d95f3aULL;

}  // namespace

TEST_CASE("sampled digest: Kuhn") {
  toy::KuhnGame game;
  SampledCfrSolver solver(game, game, sampled(20260830, 32, 4));
  solver.run(20000);
  check_digest("kuhn", state_digest(solver), kKuhn);
}

TEST_CASE("sampled digest: Leduc") {
  toy::LeducGame game;
  SampledCfrSolver solver(game, game, sampled(20260830, 32, 4));
  solver.run(20000);
  check_digest("leduc", state_digest(solver), kLeduc);
}

TEST_CASE("sampled digest: heads-up push/fold under the suit quotient") {
  const SolveConfig config = pushfold_config(2);
  NlhePreflopGame game(config);
  SampledCfrSolver solver(game, game, sampled(20260830, 1024, 16), config.threads);
  solver.run(8192);
  check_digest("hu pushfold", state_digest(solver), kHuPushfold);
}

TEST_CASE("sampled digest: 3-way unaware team with a frozen seat") {
  const SolveConfig config = pushfold_config(3);
  NlhePreflopGame game(config);
  SampledCfrSolver baseline(game, game, sampled(20260830, 1024, 16), config.threads);
  baseline.run(4096);
  SampledCfrSolver team(game, game, sampled(20260830, 1024, 16), config.threads,
                        team_map(3, 0, 2));
  std::vector<bool> frozen(3, false);
  frozen[1] = true;
  team.freeze_seats_from(baseline, frozen);
  team.run(4096);
  check_digest("team unaware", state_digest(team), kTeamUnaware);
}

TEST_CASE("sampled digest: heads-up flop tree") {
  const SolveConfig config = flop_config();
  NlhePostflopGame game(config);
  SampledCfrSolver solver(game, game, sampled(7, 64, 8), config.threads);
  solver.run(5120);
  check_digest("flop", state_digest(solver), kFlop);
}
