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
#include "io/artifact_reader.hpp"
#include "io/artifact_store.hpp"
#include "io/artifact_writer.hpp"
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

TEST_CASE("abstraction: the bucketed export reads back as the per-hand export") {
  SolveConfig config = turn3_config();
  config.strategy_quantize_u8 = false;
  config.rollups_169 = true;
  config.raw = nlohmann::json::object();
  NlhePostflopGame game(config);
  SampledCfrSolver solver(game, game, sampled_cfg(8, 6), config.threads);
  solver.run(2048);
  SolveStats stats;
  stats.iterations = 2048;
  stats.ev_chips = {30.0, 30.0, 30.0};
  const std::filesystem::path dir = std::filesystem::temp_directory_path() / "engine_abstraction";
  std::filesystem::create_directories(dir);
  const std::string per_hand = (dir / "per_hand.hta").string();
  const std::string bucketed = (dir / "bucketed.hta").string();
  LocalStore store;
  config.export_bucketed = false;
  write_artifact(store, per_hand, game, solver, config, stats);
  config.export_bucketed = true;
  write_artifact(store, bucketed, game, solver, config, stats);
  CHECK(std::filesystem::file_size(bucketed) < std::filesystem::file_size(per_hand));

  ArtifactReader a(store, per_hand);
  ArtifactReader b(store, bucketed);
  REQUIRE_FALSE(a.bucketed());
  REQUIRE(b.bucketed());
  CHECK(a.metadata().value("per_hand_ev", false));
  CHECK_FALSE(b.metadata().value("per_hand_ev", true));
  CHECK(b.metadata().value("export", "") == "bucketed");
  CHECK(b.metadata().value("hand_abstraction", false));
  const std::vector<std::uint32_t> ids = a.decision_node_ids();
  REQUIRE(ids == b.decision_node_ids());
  std::size_t rows_checked = 0;
  for (std::uint32_t id : ids) {
    const ArtifactNodeData da = a.read_node(id);
    const ArtifactNodeData db = b.read_node(id);
    REQUIRE(da.num_seats == db.num_seats);
    REQUIRE(da.num_actions == db.num_actions);
    REQUIRE(da.actor == db.actor);
    for (int s = 0; s < da.num_seats; ++s) {
      REQUIRE(da.seats[s].idx == db.seats[s].idx);
      for (std::size_t i = 0; i < da.seats[s].idx.size(); ++i) {
        CHECK(db.seats[s].reach[i] == doctest::Approx(da.seats[s].reach[i]).epsilon(1e-5));
      }
    }
    REQUIRE(da.strategy.size() == db.strategy.size());
    for (std::size_t i = 0; i < da.strategy.size(); ++i) {
      CHECK(db.strategy[i] == doctest::Approx(da.strategy[i]).epsilon(1e-6));
      ++rows_checked;
    }
    REQUIRE(da.has_rollup);
    REQUIRE(db.has_rollup);
    for (int cls = 0; cls < 169; ++cls) {
      CHECK(db.rollup_weight[cls] == doctest::Approx(da.rollup_weight[cls]).epsilon(1e-5));
      for (int k = 0; k < da.num_actions; ++k) {
        CHECK(db.rollup_freq[cls][k] == doctest::Approx(da.rollup_freq[cls][k]).epsilon(2e-4));
      }
    }
  }
  CHECK(rows_checked > 0);
}

