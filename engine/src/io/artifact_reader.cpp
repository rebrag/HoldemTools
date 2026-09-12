#include "io/artifact_reader.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <stdexcept>

#include "cards/combos.hpp"
#include "io/artifact_format.hpp"

namespace engine {

namespace {
// Bounded memo: a per-hand reach vector per seat is a few KB, and a dump
// walks node ids in order, so the ancestors of consecutive nodes overlap
// almost entirely. Past the cap the whole cache is dropped - crude, and
// enough.
constexpr std::size_t kCacheEntries = 4096;
}  // namespace

namespace fmt = engine::artifact;

ArtifactReader::ArtifactReader(ArtifactStore& store, std::string path)
    : store_(store), path_(std::move(path)) {
  const auto header = store_.read_range(path_, 0, fmt::kHeaderSize);
  if (std::memcmp(header.data(), fmt::kMagic, sizeof(fmt::kMagic)) != 0) {
    throw std::runtime_error("not an engine artifact (bad magic): " + path_);
  }
  version_ = fmt::get<std::uint32_t>(header.data() + 8);
  if (version_ != fmt::kFormatVersion) {
    throw std::runtime_error("unsupported artifact format version " + std::to_string(version_));
  }
  flags_ = fmt::get<std::uint32_t>(header.data() + 16);
  const auto meta_off = fmt::get<std::uint64_t>(header.data() + 24);
  const auto meta_len = fmt::get<std::uint64_t>(header.data() + 32);
  const auto index_off = fmt::get<std::uint64_t>(header.data() + 40);
  const auto index_len = fmt::get<std::uint64_t>(header.data() + 48);

  const auto meta_bytes = store_.read_range(path_, meta_off, meta_len);
  metadata_ = nlohmann::json::parse(meta_bytes.begin(), meta_bytes.end());

  const auto& table = metadata_.at("sections").at("node_table");
  const auto table_off = table.at("offset").get<std::uint64_t>();
  const auto record_size = table.at("record_size").get<std::uint32_t>();
  const auto count = table.at("count").get<std::uint64_t>();
  if (record_size != fmt::kNodeRecordSize) {
    throw std::runtime_error("unexpected node record size " + std::to_string(record_size));
  }
  const auto records = store_.read_range(path_, table_off, count * record_size);
  nodes_.resize(count);
  for (std::uint64_t i = 0; i < count; ++i) {
    const std::uint8_t* r = records.data() + i * record_size;
    ArtifactNodeRecord& n = nodes_[i];
    n.node_id = fmt::get<std::uint32_t>(r);
    n.parent_id = fmt::get<std::uint32_t>(r + 4);
    n.kind = r[8];
    n.action_kind = r[9];
    n.street = r[10];
    n.terminal_kind = r[11];
    n.actor = fmt::get<std::uint16_t>(r + 12);
    n.num_children = fmt::get<std::uint16_t>(r + 14);
    n.first_child = fmt::get<std::uint32_t>(r + 16);
    n.fold_winner = fmt::get<std::uint16_t>(r + 20);
    n.dealt_card = fmt::get<std::int16_t>(r + 22);
    n.action_amount = fmt::get<std::int64_t>(r + 24);
    n.pot = fmt::get<std::int64_t>(r + 32);
    for (int s = 0; s < 9; ++s) n.commit[s] = fmt::get<std::int32_t>(r + 40 + s * 4);
  }

  for (const auto& dict : metadata_.at("sections").at("hand_dicts")) {
    const auto off = dict.at("offset").get<std::uint64_t>();
    const auto len = dict.at("length").get<std::uint64_t>();
    const auto bytes = store_.read_range(path_, off, len);
    const auto n = fmt::get<std::uint32_t>(bytes.data());
    std::vector<std::uint16_t> ids(n);
    for (std::uint32_t i = 0; i < n; ++i) {
      ids[i] = fmt::get<std::uint16_t>(bytes.data() + 4 + i * 2);
    }
    dicts_.push_back(std::move(ids));
  }

  const auto index_bytes = store_.read_range(path_, index_off, index_len);
  const std::uint64_t entries = index_len / fmt::kIndexEntrySize;
  for (std::uint64_t i = 0; i < entries; ++i) {
    const std::uint8_t* e = index_bytes.data() + i * fmt::kIndexEntrySize;
    const auto id = fmt::get<std::uint32_t>(e);
    const auto off = fmt::get<std::uint64_t>(e + 8);
    const auto len = fmt::get<std::uint64_t>(e + 16);
    index_[id] = {off, len};
  }

  nlhe_ = metadata_.value("hand_universe", "") == "nlhe_combos_1326";
  bucketed_ = (flags_ & fmt::kFlagBucketed) != 0;
  if (bucketed_) {
    // Decision indices are dense in node order, which is how the writer
    // laid out the per-node entries of the bucket map.
    decision_index_.assign(nodes_.size(), 0xFFFFFFFFu);
    std::uint32_t d = 0;
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
      if (nodes_[i].kind == 0) decision_index_[i] = d++;
    }
    const auto& bm = metadata_.at("sections").at("bucket_map");
    const auto bytes = store_.read_range(path_, bm.at("offset").get<std::uint64_t>(),
                                         bm.at("length").get<std::uint64_t>());
    const std::uint8_t* p = bytes.data();
    const auto num_maps = fmt::get<std::uint32_t>(p);
    map_hands_ = fmt::get<std::uint32_t>(p + 4);
    p += 8;
    maps_.resize(static_cast<std::size_t>(num_maps) * map_hands_);
    for (std::size_t i = 0; i < maps_.size(); ++i, p += 2) maps_[i] = fmt::get<std::uint16_t>(p);
    const auto num_groups = fmt::get<std::uint32_t>(p);
    p += 4;
    group_rows_.resize(num_groups);
    for (std::uint32_t g = 0; g < num_groups; ++g, p += 4) group_rows_[g] = fmt::get<std::uint32_t>(p);
    const auto decisions = fmt::get<std::uint32_t>(p);
    p += 4;
    if (decisions != d) throw std::runtime_error("bucket map does not match the node table");
    node_group_.resize(decisions);
    node_map_.resize(decisions);
    for (std::uint32_t i = 0; i < decisions; ++i, p += 8) {
      node_group_[i] = fmt::get<std::uint32_t>(p);
      node_map_[i] = fmt::get<std::uint32_t>(p + 4);
    }
    const auto& rr = metadata_.at("sections").at("root_reach");
    const auto rbytes = store_.read_range(path_, rr.at("offset").get<std::uint64_t>(),
                                          rr.at("length").get<std::uint64_t>());
    const std::uint8_t* q = rbytes.data();
    const auto seats = fmt::get<std::uint32_t>(q);
    const auto hands = fmt::get<std::uint32_t>(q + 4);
    q += 8;
    root_reach_.assign(seats, std::vector<float>(hands));
    for (std::uint32_t s = 0; s < seats; ++s) {
      for (std::uint32_t h = 0; h < hands; ++h, q += 4) root_reach_[s][h] = fmt::get<float>(q);
    }
  }
}

