#include <cmath>
#include <cstdint>

#include "io/dump_json.hpp"

#include "cards/combos.hpp"
#include "io/artifact_reader.hpp"

namespace engine {

namespace {

using nlohmann::json;

json node_to_json(const ArtifactNodeRecord& record, bool nlhe, int num_seats) {
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
  json commit = json::array();
  for (int s = 0; s < num_seats; ++s) commit.push_back(record.commit[s]);
  j["commit"] = std::move(commit);
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

// 7 decimals is lossless for the harness (it feeds Pio %.6f) and avoids
// the 17-digit shortest-round-trip text an f32 widened to double produces.
double round7(float v) { return std::round(static_cast<double>(v) * 1e7) / 1e7; }

json node_data_to_json(const ArtifactReader& reader, const ArtifactNodeData& data,
                       bool nlhe, DumpFields fields, bool is_root) {
  const bool trimmed = fields != DumpFields::kFull;
  const bool with_ev = fields != DumpFields::kGate;
  const auto& dicts = reader.hand_dicts();
  json j;
  j["actor"] = data.actor;
  j["num_actions"] = data.num_actions;
  json seats = json::array();
  for (int s = 0; s < data.num_seats; ++s) {
    const ArtifactSeatData& seat = data.seats[s];
    json hands = json::array();
    // Trimmed dumps keep the actor's hands everywhere and both seats' at
    // the root (root reaches feed Pio's set_range); other seats stay as
    // empty arrays so seats[actor] indexing is shape-stable. A rollup dump
    // emits NO per-hand rows at all - the chart is the rollup.
    const bool emit_seat =
        fields != DumpFields::kRollup && (!trimmed || is_root || s == data.actor);
    if (emit_seat) {
      // Non-actor seats never carry EVs in a trimmed dump: only the root's
      // reaches are wanted there, and the actor's row is what the per-hand
      // comparison reads.
      const bool seat_ev = with_ev && (!trimmed || s == data.actor);
      for (std::size_t i = 0; i < seat.idx.size(); ++i) {
        const std::uint16_t universe_id = dicts[s][seat.idx[i]];
        json h;
        h["hand"] = nlhe ? json(combo_to_string(universe_id)) : json(universe_id);
        h["reach"] = trimmed ? json(round7(seat.reach[i])) : json(seat.reach[i]);
        if (seat_ev) h["ev"] = trimmed ? json(round7(seat.ev[i])) : json(seat.ev[i]);
        if (s == data.actor) {
          json strat = json::array();
          json aev = json::array();
          for (int k = 0; k < data.num_actions; ++k) {
            const float f = data.strategy[i * data.num_actions + k];
            const float e = data.action_ev[i * data.num_actions + k];
            strat.push_back(trimmed ? json(round7(f)) : json(f));
            if (with_ev) aev.push_back(trimmed ? json(round7(e)) : json(e));
          }
          h["strategy"] = std::move(strat);
          if (with_ev) h["action_ev"] = std::move(aev);
        }
        hands.push_back(std::move(h));
      }
    }
    seats.push_back({{"seat", s}, {"hands", std::move(hands)}});
  }
  j["seats"] = std::move(seats);
  if (data.has_rollup && (!trimmed || fields == DumpFields::kRollup)) {
    // Per-ACTION class EVs, folded from the actor's per-hand rows with the
    // same reach weighting the artifact's own rollup used (artifact_writer),
    // so a chart's tooltip can say what jamming is worth against folding
    // instead of quoting one class EV for both. Derived here rather than
    // stored: the format carries one EV per class, and everything needed is
    // already in the node.
    const int actions = data.num_actions;
    std::vector<double> aev_weight(169, 0.0);
    std::vector<std::vector<double>> aev_sum(169, std::vector<double>(static_cast<std::size_t>(actions), 0.0));
    if (nlhe && data.actor < data.num_seats) {
      const ArtifactSeatData& actor_seat = data.seats[data.actor];
      for (std::size_t i = 0; i < actor_seat.idx.size(); ++i) {
        const int cls = combo_class_index(dicts[data.actor][actor_seat.idx[i]]);
        const double w = actor_seat.reach[i];
        aev_weight[static_cast<std::size_t>(cls)] += w;
        for (int k = 0; k < actions; ++k) {
          aev_sum[static_cast<std::size_t>(cls)][static_cast<std::size_t>(k)] +=
              w * data.action_ev[i * static_cast<std::size_t>(actions) + static_cast<std::size_t>(k)];
        }
      }
    }
    json rollup = json::array();
    for (int cls = 0; cls < 169; ++cls) {
      if (data.rollup_weight[cls] <= 0.0f) continue;
      json r;
      r["class"] = class_name(cls);
      r["weight"] = data.rollup_weight[cls];
      r["ev"] = data.rollup_ev[cls];
      r["freq"] = data.rollup_freq[cls];
      if (nlhe) {
        json a = json::array();
        const double w = aev_weight[static_cast<std::size_t>(cls)];
        for (int k = 0; k < actions; ++k) {
          const double v = aev_sum[static_cast<std::size_t>(cls)][static_cast<std::size_t>(k)];
          a.push_back(w > 0.0 ? round7(static_cast<float>(v / w)) : 0.0);
        }
        r["action_ev"] = std::move(a);
      }
      rollup.push_back(std::move(r));
    }
    j["rollup_169"] = std::move(rollup);
  }
  return j;
}

}  // namespace

json dump_artifact_json(ArtifactStore& store, const std::string& path,
                        std::optional<std::uint32_t> only_node,
                        std::optional<int> runouts, DumpFields fields) {
  ArtifactReader reader(store, path);
  const bool nlhe = reader.metadata().value("hand_universe", "") == "nlhe_combos_1326";
  // The node record carries commit for all kMaxSeats; only the first
  // num_seats of them are meaningful, and the seat labels are the only place
  // the count is recorded outside the per-node blobs.
  const int num_seats = static_cast<int>(reader.hand_dicts().size());
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

  const bool trimmed = fields != DumpFields::kFull;
  json out;
  out["metadata"] = reader.metadata();
  if (runouts) out["metadata"]["dump_runouts"] = *runouts;
  if (fields == DumpFields::kDetail) out["metadata"]["dump_fields"] = "detail";
  if (fields == DumpFields::kGate) out["metadata"]["dump_fields"] = "gate";
  if (fields == DumpFields::kRollup) out["metadata"]["dump_fields"] = "rollup";
  if (!trimmed) {
    json dicts = json::array();
    for (const auto& dict : reader.hand_dicts()) {
      json hands = json::array();
      for (std::uint16_t id : dict) hands.push_back(nlhe ? json(combo_to_string(id)) : json(id));
      dicts.push_back(std::move(hands));
    }
    out["hand_dicts"] = std::move(dicts);
  }

  json nodes = json::object();
  for (const ArtifactNodeRecord& record : records) {
    if (only_node && record.node_id != *only_node) continue;
    if (!include[record.node_id]) continue;
    json j = node_to_json(record, nlhe, num_seats);
    if (record.kind == 0) {
      j["data"] = node_data_to_json(reader, reader.read_node(record.node_id), nlhe,
                                    fields, record.node_id == 0);
    }
    nodes[std::to_string(record.node_id)] = std::move(j);
  }
  out["nodes"] = std::move(nodes);
  return out;
}

}  // namespace engine