TEST_CASE("abstraction: the moments method, tiers and the monker preset") {
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  SampledConfig sc = sampled_cfg(6, 5, "moments");
  sc.abstraction.tiers = 3;
  InfosetIndexer ix = InfosetIndexer::plan(game, game, sc, {}, 0);
  ThreadPool pool(4);
  ix.fit(game, sc, pool);
  const PublicTree& tree = game.tree();
  bool saw_turn = false;
  for (const Node& node : tree.nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const std::uint32_t d = node.decision_index;
    if (node.street == Street::Turn) {
      saw_turn = true;
      CHECK(ix.rows(d) == 6 * 3);
      // bucket = tiers * strength + tier: every valid hand lands inside the
      // grid, and the strength part is monotone in mean equity by
      // construction (bucket_by_score keeps tie groups whole).
      const std::uint16_t* map = ix.map(d);
      const std::uint8_t* valid = ix.valid(d);
      for (std::uint32_t h = 0; h < ix.num_hands; ++h) {
        if (valid[h]) CHECK(map[h] < 18);
      }
    } else if (node.street == Street::River) {
      CHECK(ix.rows(d) == 5);
    }
  }
  CHECK(saw_turn);

  // The preset is a bundle of the same keys, and explicit keys beside it win.
  const std::string base = R"({
    "schema": 1, "game": "nlhe", "board": "9c 5d Jc 7s 2h", "pot": 90, "chip_scale": 100,
    "players": [{"seat": "OOP", "stack": 200, "range": "AA,KK"},
                {"seat": "MID", "stack": 200, "range": "AA,KK"},
                {"seat": "BTN", "stack": 200, "range": "AA,KK"}],
    "bet_sizing": {"river": {"bets": [50], "raises": [100], "max_raises": 1}},
    "algorithm": {"family": "sampled", "sampled": {"abstraction": ABS}},
    "budget": {"iterations": 100},
    "output": {"path": "out/x.hta"}
  })";
  const auto make = [&](const std::string& name, const std::string& abs) {
    std::string body = base;
    body.replace(body.find("ABS"), 3, abs);
    return temp_file(name + ".json", body).string();
  };
  const SolveConfig preset = load_config(make("preset", R"({"preset": "monker"})"));
  CHECK(preset.sampled.abstraction.method == "moments");
  CHECK(preset.sampled.abstraction.flop == 30);
  CHECK(preset.sampled.abstraction.turn == 30);
  CHECK(preset.sampled.abstraction.river == 30);
  CHECK(preset.sampled.abstraction.tiers == 4);
  CHECK(preset.sampled.abstraction.preset == "monker");
  CHECK(load_config(make("override", R"({"preset": "monker", "turn": 12})")).sampled.abstraction.turn == 12);
  CHECK_THROWS(load_config(make("tiers", R"({"method": "histogram", "turn": 8, "tiers": 2})")));
  CHECK_THROWS(load_config(make("badpreset", R"({"preset": "pio"})")));
}

TEST_CASE("abstraction: hands symmetric under the board's pointwise stabilizer share a row") {
  // The fixture's root symmetry is c<->d. On a runout card that is neither a
  // club nor a diamond the stabilizer is the whole group, and every hand
  // must share its row with its c<->d image; on a club or diamond runout
  // the stabilizer is trivial and nothing is asserted.
  const SolveConfig config = turn3_config();
  NlhePostflopGame game(config);
  REQUIRE(game.abstraction_symmetries() == 1);
  const std::vector<std::uint16_t>& relabel = game.abstraction_symmetric_map(0);
  ThreadPool pool(4);
  for (const std::string& method : {"equity", "histogram", "moments"}) {
    SampledConfig sc = sampled_cfg(7, 5, method);
    sc.abstraction.tiers = method == "moments" ? 2 : 1;
    InfosetIndexer ix = InfosetIndexer::plan(game, game, sc, {}, 0);
    ix.fit(game, sc, pool);
    std::size_t checked = 0;
    for (const InfosetIndexer::BoardMap& bm : ix.board_maps) {
      const std::uint64_t mask = bm.key & ((std::uint64_t{1} << 52) - 1);
      if (game.abstraction_symmetric_key(0, mask) != mask) continue;
      bool pointwise = true;
      for (int c = 0; c < 52; ++c) {
        if (((mask >> c) & 1) != 0 && game.abstraction_symmetric_card(0, c) != c) pointwise = false;
      }
      if (!pointwise) continue;
      const std::uint16_t* map =
          ix.map_storage.data() + static_cast<std::size_t>(bm.map_index) * ix.num_hands;
      for (std::uint32_t h = 0; h < ix.num_hands; ++h) {
        CHECK(map[h] == map[relabel[h]]);
        ++checked;
      }
    }
    MESSAGE(method << ": " << checked << " (hand, image) pairs share a row");
    CHECK(checked > 0);
  }
}
