#include "io/dump_json.hpp"

#include "cards/combos.hpp"
#include "io/artifact_reader.hpp"

namespace engine {

namespace {

using nlohmann::json;

json node_to_json(const ArtifactNodeRecord& record, bool nlhe) {
  static const char* kKinds[] = {"decision", "chance", "terminal"};
  static const char* kActions[] = {"root", "fold", "check_call", "bet", "deal"};
  json j;
  j["node_id"] = record.node_id;
  j["parent_id"] = record.parent_id == 0xFFFFFFFFu ? json(nullptr) : json(record.parent_id);
  j["kind"] = kKinds[record.kind];
  j["action_kind"] = kActions[record.action_kind];
  j["action_amount"] = record.action_amount;
  j["pot"] = record.pot;
  j["actor"] = record.actor == 0xFFFF ? json(nullptr) : json(record.actor);
  j["num_children"] = record.num_children;
  j["first_child"] = record.first_child == 0xFFFFFFFFu ? json(nullptr) : json(record.first_child);
  j["commit"] = {record.commit[0], record.commit[1]};
  if (record.kind == 2) {
    j["terminal"] = record.terminal_kind == 1 ? "fold" : "showdown";
    if (record.terminal_kind == 1) j["fold_winner"] = record.fold_winner;
  }
  if (record.dealt_card >= 0) {
    j["dealt_card"] = nlhe ? json(card_to_string(static_cast<Card>(record.dealt_card)))
                           : json(record.dealt_card);
  }
  return j;
}

json node_data_to_json(const ArtifactReader& reader, const ArtifactNodeData& data,
                       bool nlhe) {
  const auto& dicts = reader.hand_dicts();
  json j;
  j["actor"] = data.actor;
  j["num_actions"] = data.num_actions;
  json seats = json::array();
  for (int s = 0; s < data.num_seats; ++s) {
    const ArtifactSeatData& seat = data.seats[s];
    json hands = json::array();
    for (std::size_t i = 0; i < seat.idx.size(); ++i) {
      const std::uint16_t universe_id = dicts[s][seat.idx[i]];
      json h;
      h["hand"] = nlhe ? json(combo_to_string(universe_id)) : json(universe_id);
      h["reach"] = seat.reach[i];
      h["ev"] = seat.ev[i];
      if (s == data.actor) {
        json strat = json::array();
        json aev = json::array();
        for (int k = 0; k < data.num_actions; ++k) {
          strat.push_back(data.strategy[i * data.num_actions + k]);
          aev.push_back(data.action_ev[i * data.num_actions + k]);
        }
        h["strategy"] = strat;
        h["action_ev"] = aev;
      }
      hands.push_back(std::move(h));
    }
    seats.push_back({{"seat", s}, {"hands", std::move(hands)}});
  }
  j["seats"] = std::move(seats);
  if (data.has_rollup) {
    json rollup = json::array();
    for (int cls = 0; cls < 169; ++cls) {
      if (data.rollup_weight[cls] <= 0.0f) continue;
      json r;
      r["class"] = class_name(cls);
      r["weight"] = data.rollup_weight[cls];
      r["ev"] = data.rollup_ev[cls];
      r["freq"] = data.rollup_freq[cls];
      rollup.push_back(std::move(r));
    }
    j["rollup_169"] = std::move(rollup);
  }
  return j;
}

}  // namespace

json dump_artifact_json(ArtifactStore& store, const std::string& path,
                        std::optional<std::uint32_t> only_node,
                        std::optional<int> runouts) {
  ArtifactReader reader(store, path);
  const bool nlhe = reader.metadata().value("hand_universe", "") == "nlhe_combos_1326";
  const auto& records = reader.nodes();

  // Top-down include set: betting children always follow; chance-node
  // fan-out capped at `runouts` evenly spaced cards. Records are appended
  // children-after-parents, so one forward pass settles every node.
  std::vector<bool> include(records.size(), !runouts.has_value());
  if (runouts) {
    include[0] = true;
    for (std::size_t i = 0; i < records.size(); ++i) {
      if (!include[i]) continue;
      const ArtifactNodeRecord& record = records[i];
      if (record.first_child != 0xFFFFFFFFu && record.num_children > 0) {
        const std::uint32_t first = record.first_child;
        const std::uint16_t count = record.num_children;
        if (record.kind == 1 && count > *runouts) {  // chance node
          const double step = static_cast<double>(count) / *runouts;
          for (int k = 0; k < *runouts; ++k) {
            include[first + static_cast<std::uint32_t>(k * step)] = true;
          }
        } else {
          for (std::uint16_t c = 0; c < count; ++c) include[first + c] = true;
        }
      }
    }
  }

  json out;
  out["metadata"] = reader.metadata();
  if (runouts) out["metadata"]["dump_runouts"] = *runouts;
  json dicts = json::array();
  for (const auto& dict : reader.hand_dicts()) {
    json hands = json::array();
    for (std::uint16_t id : dict) hands.push_back(nlhe ? json(combo_to_string(id)) : json(id));
    dicts.push_back(std::move(hands));
  }
  out["hand_dicts"] = std::move(dicts);

  json nodes = json::object();
  for (const ArtifactNodeRecord& record : records) {
    if (only_node && record.node_id != *only_node) continue;
    if (!include[record.node_id]) continue;
    json j = node_to_json(record, nlhe);
    if (record.kind == 0) {
      j["data"] = node_data_to_json(reader, reader.read_node(record.node_id), nlhe);
    }
    nodes[std::to_string(record.node_id)] = std::move(j);
  }
  out["nodes"] = std::move(nodes);
  return out;
}

}  // namespace engine
