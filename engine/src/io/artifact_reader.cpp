#include "io/artifact_reader.hpp"

#include <cstring>
#include <stdexcept>

#include "io/artifact_format.hpp"

namespace engine {

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
}

std::vector<std::uint32_t> ArtifactReader::decision_node_ids() const {
  std::vector<std::uint32_t> ids;
  ids.reserve(index_.size());
  for (const auto& [id, range] : index_) ids.push_back(id);
  return ids;
}

ArtifactNodeData ArtifactReader::read_node(std::uint32_t node_id) const {
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
