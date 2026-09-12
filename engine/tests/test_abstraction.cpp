#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "config/schema.hpp"
#include "game/nlhe_river.hpp"
#include "io/checkpoint.hpp"
#include "solver/best_response.hpp"
#include "solver/infoset_indexer.hpp"
#include "solver/memory.hpp"
#include "solver/sampled_cfr.hpp"

// Hand abstraction on the sampled core (the InfosetIndexer seam). Everything
// here is deterministic - counter-based deals, seeded clustering - so the
// gates are exact where they can be and calibrated once where they cannot.

using namespace engine;

namespace {

// Three seats on a turn board whose c and d suits are free (only h and s
// appear), so the root symmetry group is {id, c<->d} and runouts pair up.
const char* kRange = "AA,KK,QQ,JJ,TT,99,88,AKs,AKo,AQs,AJs,KQs,QJs,JTs,T9s,98s,87s,76s,A5s";

SolveConfig turn3_config(const std::string& board = "Qs Jh 2h 8h") {
  SolveConfig config;
  config.game = "nlhe";
  config.board = board;
  config.pot = 90;
  config.isomorphism = false;
  config.players = {{"OOP", 200, kRange}, {"MID", 200, kRange}, {"BTN", 200, kRange}};
  StreetSizing sizing;
  sizing.oop.bets = {60.0};
  sizing.ip.bets = {60.0};
  sizing.oop.raises = {100.0};
  sizing.ip.raises = {100.0};
  sizing.max_raises = 1;
  config.turn_sizing = sizing;
  config.river_sizing = sizing;
  config.threads = 0;
  config.sampled.enabled = true;
  return config;
}

SampledConfig sampled_cfg(int turn, int river, const std::string& method = "equity",
                          bool board_iso = true, std::uint64_t seed = 7) {
  SampledConfig c;
  c.enabled = true;
  c.seed = seed;
  c.batch = 256;
  c.lanes = 8;
  c.abstraction.enabled = true;
  c.abstraction.method = method;
  c.abstraction.turn = turn;
  c.abstraction.river = river;
  c.abstraction.board_isomorphism = board_iso;
  return c;
}

std::vector<NodeId> node_of_decision(const PublicTree& tree) {
  std::vector<NodeId> out(tree.num_decision_nodes);
  for (NodeId id = 0; id < tree.size(); ++id) {
    if (tree[id].kind == NodeKind::Decision) out[tree[id].decision_index] = id;
  }
  return out;
}

std::filesystem::path temp_file(const std::string& name, const std::string& body) {
  const std::filesystem::path dir = std::filesystem::temp_directory_path() / "engine_abstraction";
  std::filesystem::create_directories(dir);
  const std::filesystem::path path = dir / name;
  std::ofstream out(path);
  out << body;
  return path;
}

}  // namespace

TEST_CASE("abstraction: the indexer buckets by street and maps blocked hands to row 0") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  const SampledConfig sc = sampled_cfg(8, 6);
  InfosetIndexer ix = InfosetIndexer::plan(game, game, sc, {}, 0);
  REQUIRE(ix.mode == InfosetIndexer::Mode::Abstraction);
  ThreadPool pool(4);
  ix.fit(game, sc, pool);
  const PublicTree& tree = game.tree();
  const std::uint32_t H = static_cast<std::uint32_t>(game.num_hands(0));
  int turn_nodes = 0, river_nodes = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const std::uint32_t d = node.decision_index;
    const std::uint32_t expect = node.street == Street::Turn ? 8u : 6u;
    CHECK(ix.rows(d) == expect);
    const std::uint16_t* map = ix.map(d);
    const std::uint8_t* valid = ix.valid(d);
    REQUIRE(valid != nullptr);
    for (std::uint32_t h = 0; h < H; ++h) {
      CHECK(map[h] < expect);
      if (!valid[h]) CHECK(map[h] == 0);
    }
    (node.street == Street::Turn ? turn_nodes : river_nodes)++;
  }
  CHECK(turn_nodes > 0);
  CHECK(river_nodes > 0);
  // River buckets are strength quantiles: a hand in a higher bucket is never
  // weaker than a hand in a lower one on the same board.
  for (const Node& node : tree.nodes) {
    if (node.kind != NodeKind::Decision || node.street != Street::River) continue;
    std::vector<std::uint32_t> strength;
    game.abstraction_strengths(node.board_mask, strength);
    const std::uint16_t* map = ix.map(node.decision_index);
    const std::uint8_t* valid = ix.valid(node.decision_index);
    for (std::uint32_t a = 0; a < H; ++a) {
      if (!valid[a]) continue;
      for (std::uint32_t b = 0; b < H; ++b) {
        if (!valid[b]) continue;
        if (map[a] < map[b]) CHECK(strength[a] <= strength[b]);
      }
    }
    break;  // one board is enough; every board runs the same code
  }
  // The store shrank: 8 rows on a turn node against the full universe.
  CHECK(ix.store_total < static_cast<std::size_t>(H) * tree.num_decision_nodes);
}