std::vector<std::uint32_t> ArtifactReader::decision_node_ids() const {
  std::vector<std::uint32_t> ids;
  if (bucketed_) {
    for (const ArtifactNodeRecord& n : nodes_) {
      if (n.kind == 0) ids.push_back(n.node_id);
    }
    return ids;
  }
  ids.reserve(index_.size());
  for (const auto& [id, range] : index_) ids.push_back(id);
  return ids;
}

const std::vector<float>& ArtifactReader::dense_strategy(std::uint32_t node_id) const {
  if (auto it = strategy_cache_.find(node_id); it != strategy_cache_.end()) return it->second;
  if (strategy_cache_.size() >= kCacheEntries) strategy_cache_.clear();
  const std::uint32_t d = decision_index_.at(node_id);
  if (d == 0xFFFFFFFFu) throw std::runtime_error("node " + std::to_string(node_id) + " is not a decision node");
  const std::uint32_t group = node_group_[d];
  const auto it = index_.find(group);
  if (it == index_.end()) throw std::runtime_error("bucketed artifact: missing group blob");
  const auto blob = store_.read_range(path_, it->second.first, it->second.second);
  const std::uint8_t* p = blob.data();
  const auto num_actions = fmt::get<std::uint16_t>(p + 2);
  const auto rows = fmt::get<std::uint32_t>(p + 8);
  p += 12;
  const bool strategy_u8 = flags_ & fmt::kFlagStrategyU8;
  std::vector<float> row_strategy(static_cast<std::size_t>(rows) * num_actions);
  for (std::uint32_t r = 0; r < rows; ++r) {
    float* row = row_strategy.data() + static_cast<std::size_t>(r) * num_actions;
    float sum = 0.0f;
    for (int k = 0; k < num_actions; ++k) {
      if (strategy_u8) {
        row[k] = static_cast<float>(*p) / 255.0f;
        p += 1;
      } else {
        row[k] = fmt::get<float>(p);
        p += 4;
      }
      sum += row[k];
    }
    if (sum > 0.0f) {
      for (int k = 0; k < num_actions; ++k) row[k] /= sum;
    } else {
      for (int k = 0; k < num_actions; ++k) row[k] = 1.0f / num_actions;
    }
  }
  const std::uint16_t* map = maps_.data() + static_cast<std::size_t>(node_map_[d]) * map_hands_;
  std::vector<float> dense(static_cast<std::size_t>(map_hands_) * num_actions);
  for (std::uint32_t h = 0; h < map_hands_; ++h) {
    const float* src = row_strategy.data() + static_cast<std::size_t>(map[h]) * num_actions;
    std::copy(src, src + num_actions, dense.data() + static_cast<std::size_t>(h) * num_actions);
  }
  return strategy_cache_.emplace(node_id, std::move(dense)).first->second;
}

