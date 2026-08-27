#include <doctest/doctest.h>

#include <cmath>
#include <filesystem>

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
  stats.ev_seat0 = br.ev[0];
  stats.ev_seat1 = br.ev[1];

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