TEST_CASE("abstraction: board isomorphism shares groups between c<->d runouts, and off keeps them apart") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  REQUIRE(game.abstraction_symmetries() == 1);
  const InfosetIndexer on = InfosetIndexer::plan(game, game, sampled_cfg(8, 6, "equity", true), {}, 0);
  const InfosetIndexer off = InfosetIndexer::plan(game, game, sampled_cfg(8, 6, "equity", false), {}, 0);
  CHECK(off.num_groups == game.tree().num_decision_nodes);
  CHECK(on.num_groups < off.num_groups);
  CHECK(on.store_total < off.store_total);
  CHECK(off.composed_maps.empty());
  CHECK(!on.composed_maps.empty());
  // Rows per node never depend on sharing.
  for (std::uint32_t d = 0; d < game.tree().num_decision_nodes; ++d) {
    CHECK(on.rows(d) == off.rows(d));
  }
  // Every group's members have one shape: same actor, actions, street, pot.
  const std::vector<NodeId> nodes = node_of_decision(game.tree());
  std::size_t members = 0;
  for (std::uint32_t d = 0; d < game.tree().num_decision_nodes; ++d) {
    const Node& n = game.tree()[nodes[d]];
    const Node& rep = game.tree()[nodes[on.group_rep[on.group(d)]]];
    CHECK(n.actor == rep.actor);
    CHECK(n.num_children == rep.num_children);
    CHECK(n.street == rep.street);
    CHECK(n.pot == rep.pot);
    if (on.perm(d) != InfosetIndexer::kIdentityPerm) ++members;
  }
  CHECK(members > 0);
}

TEST_CASE("abstraction: a member node's expanded rows are the representative's relabeled") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  SampledCfrSolver solver(game, game, sampled_cfg(8, 6), config.threads);
  solver.run(4096);
  const InfosetIndexer& ix = solver.indexer();
  const std::vector<NodeId> nodes = node_of_decision(game.tree());
  const std::uint32_t H = static_cast<std::uint32_t>(game.num_hands(0));
  std::size_t checked = 0;
  for (std::uint32_t d = 0; d < game.tree().num_decision_nodes; ++d) {
    if (ix.perm(d) == InfosetIndexer::kIdentityPerm) continue;
    const std::uint32_t rd = ix.group_rep[ix.group(d)];
    const std::vector<std::uint16_t>& relabel = game.abstraction_symmetric_map(ix.perm(d));
    std::vector<float> mine, reps;
    solver.average_strategy(nodes[d], mine);
    solver.average_strategy(nodes[rd], reps);
    const int actions = game.tree()[nodes[d]].num_children;
    const std::uint8_t* valid = ix.valid(d);
    for (std::uint32_t h = 0; h < H; ++h) {
      if (!valid[h]) continue;
      for (int a = 0; a < actions; ++a) {
        CHECK(mine[h * actions + a] == reps[relabel[h] * actions + a]);
      }
    }
    if (++checked == 50) break;
  }
  CHECK(checked > 0);
}

