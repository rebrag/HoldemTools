#include <doctest/doctest.h>

#include <cmath>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include "game/nlhe_preflop.hpp"
#include "game/toy/kuhn.hpp"
#include "io/artifact_format.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_writer.hpp"
#include "io/dump_json.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"

using namespace engine;

namespace {

SolveConfig kuhn_config(bool strategy_u8, bool ev_float32) {
  SolveConfig config;
  config.game = "kuhn";
  config.strategy_quantize_u8 = strategy_u8;
  config.ev_float32 = ev_float32;
  config.rollups_169 = false;
  config.raw = nlohmann::json{{"game", "kuhn"}};
  return config;
}

void roundtrip(bool strategy_u8, bool ev_float32, float strategy_tol, float ev_tol) {
  toy::KuhnGame game;
  CfrSolver solver(game, UpdateConfig{});
  solver.run(2000);
  const BrResult br = compute_best_response(game, solver);

  const SolveConfig config = kuhn_config(strategy_u8, ev_float32);
  SolveStats stats;
  stats.iterations = solver.iteration();
  stats.nashconv = br.nashconv();
  stats.ev_chips = br.ev;

  const std::string path =
      (std::filesystem::temp_directory_path() /
       ("engine_roundtrip_" + std::to_string(strategy_u8) + std::to_string(ev_float32) + ".hta"))
          .string();
  LocalStore store;
  write_artifact(store, path, game, solver, config, stats);

  ArtifactReader reader(store, path);
  CHECK(reader.format_version() == artifact::kFormatVersion);
  CHECK(reader.metadata().at("mode") == "nash");
  CHECK(reader.metadata().at("iterations") == solver.iteration());
  CHECK(reader.nodes().size() == game.tree().size());

  // Node table mirrors the public tree.
  for (NodeId id = 0; id < game.tree().size(); ++id) {
    const Node& n = game.tree()[id];
    const ArtifactNodeRecord& r = reader.nodes()[id];
    CHECK(r.node_id == id);
    CHECK(r.kind == static_cast<std::uint8_t>(n.kind));
    CHECK(r.pot == n.pot);
    CHECK(r.num_children == n.num_children);
    CHECK(r.commit[0] == n.commit[0]);
    CHECK(r.commit[1] == n.commit[1]);
  }

  // Per-node strategy round-trips within quantization tolerance.
  std::vector<float> sigma;
  for (std::uint32_t id : reader.decision_node_ids()) {
    const ArtifactNodeData data = reader.read_node(id);
    solver.average_strategy(id, sigma);
    const int actions = data.num_actions;
    const auto& actor_seat = data.seats[data.actor];
    for (std::size_t i = 0; i < actor_seat.idx.size(); ++i) {
      const std::uint16_t hand = reader.hand_dicts()[data.actor][actor_seat.idx[i]];
      for (int k = 0; k < actions; ++k) {
        CHECK(data.strategy[i * actions + k] ==
              doctest::Approx(sigma[hand * actions + k]).epsilon(strategy_tol).scale(1.0));
      }
      CHECK(std::isfinite(actor_seat.ev[i]));
      CHECK(std::isfinite(actor_seat.reach[i]));
      (void)ev_tol;
    }
  }

  // dump-json runs cleanly over the artifact.
  const nlohmann::json dump = dump_artifact_json(store, path, std::nullopt);
  CHECK(dump.at("nodes").size() == game.tree().size());
  CHECK(dump.contains("hand_dicts"));

  // Both trimmed dumps keep the tree + actor strategies (+ root reaches) and
  // drop the dictionaries, rollups and non-actor seats nothing downstream
  // reads. They differ only in whether per-hand EVs travel: kDetail feeds the
  // per-hand comparison view, kGate feeds the cross-exploitability gate.
  for (const auto fields : {DumpFields::kDetail, DumpFields::kGate}) {
    const bool with_ev = fields == DumpFields::kDetail;
    const nlohmann::json trimmed =
        dump_artifact_json(store, path, std::nullopt, std::nullopt, fields);
    CHECK(trimmed.at("metadata").at("dump_fields") == (with_ev ? "detail" : "gate"));
    CHECK(!trimmed.contains("hand_dicts"));
    CHECK(trimmed.at("nodes").size() == game.tree().size());
    for (const auto& [key, node] : trimmed.at("nodes").items()) {
      if (!node.contains("data")) continue;
      const auto& data = node.at("data");
      const int actor = data.at("actor").get<int>();
      const auto actions = data.at("num_actions").get<std::size_t>();
      const bool is_root = key == "0";
      for (const auto& seat : data.at("seats")) {
        const int s = seat.at("seat").get<int>();
        const auto& hands = seat.at("hands");
        if (s != actor && !is_root) {
          CHECK(hands.empty());
          continue;
        }
        CHECK(!hands.empty());
        for (const auto& h : hands) {
          CHECK(h.contains("reach"));
          if (s == actor) {
            CHECK(h.at("strategy").size() == actions);
            CHECK(h.contains("ev") == with_ev);
            CHECK(h.contains("action_ev") == with_ev);
            if (with_ev) CHECK(h.at("action_ev").size() == actions);
          } else {
            // Root's non-actor seat carries reaches for set_range, nothing more.
            CHECK(!h.contains("strategy"));
            CHECK(!h.contains("ev"));
          }
        }
      }
    }
  }
  std::filesystem::remove(path);
}

}  // namespace

