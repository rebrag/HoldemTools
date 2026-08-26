#include "io/artifact_writer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <stdexcept>

#include "cards/combos.hpp"
#include "config/sha256.hpp"
#include "io/artifact_format.hpp"

namespace engine {

namespace {

using nlohmann::json;
namespace fmt = engine::artifact;

// Per-decision-node export data computed under the average strategy.
struct NodeExportData {
  std::vector<std::vector<float>> reach;          // [seat][hand] node reach
  std::vector<std::vector<float>> ev_cond;        // [seat][hand] conditional EV, node-relative chips
  std::vector<float> strategy;                    // actor, row-major [hand][action]
  std::vector<std::vector<float>> action_ev_cond; // [action][hand] actor conditional child EV
};

// One post-order traversal under the average strategy computing, at every
// decision node, both seats' reach, conditional per-hand EVs, and the
// actor's per-action conditional EVs. Runs once per solve.
struct ExportPass {
  const Game& game;
  const CfrSolver& solver;
  std::map<NodeId, NodeExportData> exports;

  // Returns counterfactual values per seat.
  std::vector<std::vector<float>> visit(NodeId id, std::vector<std::vector<float>>& reach) {
    const PublicTree& tree = game.tree();
    const Node& node = tree[id];
    const int seats = game.num_seats();
    std::vector<std::vector<float>> values(seats);

    if (node.kind == NodeKind::Terminal) {
      for (int s = 0; s < seats; ++s) {
        values[s].assign(game.num_hands(s), 0.0f);
        game.terminal_values(id, s, reach, values[s]);
      }
      return values;
    }

    if (node.kind == NodeKind::Chance) {
      for (int s = 0; s < seats; ++s) values[s].assign(game.num_hands(s), 0.0f);
      const float w = static_cast<float>(game.chance_weight(id));
      for (std::uint16_t c = 0; c < node.num_children; ++c) {
        const NodeId child = node.first_child + c;
        const int card = tree[child].dealt_card;
        std::vector<std::vector<float>> saved(seats);
        for (int s = 0; s < seats; ++s) {
          saved[s] = reach[s];
          for (int h = 0; h < game.num_hands(s); ++h) {
            if (game.hand_blocks_card(s, h, card)) reach[s][h] = 0.0f;
          }
        }
        auto child_values = visit(child, reach);
        for (int s = 0; s < seats; ++s) {
          for (int h = 0; h < game.num_hands(s); ++h) {
            if (!game.hand_blocks_card(s, h, card)) values[s][h] += w * child_values[s][h];
          }
          reach[s] = saved[s];
        }
      }
      return values;
    }

    // Decision node.
    const int actor = node.actor;
    const int hands = game.num_hands(actor);
    const std::uint16_t actions = node.num_children;
    std::vector<float> sigma;
    solver.average_strategy(id, sigma);

    NodeExportData data;
    data.reach = reach;
    data.strategy = sigma;
    data.action_ev_cond.resize(actions);

    for (int s = 0; s < seats; ++s) values[s].assign(game.num_hands(s), 0.0f);
    std::vector<float> compat;
    game.compat_weights(actor, reach, compat);

    std::vector<float> saved = reach[actor];
    for (std::uint16_t k = 0; k < actions; ++k) {
      for (int h = 0; h < hands; ++h) {
        reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
      }
      auto child_values = visit(node.first_child + k, reach);
      // Actor's conditional EV of taking this action = value at the child,
      // normalized by the opponents' reach (which the actor's own action
      // does not change). Chips already committed stay subtracted - see the
      // convention note on ev_cond below.
      data.action_ev_cond[k].assign(hands, 0.0f);
      for (int h = 0; h < hands; ++h) {
        if (compat[h] > 0.0f) {
          data.action_ev_cond[k][h] = child_values[actor][h] / compat[h];
        }
      }
      for (int s = 0; s < seats; ++s) {
        if (s == actor) {
          for (int h = 0; h < hands; ++h) {
            values[s][h] += sigma[static_cast<std::size_t>(h) * actions + k] * child_values[s][h];
          }
        } else {
          for (int h = 0; h < game.num_hands(s); ++h) values[s][h] += child_values[s][h];
        }
      }
    }
    reach[actor] = saved;

    // EV CONVENTION (matches PioSolver's calc_ev; see docs/artifact-format.md):
    // expected share of the final pot minus ALL of the seat's post-root
    // contributions, including chips already committed before this node.
    // The terminal utilities already subtract the full commitment, so this
    // is just the normalized counterfactual value with nothing added back.
    // Do not "add back" the sunk chips: the viewer's schema-4 bundles are
    // populated from Pio's calc_ev for every board the Pio watcher solved,
    // and the same field must mean the same thing regardless of which
    // solver produced the board. Verified empirically 2026-08-26 - adding
    // the commitment back made engine EVs differ from Pio's by exactly the
    // actor's committed chips at every node past the street root.
    data.ev_cond.resize(seats);
    for (int s = 0; s < seats; ++s) {
      std::vector<float> compat_s;
      game.compat_weights(s, reach, compat_s);
      data.ev_cond[s].assign(game.num_hands(s), 0.0f);
      for (int h = 0; h < game.num_hands(s); ++h) {
        if (compat_s[h] > 0.0f) {
          data.ev_cond[s][h] = values[s][h] / compat_s[h];
        }
      }
    }
    exports.emplace(id, std::move(data));
    return values;
  }
};

std::uint8_t kind_byte(NodeKind k) { return static_cast<std::uint8_t>(k); }
std::uint8_t action_byte(ActionKind a) { return static_cast<std::uint8_t>(a); }

void append_node_record(std::vector<std::uint8_t>& out, NodeId id, const Node& n) {
  const std::size_t start = out.size();
  fmt::put<std::uint32_t>(out, id);
  fmt::put<std::uint32_t>(out, n.parent);
  fmt::put<std::uint8_t>(out, kind_byte(n.kind));
  fmt::put<std::uint8_t>(out, action_byte(n.action_kind));
  fmt::put<std::uint8_t>(out, static_cast<std::uint8_t>(n.street));
  fmt::put<std::uint8_t>(out, static_cast<std::uint8_t>(n.terminal_kind));
  fmt::put<std::uint16_t>(out, n.actor);
  fmt::put<std::uint16_t>(out, n.num_children);
  fmt::put<std::uint32_t>(out, n.first_child);
  fmt::put<std::uint16_t>(out, n.fold_winner);
  fmt::put<std::int16_t>(out, n.dealt_card);
  fmt::put<std::int64_t>(out, n.action_amount);
  fmt::put<std::int64_t>(out, n.pot);
  for (int s = 0; s < kMaxSeats; ++s) {
    fmt::put<std::int32_t>(out, static_cast<std::int32_t>(n.commit[s]));
  }
  fmt::put<std::uint32_t>(out, 0);  // reserved
  if (out.size() - start != fmt::kNodeRecordSize) {
    throw std::logic_error("node record size drifted from kNodeRecordSize");
  }
}

void append_ev(std::vector<std::uint8_t>& out, float value, bool f16) {
  if (f16) fmt::put<std::uint16_t>(out, fmt::float_to_half(value));
  else fmt::put<float>(out, value);
}

// Sparse per-node blob for one decision node; layout documented in
// docs/artifact-format.md. Returns the encoded bytes.
std::vector<std::uint8_t> encode_node_blob(const Game& game, const Node& node,
                                           const NodeExportData& data,
                                           const std::vector<std::vector<std::uint16_t>>& dicts,
                                           bool strategy_u8, bool ev_f16, bool rollups) {
  const int seats = game.num_seats();
  const int actor = node.actor;
  const std::uint16_t actions = node.num_children;

  // Sparse index per seat: hands with node reach above the epsilon. A solver
  // hand index IS its position in the seat's dictionary - the dictionary is
  // the hand universe in hand order - so no remapping is needed.
  std::vector<std::vector<int>> kept(seats);
  for (int s = 0; s < seats; ++s) {
    for (int h = 0; h < game.num_hands(s); ++h) {
      if (data.reach[s][h] > fmt::kSparseEps) kept[s].push_back(h);
    }
  }

  std::vector<std::uint8_t> blob;
  fmt::put<std::uint16_t>(blob, static_cast<std::uint16_t>(seats));
  fmt::put<std::uint16_t>(blob, actions);
  fmt::put<std::uint16_t>(blob, static_cast<std::uint16_t>(actor));
  fmt::put<std::uint16_t>(blob, 0);  // reserved
  for (int s = 0; s < seats; ++s) {
    fmt::put<std::uint32_t>(blob, static_cast<std::uint32_t>(kept[s].size()));
  }
  for (int s = 0; s < seats; ++s) {
    for (int h : kept[s]) fmt::put<std::uint32_t>(blob, static_cast<std::uint32_t>(h));
    for (int h : kept[s]) fmt::put<float>(blob, data.reach[s][h]);
    for (int h : kept[s]) append_ev(blob, data.ev_cond[s][h], ev_f16);
  }
  // Actor strategy rows (renormalized on read) and per-action EVs.
  for (int h : kept[actor]) {
    for (std::uint16_t k = 0; k < actions; ++k) {
      const float p = data.strategy[static_cast<std::size_t>(h) * actions + k];
      if (strategy_u8) {
        fmt::put<std::uint8_t>(blob, static_cast<std::uint8_t>(
                                         std::lround(std::clamp(p, 0.0f, 1.0f) * 255.0f)));
      } else {
        fmt::put<float>(blob, p);
      }
    }
  }
  for (int h : kept[actor]) {
    for (std::uint16_t k = 0; k < actions; ++k) {
      append_ev(blob, data.action_ev_cond[k][h], ev_f16);
    }
  }

  if (rollups) {
    // Trailing 169-class rollup for the actor: range-weighted freq per
    // action (u16, scale 10000), class EV (f32), class weight (f32) - the
    // same aggregation rule as watcher/extraction.py (range-weighted with a
    // plain-mean fallback when the class carries no weight).
    std::vector<double> weight(kNumHandClasses, 0.0);
    std::vector<double> ev_sum(kNumHandClasses, 0.0);
    std::vector<std::vector<double>> freq_sum(kNumHandClasses,
                                              std::vector<double>(actions, 0.0));
    std::vector<std::vector<double>> freq_plain(kNumHandClasses,
                                                std::vector<double>(actions, 0.0));
    std::vector<int> plain_count(kNumHandClasses, 0);
    for (int h = 0; h < game.num_hands(actor); ++h) {
      // The rollup is by 169 hand class, which is a property of the CANONICAL
      // combo - so the dictionary entry, not the compact hand index.
      const int cls = combo_class_index(dicts[actor][static_cast<std::size_t>(h)]);
      const double w = data.reach[actor][h];
      ++plain_count[cls];
      weight[cls] += w;
      ev_sum[cls] += w * data.ev_cond[actor][h];
      for (std::uint16_t k = 0; k < actions; ++k) {
        const double p = data.strategy[static_cast<std::size_t>(h) * actions + k];
        freq_sum[cls][k] += w * p;
        freq_plain[cls][k] += p;
      }
    }
    for (int cls = 0; cls < kNumHandClasses; ++cls) {
      fmt::put<float>(blob, static_cast<float>(weight[cls]));
      fmt::put<float>(blob, weight[cls] > 0.0
                                ? static_cast<float>(ev_sum[cls] / weight[cls])
                                : 0.0f);
      for (std::uint16_t k = 0; k < actions; ++k) {
        double freq = 0.0;
        if (weight[cls] > 0.0) freq = freq_sum[cls][k] / weight[cls];
        else if (plain_count[cls] > 0) freq = freq_plain[cls][k] / plain_count[cls];
        fmt::put<std::uint16_t>(blob, static_cast<std::uint16_t>(std::lround(freq * 10000.0)));
      }
    }
  }
  return blob;
}

void pad_to(ArtifactStore& store, std::uint64_t alignment) {
  static const std::uint8_t zeros[64] = {};
  const std::uint64_t pos = store.tell();
  const std::uint64_t rem = pos % alignment;
  if (rem != 0) store.write(zeros, static_cast<std::size_t>(alignment - rem));
}

}  // namespace

void write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const CfrSolver& solver, const SolveConfig& config,
                    const SolveStats& stats) {
  if (game.num_seats() != 2) {
    throw std::runtime_error("artifact writer supports 2-seat games in this pass");
  }
  const PublicTree& tree = game.tree();
  const bool rollups = config.rollups_169 && config.game == "nlhe";
  const bool strategy_u8 = config.strategy_quantize_u8;
  const bool ev_f16 = !config.ev_float32;

  // Export pass under the average strategy.
  ExportPass pass{game, solver, {}};
  {
    std::vector<std::vector<float>> reach(game.num_seats());
    for (int s = 0; s < game.num_seats(); ++s) reach[s] = game.initial_range(s);
    pass.visit(tree.root(), reach);
  }

  // Hand dictionaries: entry h is the universe id of solver hand h, so a
  // dictionary position and a solver hand index are the same number.
  std::vector<std::vector<std::uint16_t>> dicts(game.num_seats());
  for (int s = 0; s < game.num_seats(); ++s) {
    dicts[s] = game.hand_dictionary(s);
    if (dicts[s].size() != static_cast<std::size_t>(game.num_hands(s))) {
      throw std::runtime_error("hand_dictionary must have one entry per hand");
    }
  }

  store.open_write(path);
  std::uint32_t flags = 0;
  if (strategy_u8) flags |= fmt::kFlagStrategyU8;
  if (ev_f16) flags |= fmt::kFlagEvF16;
  if (rollups) flags |= fmt::kFlagRollups;

  // Header placeholder; offsets patched at the end (why ArtifactStore has seek).
  std::vector<std::uint8_t> header(fmt::kHeaderSize, 0);
  store.write(header.data(), header.size());

  // Node table.
  pad_to(store, 8);
  const std::uint64_t node_table_off = store.tell();
  {
    std::vector<std::uint8_t> records;
    records.reserve(tree.size() * fmt::kNodeRecordSize);
    for (NodeId id = 0; id < tree.size(); ++id) append_node_record(records, id, tree[id]);
    store.write(records.data(), records.size());
  }
  const std::uint64_t node_table_len = store.tell() - node_table_off;

  // Hand dictionaries.
  json dict_meta = json::array();
  for (int s = 0; s < game.num_seats(); ++s) {
    pad_to(store, 8);
    const std::uint64_t off = store.tell();
    std::vector<std::uint8_t> bytes;
    fmt::put<std::uint32_t>(bytes, static_cast<std::uint32_t>(dicts[s].size()));
    for (std::uint16_t id : dicts[s]) fmt::put<std::uint16_t>(bytes, id);
    store.write(bytes.data(), bytes.size());
    dict_meta.push_back({{"seat", s},
                         {"offset", off},
                         {"length", store.tell() - off},
                         {"count", dicts[s].size()}});
  }

  // Node blobs (decision nodes only), collecting the index.
  struct IndexEntry {
    std::uint32_t node_id;
    std::uint64_t offset;
    std::uint64_t length;
  };
  std::vector<IndexEntry> index;
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& node = tree[id];
    if (node.kind != NodeKind::Decision) continue;
    pad_to(store, 64);
    const std::uint64_t off = store.tell();
    const auto blob = encode_node_blob(game, node, pass.exports.at(id), dicts,
                                       strategy_u8, ev_f16, rollups);
    store.write(blob.data(), blob.size());
    index.push_back({id, off, blob.size()});
  }

  // Metadata JSON.
  json meta;
  meta["solver_version"] = "0.1.0";
  meta["format_version"] = fmt::kFormatVersion;
  meta["config_hash"] = config_hash(config);
  meta["config"] = config.raw;
  meta["game"] = config.game;
  meta["mode"] = config.qre_mode;  // "nash"; QRE artifacts must be distinguishable
  meta["lambda"] = nullptr;        // per-player lambda, QRE solves only (M7)
  meta["iterations"] = stats.iterations;
  meta["final_nashconv"] = stats.nashconv;
  // Pio-comparable convergence: per-player "exploitable for", in chips and
  // as a percent of the root pot.
  const double exploitable_chips = stats.nashconv / game.num_seats();
  meta["final_exploitable_chips"] = exploitable_chips;
  meta["final_exploitable_pct_pot"] =
      config.pot > 0
          ? json(exploitable_chips / static_cast<double>(config.pot) * 100.0)
          : json(nullptr);
  meta["ev_chips"] = {stats.ev_seat0, stats.ev_seat1};
  meta["partition"] = json::array({{0}, {1}});
  meta["payoff_weights"] = nullptr;
  meta["collusion"] = {{"mode", "none"}, {"p", nullptr}};
  // CFR has no Nash guarantee with 3+ players (it converges to the coarse
  // correlated equilibrium set); flagged here so downstream consumers can
  // surface it. Always false while the engine is 2-player.
  meta["multiway_no_nash_guarantee"] = game.num_seats() > 2;
  meta["wall_time_s"] = stats.wall_time_s;
  meta["setup_time_s"] = stats.setup_time_s;
  meta["threads"] = stats.threads;
  meta["recalc_skips"] = stats.recalc_skips;
  meta["peak_rss_bytes"] = stats.peak_rss_bytes;
  meta["board"] = config.board;
  meta["chip_scale"] = config.chip_scale;
  meta["pot"] = config.pot;
  meta["node_count"] = tree.size();
  meta["decision_node_count"] = tree.num_decision_nodes;
  meta["hand_universe"] = config.game == "nlhe" ? "nlhe_combos_1326" : "toy";
  json seat_labels = json::array();
  for (const PlayerConfig& p : config.players) seat_labels.push_back(p.seat);
  if (seat_labels.empty()) seat_labels = {"P0", "P1"};
  meta["seats"] = seat_labels;
  if (!config.players.empty()) meta["effective_stack"] = config.players[0].stack;
  meta["sections"] = {
      {"node_table",
       {{"offset", node_table_off},
        {"length", node_table_len},
        {"record_size", fmt::kNodeRecordSize},
        {"count", tree.size()}}},
      {"hand_dicts", dict_meta}};

  pad_to(store, 8);
  const std::uint64_t meta_off = store.tell();
  const std::string meta_text = meta.dump();
  store.write(meta_text.data(), meta_text.size());
  const std::uint64_t meta_len = store.tell() - meta_off;

  // Index, sorted by node id (already in order), at EOF.
  pad_to(store, 8);
  const std::uint64_t index_off = store.tell();
  {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(index.size() * fmt::kIndexEntrySize);
    for (const IndexEntry& e : index) {
      fmt::put<std::uint32_t>(bytes, e.node_id);
      fmt::put<std::uint32_t>(bytes, 0);
      fmt::put<std::uint64_t>(bytes, e.offset);
      fmt::put<std::uint64_t>(bytes, e.length);
    }
    store.write(bytes.data(), bytes.size());
  }
  const std::uint64_t index_len = store.tell() - index_off;

  // Patch the header.
  header.clear();
  fmt::put_bytes(header, fmt::kMagic, sizeof(fmt::kMagic));
  fmt::put<std::uint32_t>(header, fmt::kFormatVersion);
  fmt::put<std::uint32_t>(header, fmt::kHeaderSize);
  fmt::put<std::uint32_t>(header, flags);
  fmt::put<std::uint32_t>(header, 0);
  fmt::put<std::uint64_t>(header, meta_off);
  fmt::put<std::uint64_t>(header, meta_len);
  fmt::put<std::uint64_t>(header, index_off);
  fmt::put<std::uint64_t>(header, index_len);
  fmt::put<std::uint64_t>(header, 0);
  store.seek(0);
  store.write(header.data(), header.size());
  store.close_write();
}

}  // namespace engine