TEST_CASE("abstraction: bitwise identical at any thread count, and chips conserve") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  auto solve = [&](int threads) {
    SampledCfrSolver solver(game, game, sampled_cfg(8, 6), threads);
    solver.run(4096);
    return std::make_pair(solver.regrets(), solver.strategy_sums());
  };
  const auto one = solve(1);
  const auto eight = solve(8);
  REQUIRE(one.first.size() == eight.first.size());
  REQUIRE(!one.first.empty());
  CHECK(std::memcmp(one.first.data(), eight.first.data(), one.first.size() * sizeof(float)) == 0);
  CHECK(std::memcmp(one.second.data(), eight.second.data(),
                    one.second.size() * sizeof(float)) == 0);

  SampledCfrSolver solver(game, game, sampled_cfg(8, 6), config.threads);
  solver.run(20000);
  const std::vector<double> ev = solver.sampled_ev(40000, 99);
  double sum = 0.0;
  for (double v : ev) sum += v;
  CHECK(sum == doctest::Approx(90.0).epsilon(1e-6));
  // A bucketed strategy is still a full per-hand strategy: the exact 3-seat
  // best response rates it, and it is a real (if coarse) strategy rather
  // than garbage - within the pot of the exact solve's value.
  const BrResult br = compute_best_response(game, solver);
  CHECK(br.nashconv() >= 0.0);
  CHECK(br.nashconv() < 90.0);
  MESSAGE("bucketed 3-way turn, 20k deals: nashconv " << br.nashconv());
}

TEST_CASE("abstraction: the histogram method clusters deterministically and honours the count") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  const SampledConfig sc = sampled_cfg(5, 4, "histogram");
  ThreadPool pool(4);
  InfosetIndexer a = InfosetIndexer::plan(game, game, sc, {}, 0);
  a.fit(game, sc, pool);
  InfosetIndexer b = InfosetIndexer::plan(game, game, sc, {}, 0);
  b.fit(game, sc, pool);
  CHECK(a.fingerprint() == b.fingerprint());
  const std::uint32_t H = static_cast<std::uint32_t>(game.num_hands(0));
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision || node.street != Street::Turn) continue;
    const std::uint16_t* map = a.map(node.decision_index);
    const std::uint8_t* valid = a.valid(node.decision_index);
    std::vector<int> used(5, 0);
    for (std::uint32_t h = 0; h < H; ++h) {
      CHECK(map[h] < 5);
      if (valid[h]) used[map[h]] = 1;
    }
    int distinct = 0;
    for (int u : used) distinct += u;
    CHECK(distinct == 5);
    break;
  }
  // Distribution-aware clustering is a different assignment from equity
  // quantiles (a seed change alone need not be: k-means can land on the same
  // partition from two starts on a problem this small).
  const SampledConfig other = sampled_cfg(5, 4, "equity");
  InfosetIndexer c = InfosetIndexer::plan(game, game, other, {}, 0);
  c.fit(game, other, pool);
  CHECK(c.fingerprint() != a.fingerprint());
}

TEST_CASE("abstraction: the memory estimate sizes the bucketed store and the sparse lanes") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  const SampledConfig sc = sampled_cfg(8, 6);
  const MemoryEstimate est = estimate_memory(game, 1, false, Precision::F32, &sc);
  const InfosetIndexer ix = InfosetIndexer::plan(game, game, sc, {}, 0);
  // Master + lanes, never more than (lanes + 1) copies and never less than
  // the master alone.
  CHECK(est.regret_strategy_bytes >= 2 * ix.store_total * sizeof(float));
  CHECK(est.regret_strategy_bytes <=
        static_cast<std::size_t>(sc.lanes + 1) * 2 * ix.store_total * sizeof(float) +
            static_cast<std::size_t>(sc.lanes) * ix.num_groups * sizeof(std::uint32_t));
  SampledConfig dense = sc;
  dense.abstraction.enabled = false;
  const MemoryEstimate plain = estimate_memory(game, 1, false, Precision::F32, &dense);
  CHECK(est.regret_strategy_bytes < plain.regret_strategy_bytes);
}

