#include "io/artifact_writer.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "cards/combos.hpp"
#include "config/sha256.hpp"
#include "io/artifact_format.hpp"
#include "solver/memory.hpp"

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

// export_pass_bytes() below sizes this struct field by field. A new member
// that is not counted there silently re-opens the hole the export term was
// added to close - the memory limit is checked against the ESTIMATE, so an
// undercount is a solve that should have been refused and instead thrashes
// the box. Break the build instead.
static_assert(sizeof(NodeExportData) == 4 * sizeof(std::vector<float>),
              "NodeExportData gained or lost a member - update export_pass_bytes()");

// One post-order traversal under the average strategy computing, at every
// decision node, both seats' reach, conditional per-hand EVs, and the
// actor's per-action conditional EVs. Runs once per solve.
struct ExportPass {
  const Game& game;
  const StrategySource& solver;
  // Indexed by Node::decision_index, which is dense over EVERY decision node
  // including suit-isomorphic members (they carry a valid index; only their
  // solver storage is redirected). This was a std::map<NodeId, ...>: one
  // red-black allocation per node - 248536 of them on a real flop tree - plus
  // an O(log n) lookup for each one in the write loop below, to hold a key
  // that is already a dense array index.
  std::vector<NodeExportData> exports;

  // Forking below this many children is not worth a reach-vector copy each.
  static constexpr int kMinSplitChildren = 2;

