#pragma once
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "io/artifact_store.hpp"

namespace engine {

struct ArtifactNodeRecord {
  std::uint32_t node_id = 0;
  std::uint32_t parent_id = 0;
  std::uint8_t kind = 0;         // 0 decision, 1 chance, 2 terminal
  std::uint8_t action_kind = 0;  // 0 root, 1 fold, 2 check/call, 3 bet, 4 deal
  std::uint8_t street = 0;
  std::uint8_t terminal_kind = 0;
  std::uint16_t actor = 0;
  std::uint16_t num_children = 0;
  std::uint32_t first_child = 0;
  std::uint16_t fold_winner = 0;
  std::int16_t dealt_card = -1;
  std::int64_t action_amount = 0;
  std::int64_t pot = 0;
  std::int32_t commit[9] = {};
};

struct ArtifactSeatData {
  std::vector<std::uint32_t> idx;  // positions into the seat's hand dictionary
  std::vector<float> reach;
  std::vector<float> ev;  // conditional per-hand EV, node-relative chips
};

struct ArtifactNodeData {
  std::uint16_t num_seats = 0;
  std::uint16_t num_actions = 0;
  std::uint16_t actor = 0;
  std::vector<ArtifactSeatData> seats;
  std::vector<float> strategy;   // actor rows [hand][action], renormalized to sum 1
  std::vector<float> action_ev;  // actor rows [hand][action]
  // Rollups (169-class, present when the flag is set): grid order documented
  // in the format spec.
  bool has_rollup = false;
  std::vector<float> rollup_weight;             // [169]
  std::vector<float> rollup_ev;                 // [169]
  std::vector<std::vector<float>> rollup_freq;  // [169][action]
};

// Reads a version-1 .hta artifact through an ArtifactStore. Bootstrap cost
// is three range reads (header, metadata, index) plus the node table and
// hand dictionaries; each node afterwards is a single range read.
class ArtifactReader {
 public:
  ArtifactReader(ArtifactStore& store, std::string path);

  std::uint32_t format_version() const { return version_; }
  std::uint32_t flags() const { return flags_; }
  const nlohmann::json& metadata() const { return metadata_; }
  const std::vector<ArtifactNodeRecord>& nodes() const { return nodes_; }
  const std::vector<std::vector<std::uint16_t>>& hand_dicts() const { return dicts_; }
  std::vector<std::uint32_t> decision_node_ids() const;

  ArtifactNodeData read_node(std::uint32_t node_id) const;

 private:
  ArtifactStore& store_;
  std::string path_;
  std::uint32_t version_ = 0;
  std::uint32_t flags_ = 0;
  nlohmann::json metadata_;
  std::vector<ArtifactNodeRecord> nodes_;
  std::vector<std::vector<std::uint16_t>> dicts_;
  std::map<std::uint32_t, std::pair<std::uint64_t, std::uint64_t>> index_;  // id -> (off, len)
};

}  // namespace engine