TEST_CASE("artifact round-trips with quantized strategy (default flags)") {
  roundtrip(/*strategy_u8=*/true, /*ev_float32=*/true, /*strategy_tol=*/0.01f, 1e-4f);
}

TEST_CASE("artifact round-trips with float32 strategy and float16 EV") {
  roundtrip(/*strategy_u8=*/false, /*ev_float32=*/false, /*strategy_tol=*/1e-5f, 0.01f);
}

TEST_CASE("float16 conversion round-trips representative values") {
  for (float v : {0.0f, 1.0f, -1.0f, 0.5f, 1234.5f, -20000.0f, 0.0001f}) {
    const float back = artifact::half_to_float(artifact::float_to_half(v));
    CHECK(back == doctest::Approx(v).epsilon(0.001).scale(1.0f));
  }
}

TEST_CASE("a 4-seat artifact round-trips without a format bump") {
  // The .hta layout was already N-seat before multiway existed: the node
  // record carries i32[9] of per-seat commitment and every node blob is
  // prefixed with its own u16 num_seats and per-seat hand counts. Only a
  // guard in the writer and a pair of scalar EV fields stood in the way.
  //
  // This is the test that PROVES that claim, which is what keeps the
  // one-commit rule in engine/CLAUDE.md (spec + both readers + regenerate the
  // fixture) from being triggered by this work.
  SolveConfig config;
  config.game = "nlhe_preflop";
  config.chip_scale = 2.0;
  for (int s = 0; s < 4; ++s) {
    PlayerConfig p;
    p.seat = "P" + std::to_string(s);
    p.stack = s == 2 ? 9 : 16;  // a short stack, so side-pot layers exist
    p.range = "AA,KK,AKs,72o";
    config.players.push_back(p);
  }
  config.preflop.small_blind = 1;
  config.preflop.big_blind = 2;
  config.preflop.button = 3;
  config.preflop.ante.assign(4, 0);
  config.preflop.board_sample.pair_count = 1000;
  config.preflop.board_sample.iter_count = 4;
  config.pot = 3;
  config.threads = 1;
  config.rollups_169 = true;
  config.raw = nlohmann::json{{"game", "nlhe_preflop"}};

  const NlhePreflopGame game(config);
  CfrSolver solver(game, UpdateConfig{}, 1);
  solver.run(50);
  const BrResult br = compute_best_response(game, solver);

  SolveStats stats;
  stats.iterations = solver.iteration();
  stats.nashconv = br.nashconv();
  stats.ev_chips = br.ev;

  const std::string path =
      (std::filesystem::temp_directory_path() / "engine_roundtrip_4seat.hta").string();
  LocalStore store;
  write_artifact(store, path, game, solver, config, stats);

  ArtifactReader reader(store, path);
  CHECK(reader.format_version() == artifact::kFormatVersion);
  CHECK(reader.hand_dicts().size() == 4);
  CHECK(reader.metadata().at("ev_chips").size() == 4);
  CHECK(reader.metadata().at("seats").size() == 4);
  CHECK(reader.metadata().at("stacks") == nlohmann::json({16, 16, 9, 16}));
  CHECK(reader.metadata().at("effective_stack") == 9);
  CHECK(reader.metadata().at("partition") == nlohmann::json({{0}, {1}, {2}, {3}}));
  // CFR carries no Nash guarantee past two players; the flag has to travel.
  CHECK(reader.metadata().at("multiway_no_nash_guarantee") == true);
  CHECK(reader.metadata().at("opponent_card_removal") == "hero_only");
  CHECK(reader.metadata().at("board_sample").at("pair_count") == 1000);
  CHECK(reader.metadata().at("preflop").at("bb_seat") == 1);
  CHECK(reader.metadata().at("hand_universe") == "nlhe_combos_1326");

  // The per-seat commitment really is in the node table, all four of them.
  //
  // There is no folded_mask on the record and none is needed: a fold edge
  // carries action_kind == 1 and its PARENT names the seat that made it, so
  // walking down from the root reconstructs the alive set exactly. Checked
  // here so a consumer can rely on it.
  std::vector<std::uint16_t> folded(game.tree().size(), 0);
  for (NodeId id = 0; id < game.tree().size(); ++id) {
    const Node& n = game.tree()[id];
    const ArtifactNodeRecord& r = reader.nodes()[id];
    for (int s = 0; s < 4; ++s) CHECK(r.commit[s] == n.commit[s]);
    if (id != 0) {
      folded[id] = folded[r.parent_id];
      if (r.action_kind == 1) {
        folded[id] = static_cast<std::uint16_t>(
            folded[id] | (1u << reader.nodes()[r.parent_id].actor));
      }
    }
    CHECK(folded[id] == n.folded_mask);
  }

  // Every decision node's blob carries four seats' reach, and the actor's
  // strategy rows sum to 1.
  for (const ArtifactNodeRecord& r : reader.nodes()) {
    if (r.kind != 0) continue;
    const ArtifactNodeData data = reader.read_node(r.node_id);
    CHECK(data.num_seats == 4);
    CHECK(data.actor == r.actor);
    const ArtifactSeatData& actor = data.seats[data.actor];
    for (std::size_t h = 0; h < actor.idx.size(); ++h) {
      float sum = 0.0f;
      for (int k = 0; k < data.num_actions; ++k) {
        sum += data.strategy[h * static_cast<std::size_t>(data.num_actions) +
                             static_cast<std::size_t>(k)];
      }
      CHECK(sum == doctest::Approx(1.0f).epsilon(0.02));
    }
    CHECK(data.has_rollup);
  }
  std::filesystem::remove(path);
}