  // Returns counterfactual values per seat.
  //
  // `split` is the remaining fan-out budget and `fork_depth` the number of
  // forks already taken on this path, exactly as in CfrSolver::traverse_impl -
  // and the parallelism keeps that function's discipline for the same reason.
  // Sibling subtrees are independent (they fill DISJOINT `exports` slots,
  // indexed by decision_index) so they run concurrently, but every
  // cross-child accumulation stays serial and IN CHILD ORDER after the join.
  // That is what makes a threaded export bit-identical to a serial one, which
  // the committed fixture then checks.
  //
  // This pass used to be the one serial phase left: 18.5 s on one core at the
  // end of a solve whose loop had been using sixteen, which is where the
  // "engine.exe only reaches ~30% CPU" report came from.
  std::vector<std::vector<float>> visit(NodeId id, std::vector<std::vector<float>>& reach,
                                        int split, int fork_depth) {
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

    const int children = node.num_children;
    const bool fork =
        split > 1 && fork_depth < kMaxSplitLevels && children >= kMinSplitChildren;
    const int child_split = fork ? std::max(1, split / children) : split;
    const int child_fork_depth = fork ? fork_depth + 1 : fork_depth;

    if (node.kind == NodeKind::Chance) {
      for (int s = 0; s < seats; ++s) values[s].assign(game.num_hands(s), 0.0f);
      const float w = static_cast<float>(game.chance_weight(id));
      if (fork) {
        std::vector<std::vector<std::vector<float>>> forked_reach(children);
        std::vector<std::vector<std::vector<float>>> forked_values(children);
        solver.pool().parallel_for(children, [&](int c) {
          const NodeId child = node.first_child + static_cast<NodeId>(c);
          const int card = tree[child].dealt_card;
          std::vector<std::vector<float>>& cr = forked_reach[static_cast<std::size_t>(c)];
          cr = reach;
          for (int s = 0; s < seats; ++s) {
            for (int h = 0; h < game.num_hands(s); ++h) {
              if (game.hand_blocks_card(s, h, card)) cr[s][h] = 0.0f;
            }
          }
          forked_values[static_cast<std::size_t>(c)] =
              visit(child, cr, child_split, child_fork_depth);
        });
        for (int c = 0; c < children; ++c) {
          const int card = tree[node.first_child + static_cast<NodeId>(c)].dealt_card;
          const std::vector<std::vector<float>>& cv = forked_values[static_cast<std::size_t>(c)];
          for (int s = 0; s < seats; ++s) {
            for (int h = 0; h < game.num_hands(s); ++h) {
              if (!game.hand_blocks_card(s, h, card)) values[s][h] += w * cv[s][h];
            }
          }
        }
        return values;
      }
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
        auto child_values = visit(child, reach, child_split, child_fork_depth);
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

    // The per-action fold-back below is identical in both paths; only where
    // the child values came from differs. Keeping it in one lambda is what
    // guarantees the threaded result is the serial one.
    const auto fold_child = [&](std::uint16_t k,
                                const std::vector<std::vector<float>>& child_values) {
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
    };

    std::vector<float> saved = reach[actor];
    if (fork) {
      std::vector<std::vector<std::vector<float>>> forked_reach(children);
      std::vector<std::vector<std::vector<float>>> forked_values(children);
      solver.pool().parallel_for(children, [&](int c) {
        const std::uint16_t k = static_cast<std::uint16_t>(c);
        std::vector<std::vector<float>>& cr = forked_reach[static_cast<std::size_t>(c)];
        cr = reach;
        // Only the actor's own reach moves; every other seat's is unchanged
        // by the actor's choice, which is why the copy above is enough.
        for (int h = 0; h < hands; ++h) {
          cr[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
        }
        forked_values[static_cast<std::size_t>(c)] =
            visit(node.first_child + k, cr, child_split, child_fork_depth);
      });
      for (std::uint16_t k = 0; k < actions; ++k) {
        fold_child(k, forked_values[static_cast<std::size_t>(k)]);
      }
    } else {
      for (std::uint16_t k = 0; k < actions; ++k) {
        for (int h = 0; h < hands; ++h) {
          reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
        }
        auto child_values = visit(node.first_child + k, reach, child_split, child_fork_depth);
        fold_child(k, child_values);
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
    exports[node.decision_index] = std::move(data);
    return values;
  }
};

// Live bytes of the ExportPass store at its peak, which is the moment the last
// decision node is filled in: nothing is released until write_artifact returns.
std::size_t export_store_bytes(const Game& game) {
  const PublicTree& tree = game.tree();
  const std::size_t seats = static_cast<std::size_t>(game.num_seats());
  std::size_t hands = 0;
  for (int s = 0; s < game.num_seats(); ++s) {
    hands = std::max(hands, static_cast<std::size_t>(game.num_hands(s)));
  }
  // Every vector's control block counts too: at a few hundred hands a
  // std::vector header is ~2% of the payload it points at, and there are
  // 2*seats + actions of them per node on top of the four inside the struct.
  constexpr std::size_t kVec = sizeof(std::vector<float>);
  // The store is one contiguous std::vector<NodeExportData> indexed by
  // decision_index, so an entry costs exactly the struct - no key, no links,
  // and no per-node heap block. It used to be a std::map, which charged all
  // three.
  const std::size_t per_entry = sizeof(NodeExportData);
  // Each of those vectors is its own heap block, and there are ~11 blocks per
  // decision node here - on a flop tree the bookkeeping alone runs to tens of
  // megabytes, enough on its own to leave this estimate below the measured
  // peak commit with every payload counted correctly.

  std::size_t total = 0;
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Decision) continue;
    const std::size_t actions = n.num_children;
    // reach and ev_cond: one hand-wide vector per seat each. strategy: one
    // hands x actions block. action_ev_cond: one hand-wide vector per action.
    const std::size_t floats = 2 * seats * hands + 2 * actions * hands;
    // Blocks: the four buffers the struct's own vectors own plus the inner
    // vectors' buffers. No map node any more - the store is one allocation.
    const std::size_t blocks = 4 + 2 * seats + actions;
    total += floats * sizeof(float) + (2 * seats + actions) * kVec + per_entry +
             blocks * kHeapBlockOverhead;
  }
  return total;
}

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

std::size_t export_pass_bytes(const Game& game) { return export_store_bytes(game); }

double write_artifact(ArtifactStore& store, const std::string& path, const Game& game,
                    const StrategySource& source, const SolveConfig& config,
                    const SolveStats& stats) {
  if (game.num_seats() < 2 || game.num_seats() > kMaxSeats) {
    throw std::runtime_error("artifact writer supports 2 to " + std::to_string(kMaxSeats) +
                             " seats");
  }
  const auto export_start = std::chrono::steady_clock::now();
  const PublicTree& tree = game.tree();
  // The 169-class rollup IS the push/fold chart, so it matters more preflop
  // than anywhere else.
  const bool nlhe = config.game == "nlhe" || config.game == "nlhe_preflop";
  const bool rollups = config.rollups_169 && nlhe;
  const bool strategy_u8 = config.strategy_quantize_u8;
  const bool ev_f16 = !config.ev_float32;

  // Export pass under the average strategy.
  ExportPass pass{game, source, std::vector<NodeExportData>(tree.num_decision_nodes)};
  {
    std::vector<std::vector<float>> reach(game.num_seats());
    for (int s = 0; s < game.num_seats(); ++s) reach[s] = game.initial_range(s);
    // Same fan-out budget the solver uses, so the export saturates the same
    // pool rather than inventing its own policy.
    pass.visit(tree.root(), reach, source.split_budget(), 0);
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
    const auto blob = encode_node_blob(game, node, pass.exports[node.decision_index], dicts,
                                       strategy_u8, ev_f16, rollups);
    store.write(blob.data(), blob.size());
    index.push_back({id, off, blob.size()});
  }

  // Peak memory, sampled HERE and not by the caller. The export pass above is
  // the high-water mark of the whole run on any tree big enough for memory to
  // matter - a flop tree spends more on it than on regrets + strategy - so a
  // sample taken when the solve loop ended (which is what stats carries)
  // misses the largest allocation the process ever made. Everything still to
  // be written from here is the metadata, the index and the header patch:
  // kilobytes, not a new peak. Metadata is a free-form JSON object read by
  // name, so the extra keys are additive - no format version bump.
  const PeakMemory peak = peak_memory();

  // Metadata JSON.
  json meta;
  meta["solver_version"] = "0.1.0";
  meta["format_version"] = fmt::kFormatVersion;
  meta["config_hash"] = config_hash(config);
  meta["config"] = config.raw;
  meta["game"] = config.game;
  // "nash" | "qre". Downstream refusals key off this: the Pio harness will not
  // rate a QRE solve against Pio, and the solutions exporter will not publish
  // one. Both are correct - a QRE deliberately is not a Nash equilibrium.
  meta["mode"] = config.qre_mode;
  meta["solver_family"] = config.sampled.enabled ? "sampled" : "vectorized";
  meta["sampled"] = config.sampled.enabled
                        ? json({{"seed", config.sampled.seed},
                                {"batch", config.sampled.batch},
                                {"lanes", config.sampled.lanes}})
                        : json(nullptr);
  meta["lambda"] = config.qre.enabled ? json(config.qre.lambda) : json(nullptr);
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
  // QRE only: exploitability in the entropy-augmented game. This is the number
  // a QRE solve drives to zero and stops on; `final_nashconv` above is the
  // PLAIN measurement of the same strategy, which plateaus at a
  // lambda-dependent floor by construction. Both travel so a consumer can show
  // the plateau instead of reporting it as a failure to converge. Null for a
  // Nash solve. Metadata is a free-form JSON object and every reader (C# and
  // Python alike) picks fields by name, so adding keys is additive - no format
  // version bump, no fixture regeneration.
  if (config.qre.enabled) {
    const double qre_per_player = stats.qre_gap / game.num_seats();
    meta["final_qre_gap_chips"] = qre_per_player;
    meta["final_qre_gap_pct_pot"] =
        config.pot > 0
            ? json(qre_per_player / static_cast<double>(config.pot) * 100.0)
            : json(nullptr);
  } else {
    meta["final_qre_gap_chips"] = nullptr;
    meta["final_qre_gap_pct_pot"] = nullptr;
  }
  meta["ev_chips"] = stats.ev_chips;
  json partition = json::array();
  for (int s = 0; s < game.num_seats(); ++s) partition.push_back(json::array({s}));
  meta["partition"] = std::move(partition);
  meta["payoff_weights"] = nullptr;
  meta["collusion"] = {{"mode", "none"}, {"p", nullptr}};
  // CFR has no Nash guarantee with 3+ players (it converges to the coarse
  // correlated equilibrium set); flagged here so downstream consumers can
  // surface it.
  meta["multiway_no_nash_guarantee"] = game.num_seats() > 2;
  meta["wall_time_s"] = stats.wall_time_s;
  meta["setup_time_s"] = stats.setup_time_s;
  // The export pass and file write, which wall_time_s excludes by design.
  // Recorded here rather than by the caller because only this function knows
  // when its own work started; the caller's clock has already stopped.
  const double export_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - export_start).count();
  meta["export_time_s"] = export_s;
  meta["threads"] = stats.threads;
  meta["recalc_skips"] = stats.recalc_skips;
  meta["peak_rss_bytes"] = peak.working_set;
  meta["peak_commit_bytes"] = peak.commit;
  meta["solve_peak_rss_bytes"] = stats.peak_rss_bytes;
  meta["board"] = config.board;
  meta["chip_scale"] = config.chip_scale;
  meta["pot"] = config.pot;
  meta["node_count"] = tree.size();
  meta["decision_node_count"] = tree.num_decision_nodes;
  meta["hand_universe"] = nlhe ? "nlhe_combos_1326" : "toy";
  json seat_labels = json::array();
  for (const PlayerConfig& p : config.players) seat_labels.push_back(p.seat);
  if (seat_labels.empty()) {
    for (int s = 0; s < game.num_seats(); ++s) seat_labels.push_back("P" + std::to_string(s));
  }
  meta["seats"] = seat_labels;
  if (!config.players.empty()) {
    // Per-seat stacks travel because preflop allows them to differ; the
    // scalar stays for every existing consumer and is the effective stack.
    json stacks = json::array();
    Chips smallest = config.players[0].stack;
    for (const PlayerConfig& p : config.players) {
      stacks.push_back(p.stack);
      smallest = std::min(smallest, p.stack);
    }
    meta["stacks"] = std::move(stacks);
    meta["effective_stack"] = smallest;
  }
  if (config.game == "nlhe_preflop") {
    const PreflopConfig& pf = config.preflop;
    const int n = game.num_seats();
    const int sb = n == 2 ? pf.button : (pf.button + 1) % n;
    const int bb = n == 2 ? (pf.button + 1) % n : (pf.button + 2) % n;
    json order = json::array();
    for (int step = 1; step <= n; ++step) order.push_back((bb + step) % n);
    // Derived here so no consumer re-derives the heads-up blind exception.
    meta["preflop"] = {{"button", pf.button},   {"sb_seat", sb},
                       {"bb_seat", bb},         {"small_blind", pf.small_blind},
                       {"big_blind", pf.big_blind}, {"ante", pf.ante},
                       {"dead", pf.dead},       {"action_set", pf.action_set},
                       {"action_order", order}};
    meta["board_sample"] = {{"iter_count", pf.board_sample.iter_count},
                            {"pair_count", pf.board_sample.pair_count},
                            {"seed", pf.board_sample.seed},
                            {"fixed_across_iterations", true}};
    // Hero-vs-opponent card removal is exact everywhere. Opponent-vs-opponent
    // removal (bunching) is applied to the profile MASS by first-order
    // inclusion-exclusion - exact with two opponents - but not to the equity
    // FRACTION, which would need the same sums at every strength threshold on
    // every sampled board. Named rather than described so a consumer can tell
    // artifacts written before and after the correction apart.
    meta["opponent_card_removal"] = "pairwise_mass";
  }
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
  return export_s;
}

}  // namespace engine