const std::vector<std::vector<float>>& ArtifactReader::reach_at(std::uint32_t node_id) const {
  if (auto it = reach_cache_.find(node_id); it != reach_cache_.end()) return it->second;
  if (node_id == 0) return root_reach_;
  const ArtifactNodeRecord& node = nodes_.at(node_id);
  const std::uint32_t parent_id = node.parent_id;
  std::vector<std::vector<float>> reach = reach_at(parent_id);  // copy
  const ArtifactNodeRecord& parent = nodes_[parent_id];
  if (parent.kind == 1) {
    // Chance edge: hands holding the dealt card cannot be here.
    const int card = node.dealt_card;
    for (std::size_t s = 0; s < reach.size(); ++s) {
      const std::vector<std::uint16_t>& dict = dicts_[s];
      for (std::size_t h = 0; h < reach[s].size(); ++h) {
        if (nlhe_) {
          const Combo& c = canonical_combos()[dict[h]];
          if (c.hi == card || c.lo == card) reach[s][h] = 0.0f;
        } else if (static_cast<int>(dict[h]) == card) {
          reach[s][h] = 0.0f;
        }
      }
    }
  } else if (parent.kind == 0) {
    const std::vector<float>& sigma = dense_strategy(parent_id);
    const int k = static_cast<int>(node_id - parent.first_child);
    const int actions = parent.num_children;
    std::vector<float>& mine = reach[parent.actor];
    for (std::size_t h = 0; h < mine.size(); ++h) {
      mine[h] *= sigma[h * static_cast<std::size_t>(actions) + static_cast<std::size_t>(k)];
    }
  }
  if (reach_cache_.size() >= kCacheEntries) reach_cache_.clear();
  return reach_cache_.emplace(node_id, std::move(reach)).first->second;
}