TEST_CASE("abstraction: the checkpoint refuses a different bucket map") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  const std::filesystem::path path =
      std::filesystem::temp_directory_path() / "engine_abstraction" / "ck.htck";
  std::filesystem::create_directories(path.parent_path());
  {
    SampledCfrSolver solver(game, game, sampled_cfg(8, 6), config.threads);
    solver.run(512);
    write_checkpoint(path.string(), solver, "key", CheckpointExtras{});
  }
  {
    SampledCfrSolver same(game, game, sampled_cfg(8, 6), config.threads);
    CheckpointExtras extras;
    std::string err;
    CHECK(read_checkpoint(path.string(), same, "key", extras, err));
    CHECK(same.iteration() == 512);
  }
  {
    // Same bucket counts (same store_total), different assignment.
    SampledCfrSolver other(game, game, sampled_cfg(8, 6, "histogram"), config.threads);
    CHECK(other.store_total() == SampledCfrSolver(game, game, sampled_cfg(8, 6), 1).store_total());
    CheckpointExtras extras;
    std::string err;
    CHECK_FALSE(read_checkpoint(path.string(), other, "key", extras, err));
    CHECK(err.find("bucket map") != std::string::npos);
  }
}

TEST_CASE("config: abstraction and export gating") {
  const std::string base = R"({
    "schema": 1, "game": "GAME", "board": "BOARD", "pot": 90, "chip_scale": 100,
    "players": [{"seat": "OOP", "stack": 200, "range": "AA,KK"},
                {"seat": "MID", "stack": 200, "range": "AA,KK"},
                {"seat": "BTN", "stack": 200, "range": "AA,KK"}],
    "bet_sizing": {"river": {"bets": [50], "raises": [100], "max_raises": 1}},
    "algorithm": ALGO,
    "budget": {"iterations": 100},
    "output": OUTPUT
  })";
  const auto make = [&](const std::string& name, const std::string& game, const std::string& board,
                        const std::string& algo, const std::string& output) {
    std::string body = base;
    body.replace(body.find("GAME"), 4, game);
    body.replace(body.find("BOARD"), 5, board);
    body.replace(body.find("ALGO"), 4, algo);
    body.replace(body.find("OUTPUT"), 6, output);
    return temp_file(name + ".json", body).string();
  };
  const std::string ab = R"({"family": "sampled", "sampled": {"abstraction": {"river": 20}}})";
  const std::string out = R"({"path": "out/x.hta"})";
  const SolveConfig ok = load_config(make("ok", "nlhe", "9c 5d Jc 7s 2h", ab, out));
  CHECK(ok.sampled.abstraction.enabled);
  CHECK(ok.sampled.abstraction.river == 20);
  CHECK(ok.sampled.abstraction.method == "equity");
  CHECK(ok.sampled.abstraction.board_isomorphism);
  CHECK_FALSE(ok.export_bucketed);
  const SolveConfig bucketed = load_config(
      make("bucketed", "nlhe", "9c 5d Jc 7s 2h", ab, R"({"path": "out/x.hta", "export": "bucketed"})"));
  CHECK(bucketed.export_bucketed);
  // Bucketed export without abstraction.
  CHECK_THROWS_WITH_AS(
      load_config(make("nob", "nlhe", "9c 5d Jc 7s 2h", R"({"family": "sampled"})",
                       R"({"path": "out/x.hta", "export": "bucketed"})")),
      doctest::Contains("abstraction"), std::runtime_error);
  // Abstraction needs the sampled family.
  CHECK_THROWS(load_config(make("vec", "nlhe", "9c 5d Jc 7s 2h",
                                R"({"sampled": {"abstraction": {"river": 20}}})", out)));
  // Bad method, bad counts, no buckets at all.
  CHECK_THROWS(load_config(make("method", "nlhe", "9c 5d Jc 7s 2h",
                                R"({"family": "sampled", "sampled": {"abstraction": {"river": 20, "method": "magic"}}})",
                                out)));
  CHECK_THROWS(load_config(make("count", "nlhe", "9c 5d Jc 7s 2h",
                                R"({"family": "sampled", "sampled": {"abstraction": {"river": 70000}}})",
                                out)));
  CHECK_THROWS(load_config(make("none", "nlhe", "9c 5d Jc 7s 2h",
                                R"({"family": "sampled", "sampled": {"abstraction": {"bins": 8}}})",
                                out)));
}