ArtifactNodeData ArtifactReader::read_bucketed_node(std::uint32_t node_id) const {
  const ArtifactNodeRecord& node = nodes_.at(node_id);
  if (node.kind != 0) {
    throw std::runtime_error("node " + std::to_string(node_id) + " has no blob (not a decision node?)");
  }
  const std::vector<std::vector<float>> reach = reach_at(node_id);
  const std::vector<float> dense = dense_strategy(node_id);
  ArtifactNodeData data;
  data.num_seats = static_cast<std::uint16_t>(reach.size());
  data.num_actions = node.num_children;
  data.actor = node.actor;
  data.seats.resize(data.num_seats);
  for (int s = 0; s < data.num_seats; ++s) {
    ArtifactSeatData& seat = data.seats[s];
    for (std::uint32_t h = 0; h < reach[s].size(); ++h) {
      if (reach[s][h] > fmt::kSparseEps) {
        seat.idx.push_back(h);
        seat.reach.push_back(reach[s][h]);
        seat.ev.push_back(0.0f);
      }
    }
  }
  const ArtifactSeatData& actor_seat = data.seats[data.actor];
  const std::size_t cells = actor_seat.idx.size() * data.num_actions;
  data.strategy.resize(cells);
  data.action_ev.assign(cells, 0.0f);
  for (std::size_t i = 0; i < actor_seat.idx.size(); ++i) {
    const float* src = dense.data() + static_cast<std::size_t>(actor_seat.idx[i]) * data.num_actions;
    std::copy(src, src + data.num_actions, data.strategy.data() + i * data.num_actions);
  }
  if (nlhe_) {
    // The writer's rollup rule, recomputed: reach-weighted class frequency,
    // plain mean for a weightless class, class EV 0 (no EVs in the file).
    data.has_rollup = true;
    data.rollup_weight.assign(169, 0.0f);
    data.rollup_ev.assign(169, 0.0f);
    data.rollup_freq.assign(169, std::vector<float>(data.num_actions, 0.0f));
    std::vector<double> weight(169, 0.0);
    std::vector<std::vector<double>> freq_sum(169, std::vector<double>(data.num_actions, 0.0));
    std::vector<std::vector<double>> freq_plain(169, std::vector<double>(data.num_actions, 0.0));
    std::vector<int> plain_count(169, 0);
    const std::vector<std::uint16_t>& dict = dicts_[data.actor];
    for (std::uint32_t h = 0; h < reach[data.actor].size(); ++h) {
      const int cls = combo_class_index(dict[h]);
      const double w = reach[data.actor][h];
      ++plain_count[cls];
      weight[cls] += w;
      for (int k = 0; k < data.num_actions; ++k) {
        const double p = dense[static_cast<std::size_t>(h) * data.num_actions + static_cast<std::size_t>(k)];
        freq_sum[cls][k] += w * p;
        freq_plain[cls][k] += p;
      }
    }
    for (int cls = 0; cls < 169; ++cls) {
      data.rollup_weight[cls] = static_cast<float>(weight[cls]);
      for (int k = 0; k < data.num_actions; ++k) {
        double freq = 0.0;
        if (weight[cls] > 0.0) freq = freq_sum[cls][k] / weight[cls];
        else if (plain_count[cls] > 0) freq = freq_plain[cls][k] / plain_count[cls];
        // Through the same u16 quantization the per-hand writer applies, so
        // the two exports agree to the digit.
        data.rollup_freq[cls][k] =
            static_cast<float>(std::lround(freq * 10000.0)) / 10000.0f;
      }
    }
  }
  return data;
}

ArtifactNodeData ArtifactReader::read_node(std::uint32_t node_id) const {
  if (bucketed_) return read_bucketed_node(node_id);
  const auto it = index_.find(node_id);
  if (it == index_.end()) {
    throw std::runtime_error("node " + std::to_string(node_id) + " has no blob (not a decision node?)");
  }
  const auto blob = store_.read_range(path_, it->second.first, it->second.second);
  const std::uint8_t* p = blob.data();
  const std::uint8_t* end = blob.data() + blob.size();
  auto need = [&](std::size_t n) {
    if (p + n > end) throw std::runtime_error("truncated node blob");
  };

  ArtifactNodeData data;
  need(8);
  data.num_seats = fmt::get<std::uint16_t>(p);
  data.num_actions = fmt::get<std::uint16_t>(p + 2);
  data.actor = fmt::get<std::uint16_t>(p + 4);
  p += 8;

  const bool ev_f16 = flags_ & fmt::kFlagEvF16;
  const bool strategy_u8 = flags_ & fmt::kFlagStrategyU8;
  const std::size_t ev_size = ev_f16 ? 2 : 4;

  std::vector<std::uint32_t> counts(data.num_seats);
  need(4ull * data.num_seats);
  for (int s = 0; s < data.num_seats; ++s) {
    counts[s] = fmt::get<std::uint32_t>(p);
    p += 4;
  }

  auto read_ev = [&](float& out) {
    if (ev_f16) out = fmt::half_to_float(fmt::get<std::uint16_t>(p));
    else out = fmt::get<float>(p);
    p += ev_size;
  };

  data.seats.resize(data.num_seats);
  for (int s = 0; s < data.num_seats; ++s) {
    ArtifactSeatData& seat = data.seats[s];
    seat.idx.resize(counts[s]);
    seat.reach.resize(counts[s]);
    seat.ev.resize(counts[s]);
    need(counts[s] * (4 + 4 + ev_size));
    for (std::uint32_t i = 0; i < counts[s]; ++i) {
      seat.idx[i] = fmt::get<std::uint32_t>(p);
      p += 4;
    }
    for (std::uint32_t i = 0; i < counts[s]; ++i) {
      seat.reach[i] = fmt::get<float>(p);
      p += 4;
    }
    for (std::uint32_t i = 0; i < counts[s]; ++i) read_ev(seat.ev[i]);
  }

  const std::uint32_t actor_count = counts[data.actor];
  const std::size_t cells = static_cast<std::size_t>(actor_count) * data.num_actions;
  data.strategy.resize(cells);
  need(cells * (strategy_u8 ? 1 : 4));
  for (std::uint32_t h = 0; h < actor_count; ++h) {
    float* row = data.strategy.data() + static_cast<std::size_t>(h) * data.num_actions;
    float sum = 0.0f;
    for (int k = 0; k < data.num_actions; ++k) {
      if (strategy_u8) {
        row[k] = static_cast<float>(*p) / 255.0f;
        p += 1;
      } else {
        row[k] = fmt::get<float>(p);
        p += 4;
      }
      sum += row[k];
    }
    // Quantized rows renormalize to sum exactly 1; an all-zero row (possible
    // only via quantization of a uniform-ish tiny row) becomes uniform.
    if (sum > 0.0f) {
      for (int k = 0; k < data.num_actions; ++k) row[k] /= sum;
    } else {
      for (int k = 0; k < data.num_actions; ++k) row[k] = 1.0f / data.num_actions;
    }
  }
  data.action_ev.resize(cells);
  need(cells * ev_size);
  for (std::size_t i = 0; i < cells; ++i) read_ev(data.action_ev[i]);

  if (flags_ & fmt::kFlagRollups) {
    data.has_rollup = true;
    data.rollup_weight.resize(169);
    data.rollup_ev.resize(169);
    data.rollup_freq.assign(169, std::vector<float>(data.num_actions));
    need(169ull * (8 + 2ull * data.num_actions));
    for (int cls = 0; cls < 169; ++cls) {
      data.rollup_weight[cls] = fmt::get<float>(p);
      p += 4;
      data.rollup_ev[cls] = fmt::get<float>(p);
      p += 4;
      for (int k = 0; k < data.num_actions; ++k) {
        data.rollup_freq[cls][k] = static_cast<float>(fmt::get<std::uint16_t>(p)) / 10000.0f;
        p += 2;
      }
    }
  }
  return data;
}

}  // namespace engine
