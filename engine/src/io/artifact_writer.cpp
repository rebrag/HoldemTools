#include "io/artifact_writer.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <type_traits>
#include <vector>

#include "cards/combos.hpp"
#include "config/sha256.hpp"
#include "io/artifact_format.hpp"
#include "solver/fork_plan.hpp"
#include "solver/memory.hpp"
#include "util/build_info.hpp"
#include "util/parallel.hpp"

namespace engine {

namespace {

using nlohmann::json;
namespace fmt = engine::artifact;

// ---------------------------------------------------------------------------
// The export store: everything the export pass keeps per decision node, in ONE
// flat float buffer with a prefix-sum offset table.
//
// A decision node's slice holds, in this order:
//
//   reach      one hands-wide row per seat      [seat][hand]    node reach
//   ev_cond    one hands-wide row per seat      [seat][hand]    conditional EV, node-relative chips
//   strategy   the actor's, row-major           [hand][action]  as average_strategy returns it
//   action_ev  one hands-wide row per action    [action][hand]  the actor's conditional child EV
//
// It was a std::vector of records owning four vectors each: ~11 heap blocks
// per decision node, 3.4 million on a recorded-hand flop tree. Every size is
// known from the tree before the pass starts, so the blocks bought nothing,
// and docs/roadmap.md ("Work-based forking", follow-ups 1 and 2) has what
// they cost: seconds of frees on the way out of write_artifact that no
// printed timer covered, and heap rounding and bookkeeping the memory
// estimator could only guess at. One allocation has neither, and its size is
// arithmetic rather than a guess at what an allocator does.
// ---------------------------------------------------------------------------

// Where each section of one node's slice starts, in floats from the start of
// the slice (reach is at 0), and the size of the whole slice.
struct SliceShape {
  std::size_t ev_cond = 0;
  std::size_t strategy = 0;
  std::size_t action_ev = 0;
  std::size_t floats = 0;
};

// The layout, and the only place it is written down. The store is allocated
// from `floats`, the pass and the encoder address their sections through the
// other three, and export_pass_bytes() sums the same `floats` - so the memory
// estimate cannot drift from the allocation: they are one number. A new
// section goes HERE (a field above, a line below), and everything that sizes
// or addresses a slice follows.
//
// `seat_hands` is the sum of every seat's hand count, `actor_hands` the
// acting seat's.
constexpr SliceShape slice_shape(std::size_t seat_hands, std::size_t actor_hands,
                                 std::size_t actions) {
  SliceShape shape;
  shape.ev_cond = seat_hands;
  shape.strategy = shape.ev_cond + seat_hands;
  shape.action_ev = shape.strategy + actor_hands * actions;
  shape.floats = shape.action_ev + actions * actor_hands;
  return shape;
}

// The memory limit is checked against the ESTIMATE, so an export that holds
// more than export_pass_bytes() counts is a solve that should have been
// refused and instead thrashes the box. Three things break the build rather
// than the estimate: a section added to the shape without revisiting the
// sizing (the first assert), a section sized differently from how it is laid
// out (the second - the same arithmetic tests/test_memory.cpp pins against a
// real game), and a second per-node allocation growing beside the flat
// buffer (the assert under ExportStore).
static_assert(sizeof(SliceShape) == 4 * sizeof(std::size_t),
              "the export slice gained or lost a section - update slice_shape(), "
              "export_pass_bytes() and the expectation in tests/test_memory.cpp");
static_assert(slice_shape(6, 3, 2).floats == 2 * 6 + 2 * 3 * 2 &&
                  slice_shape(6, 3, 2).ev_cond == 6 && slice_shape(6, 3, 2).strategy == 12 &&
                  slice_shape(6, 3, 2).action_ev == 18,
              "slice_shape() no longer lays a slice out as reach, ev_cond, strategy, action_ev");

// One decision node's slice: a few pointers into the flat buffer. `F` is
// float for the pass that fills it and const float for the encoder.
template <typename F>
struct NodeSlice {
  F* base = nullptr;
  SliceShape shape;
  std::size_t actor_hands = 0;
  // First float of seat s's row inside a per-seat section.
  std::array<std::size_t, kMaxSeats> seat_at{};

  F* reach(int s) const { return base + seat_at[static_cast<std::size_t>(s)]; }
  F* ev_cond(int s) const {
    return base + shape.ev_cond + seat_at[static_cast<std::size_t>(s)];
  }
  F* strategy() const { return base + shape.strategy; }
  F* action_ev(std::size_t k) const { return base + shape.action_ev + k * actor_hands; }
};

// What the export holds, from the tree alone.
struct ExportSizing {
  std::size_t floats = 0;     // the flat buffer
  std::size_t decisions = 0;  // slices in it
  std::size_t max_blob = 0;   // the largest blob any one node can encode to
};

// The ONE walk that sizes the export. The estimator calls it with no table
// and gets the totals; the store calls it with one and gets the same totals
// plus where each slice starts. Allocates nothing of its own.
ExportSizing size_export(const Game& game, std::vector<std::size_t>* offsets) {
  const PublicTree& tree = game.tree();
  const std::size_t seats = static_cast<std::size_t>(game.num_seats());
  std::size_t seat_hands = 0;
  for (int s = 0; s < game.num_seats(); ++s) {
    seat_hands += static_cast<std::size_t>(game.num_hands(s));
  }
  ExportSizing sizing;
  if (offsets != nullptr) {
    offsets->assign(static_cast<std::size_t>(tree.num_decision_nodes) + 1, 0);
  }
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Decision) continue;
    const std::size_t actions = n.num_children;
    const std::size_t hands = static_cast<std::size_t>(game.num_hands(n.actor));
    const std::size_t floats = slice_shape(seat_hands, hands, actions).floats;
    ++sizing.decisions;
    sizing.floats += floats;
    // Parked one slot along, so the prefix sum below turns sizes into starts
    // whatever order decision_index was assigned in.
    if (offsets != nullptr) (*offsets)[static_cast<std::size_t>(n.decision_index) + 1] = floats;
    // The largest this node's blob can be: every hand kept, f32 strategy and
    // EVs, the rollup block present. See encode_node_blob for the layout.
    sizing.max_blob =
        std::max(sizing.max_blob, 8 + seats * 4 + seat_hands * 12 + hands * actions * 8 +
                                      static_cast<std::size_t>(kNumHandClasses) *
                                          (8 + 2 * actions));
  }
  if (offsets != nullptr) {
    for (std::size_t d = 1; d < offsets->size(); ++d) (*offsets)[d] += (*offsets)[d - 1];
  }
  return sizing;
}

struct ExportStore {
  // Indexed by Node::decision_index, which is dense over EVERY decision node
  // including suit-isomorphic members (they carry a valid index; only their
  // solver storage is redirected). Entry d is the first float of node d's
  // slice and the last entry is one past the end.
  std::vector<std::size_t> offset;
  // Deliberately NOT value-initialized. Zeroing gigabytes on one thread
  // before a pass that overwrites every float of them would put a serial
  // phase back into the export, and would first-touch every page from one
  // NUMA node. The pass writes all four sections of every decision node it
  // visits, and it visits every node of the tree, so nothing is read before
  // it is written.
  std::unique_ptr<float[]> data;

  ExportSizing allocate(const Game& game) {
    const ExportSizing sizing = size_export(game, &offset);
    data.reset(new float[sizing.floats]);
    return sizing;
  }

  NodeSlice<float> slice(const Game& game, const Node& node) {
    return slice_at<float>(data.get(), game, node);
  }
  NodeSlice<const float> slice(const Game& game, const Node& node) const {
    return slice_at<const float>(data.get(), game, node);
  }

 private:
  template <typename F>
  NodeSlice<F> slice_at(F* floats, const Game& game, const Node& node) const {
    NodeSlice<F> slice;
    std::size_t seat_hands = 0;
    for (int s = 0; s < game.num_seats(); ++s) {
      slice.seat_at[static_cast<std::size_t>(s)] = seat_hands;
      seat_hands += static_cast<std::size_t>(game.num_hands(s));
    }
    slice.actor_hands = static_cast<std::size_t>(game.num_hands(node.actor));
    slice.shape = slice_shape(seat_hands, slice.actor_hands, node.num_children);
    const std::size_t d = node.decision_index;
    // The table and the view come from the same slice_shape(), so this can
    // only fire for a node the sizing walk did not count.
    if (d + 1 >= offset.size() || offset[d + 1] - offset[d] != slice.shape.floats) {
      throw std::logic_error("export slice does not match the offset table");
    }
    slice.base = floats + offset[d];
    return slice;
  }
};

// Exactly two allocations: the offset table and the float buffer.
// export_store_bytes() below counts exactly those two.
static_assert(sizeof(ExportStore) ==
                  sizeof(std::vector<std::size_t>) + sizeof(std::unique_ptr<float[]>),
              "ExportStore gained or lost a member - count it in export_store_bytes()");

// One post-order traversal under the average strategy computing, at every
// decision node, both seats' reach, conditional per-hand EVs, and the
// actor's per-action conditional EVs. Runs once per solve.
struct ExportPass {
  const Game& game;
  const StrategySource& solver;
  ExportStore store;
  // Where the pass splits across the pool; same rule as the solver's own
  // traversal (solver/fork_plan.hpp).
  ForkPlan plan{};

  // Returns counterfactual values per seat.
  //
  // The parallelism keeps CfrSolver::traverse_impl's discipline, for the same
  // reason.
  // Sibling subtrees are independent (they fill DISJOINT slices of the store,
  // one per decision_index) so they run concurrently, but every
  // cross-child accumulation stays serial and IN CHILD ORDER after the join.
  // That is what makes a threaded export bit-identical to a serial one, which
  // the committed fixture then checks.
  //
  // This pass used to be the one serial phase left: 18.5 s on one core at the
  // end of a solve whose loop had been using sixteen, which is where the
  // "engine.exe only reaches ~30% CPU" report came from.
  std::vector<std::vector<float>> visit(NodeId id, std::vector<std::vector<float>>& reach) {
    const PublicTree& tree = game.tree();
    const Node& node = tree[id];
    const int seats = game.num_seats();
    std::vector<std::vector<float>> values(seats);

    if (node.kind == NodeKind::Terminal) {
      for (int s = 0; s < seats; ++s) {
        values[s].assign(game.num_hands(s), 0.0f);
        // Without a vectorized terminal there is no per-hand value to carry
        // up. The strategy and the reach still export; the EV fields stay
        // zero and the artifact says so rather than shipping a wrong number.
        if (game.vectorized_terminals()) game.terminal_values(id, s, reach, values[s]);
      }
      return values;
    }

    const int children = node.num_children;
    const bool fork = plan.fork(id);

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
          forked_values[static_cast<std::size_t>(c)] = visit(child, cr);
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

    if (sigma.size() != static_cast<std::size_t>(hands) * actions) {
      throw std::logic_error("average_strategy must return hands x actions floats");
    }

    // This node's slice. Reach is captured now, before the loop below moves
    // the actor's; the EV sections are filled in as the children return.
    const NodeSlice<float> data = store.slice(game, node);
    for (int s = 0; s < seats; ++s) {
      std::memcpy(data.reach(s), reach[s].data(),
                  static_cast<std::size_t>(game.num_hands(s)) * sizeof(float));
    }
    std::memcpy(data.strategy(), sigma.data(), sigma.size() * sizeof(float));

    for (int s = 0; s < seats; ++s) values[s].assign(game.num_hands(s), 0.0f);
    const bool with_ev = game.vectorized_terminals();
    std::vector<float> compat;
    if (with_ev) game.compat_weights(actor, reach, compat);
    else compat.assign(static_cast<std::size_t>(game.num_hands(actor)), 0.0f);

    // The per-action fold-back below is identical in both paths; only where
    // the child values came from differs. Keeping it in one lambda is what
    // guarantees the threaded result is the serial one.
    const auto fold_child = [&](std::uint16_t k,
                                const std::vector<std::vector<float>>& child_values) {
      // Actor's conditional EV of taking this action = value at the child,
      // normalized by the opponents' reach (which the actor's own action
      // does not change). Chips already committed stay subtracted - see the
      // convention note on ev_cond below.
      float* const action_ev = data.action_ev(k);
      for (int h = 0; h < hands; ++h) {
        action_ev[h] = compat[h] > 0.0f ? child_values[actor][h] / compat[h] : 0.0f;
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
        forked_values[static_cast<std::size_t>(c)] = visit(node.first_child + k, cr);
      });
      for (std::uint16_t k = 0; k < actions; ++k) {
        fold_child(k, forked_values[static_cast<std::size_t>(k)]);
      }
    } else {
      for (std::uint16_t k = 0; k < actions; ++k) {
        for (int h = 0; h < hands; ++h) {
          reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
        }
        auto child_values = visit(node.first_child + k, reach);
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
    for (int s = 0; s < seats; ++s) {
      // Always WRITTEN, even with no vectorized terminal to fill it from: the
      // store is not zeroed, and the writer downstream reads every hand. Zero
      // is the honest value when there is no EV to report.
      float* const ev = data.ev_cond(s);
      std::fill_n(ev, game.num_hands(s), 0.0f);
      if (!with_ev) continue;
      std::vector<float> compat_s;
      game.compat_weights(s, reach, compat_s);
      for (int h = 0; h < game.num_hands(s); ++h) {
        if (compat_s[h] > 0.0f) ev[h] = values[s][h] / compat_s[h];
      }
    }
    return values;
  }
};

// Decision nodes encoded per window while the blobs are written out. Fixed
// rather than scaled by the thread count so the memory estimator, which does
// not know the count, can charge for it exactly.
constexpr std::size_t kExportWindowNodes = 4096;

// The store itself: the float buffer and its offset table, both allocated
// before the pass starts and released together when write_artifact returns.
// Exact - it is the same ExportSizing the allocation is made from.
std::size_t export_store_bytes(const ExportSizing& sizing) {
  return sizing.floats * sizeof(float) + (sizing.decisions + 1) * sizeof(std::size_t);
}

// The encode window alive beside the store while the blobs are written: one
// reused buffer per node of the window, each charged at the largest blob any
// node can encode to. A ceiling - a blob keeps only the hands that reach its
// node - and the one place a heap block is still counted, because these are
// real blocks (at most kExportWindowNodes of them).
std::size_t export_window_bytes(const ExportSizing& sizing) {
  return std::min(sizing.decisions, kExportWindowNodes) *
         (sizing.max_blob + sizeof(std::vector<std::uint8_t>) + kHeapBlockOverhead);
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

// Writes little-endian primitives straight into a buffer that is already the
// right size. encode_node_blob knows a blob's exact length before its first
// byte, so there is no growth to manage and nothing to check per value; the
// one check is at the end, that the cursor landed exactly on the last byte.
struct BlobCursor {
  std::uint8_t* p;
  template <typename T>
  void put(T value) {
    static_assert(std::is_trivially_copyable_v<T>);
    std::memcpy(p, &value, sizeof(T));
    p += sizeof(T);
  }
  void put_ev(float value, bool f16) {
    if (f16) put<std::uint16_t>(fmt::float_to_half(value));
    else put<float>(value);
  }
};

// Sparse per-node blob for one decision node; layout documented in
// docs/artifact-format.md. Encodes into `blob`, REPLACING its contents and
// reusing its capacity, so the caller can hand the same buffers back window
// after window instead of allocating one per node.
void encode_node_blob(const Game& game, const Node& node, const NodeSlice<const float>& data,
                      const std::vector<std::vector<std::uint16_t>>& dicts, bool strategy_u8,
                      bool ev_f16, bool rollups, std::vector<std::uint8_t>& blob) {
  const int seats = game.num_seats();
  const int actor = node.actor;
  const std::uint16_t actions = node.num_children;

  // Sparse index per seat: hands with node reach above the epsilon. A solver
  // hand index IS its position in the seat's dictionary - the dictionary is
  // the hand universe in hand order - so no remapping is needed.
  std::vector<std::vector<int>> kept(seats);
  for (int s = 0; s < seats; ++s) {
    for (int h = 0; h < game.num_hands(s); ++h) {
      if (data.reach(s)[h] > fmt::kSparseEps) kept[s].push_back(h);
    }
  }

  // The blob's exact size, from the layout below.
  const std::size_t ev_size = ev_f16 ? sizeof(std::uint16_t) : sizeof(float);
  std::size_t blob_bytes = 8 + static_cast<std::size_t>(seats) * sizeof(std::uint32_t);
  for (int s = 0; s < seats; ++s) {
    blob_bytes += kept[s].size() * (sizeof(std::uint32_t) + sizeof(float) + ev_size);
  }
  blob_bytes += kept[actor].size() * actions *
                ((strategy_u8 ? sizeof(std::uint8_t) : sizeof(float)) + ev_size);
  if (rollups) {
    blob_bytes += static_cast<std::size_t>(kNumHandClasses) *
                  (2 * sizeof(float) + actions * sizeof(std::uint16_t));
  }

  blob.resize(blob_bytes);
  BlobCursor cur{blob.data()};
  cur.put<std::uint16_t>(static_cast<std::uint16_t>(seats));
  cur.put<std::uint16_t>(actions);
  cur.put<std::uint16_t>(static_cast<std::uint16_t>(actor));
  cur.put<std::uint16_t>(0);  // reserved
  for (int s = 0; s < seats; ++s) {
    cur.put<std::uint32_t>(static_cast<std::uint32_t>(kept[s].size()));
  }
  for (int s = 0; s < seats; ++s) {
    for (int h : kept[s]) cur.put<std::uint32_t>(static_cast<std::uint32_t>(h));
    for (int h : kept[s]) cur.put<float>(data.reach(s)[h]);
    for (int h : kept[s]) cur.put_ev(data.ev_cond(s)[h], ev_f16);
  }
  // Actor strategy rows (renormalized on read) and per-action EVs.
  for (int h : kept[actor]) {
    for (std::uint16_t k = 0; k < actions; ++k) {
      const float p = data.strategy()[static_cast<std::size_t>(h) * actions + k];
      if (strategy_u8) {
        cur.put<std::uint8_t>(static_cast<std::uint8_t>(
                                         std::lround(std::clamp(p, 0.0f, 1.0f) * 255.0f)));
      } else {
        cur.put<float>(p);
      }
    }
  }
  for (int h : kept[actor]) {
    for (std::uint16_t k = 0; k < actions; ++k) {
      cur.put_ev(data.action_ev(k)[h], ev_f16);
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
      const double w = data.reach(actor)[h];
      ++plain_count[cls];
      weight[cls] += w;
      ev_sum[cls] += w * data.ev_cond(actor)[h];
      for (std::uint16_t k = 0; k < actions; ++k) {
        const double p = data.strategy()[static_cast<std::size_t>(h) * actions + k];
        freq_sum[cls][k] += w * p;
        freq_plain[cls][k] += p;
      }
    }
    for (int cls = 0; cls < kNumHandClasses; ++cls) {
      cur.put<float>(static_cast<float>(weight[cls]));
      cur.put<float>(weight[cls] > 0.0
                                ? static_cast<float>(ev_sum[cls] / weight[cls])
                                : 0.0f);
      for (std::uint16_t k = 0; k < actions; ++k) {
        double freq = 0.0;
        if (weight[cls] > 0.0) freq = freq_sum[cls][k] / weight[cls];
        else if (plain_count[cls] > 0) freq = freq_plain[cls][k] / plain_count[cls];
        cur.put<std::uint16_t>(static_cast<std::uint16_t>(std::lround(freq * 10000.0)));
      }
    }
  }
  if (cur.p != blob.data() + blob.size()) {
    throw std::logic_error("node blob size drifted from its layout");
  }
}

void pad_to(ArtifactStore& store, std::uint64_t alignment) {
  static const std::uint8_t zeros[64] = {};
  const std::uint64_t pos = store.tell();
  const std::uint64_t rem = pos % alignment;
  if (rem != 0) store.write(zeros, static_cast<std::size_t>(alignment - rem));
}

}  // namespace

std::size_t export_pass_bytes(const Game& game) {
  const ExportSizing sizing = size_export(game, nullptr);
  return export_store_bytes(sizing) + export_window_bytes(sizing);
}

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
  const bool bucketed = config.export_bucketed;
  // A bucketed artifact carries no rollup block: the reader recomputes the
  // rollup from the expanded rows and the derived reach (the spec's rule
  // that rollups are derived data).
  const bool rollups = config.rollups_169 && nlhe && !bucketed;
  const bool strategy_u8 = config.strategy_quantize_u8;
  const bool ev_f16 = !config.ev_float32;
  const InfosetIndexer* indexer = bucketed ? source.bucket_indexer() : nullptr;
  if (bucketed && (indexer == nullptr || indexer->mode != InfosetIndexer::Mode::Abstraction)) {
    throw std::runtime_error("output.export \"bucketed\" needs a solver core storing rows per "
                             "bucket (algorithm.sampled.abstraction)");
  }

  // Export pass under the average strategy - the per-hand export only. The
  // bucketed export writes straight from the solver's rows and holds no
  // per-node records at all, which is the whole reason it exists.
  ExportPass pass{game, source, ExportStore{}};
  if (!bucketed) {
    pass.store.allocate(game);
    std::vector<std::vector<float>> reach(game.num_seats());
    for (int s = 0; s < game.num_seats(); ++s) reach[s] = game.initial_range(s);
    // Same fork rule the solver uses, so the export saturates the same pool
    // rather than inventing its own policy.
    pass.plan = ForkPlan(game, source.pool().threads());
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
  if (bucketed) flags |= fmt::kFlagBucketed;

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

  // Bucketed export: the bucket map and the root reach, then one blob per
  // storage GROUP. Layout in docs/artifact-format.md.
  json bucket_map_meta = nullptr;
  json root_reach_meta = nullptr;
  if (bucketed) {
    const InfosetIndexer& ix = *indexer;
    pad_to(store, 8);
    const std::uint64_t off = store.tell();
    std::vector<std::uint8_t> bytes;
    fmt::put<std::uint32_t>(bytes, ix.num_maps);
    fmt::put<std::uint32_t>(bytes, ix.num_hands);
    for (std::uint16_t v : ix.map_storage) fmt::put<std::uint16_t>(bytes, v);
    fmt::put<std::uint32_t>(bytes, ix.num_groups);
    for (std::uint32_t g = 0; g < ix.num_groups; ++g) {
      fmt::put<std::uint32_t>(bytes, ix.rows(ix.group_rep[g]));
    }
    fmt::put<std::uint32_t>(bytes, tree.num_decision_nodes);
    for (std::uint32_t d = 0; d < tree.num_decision_nodes; ++d) {
      fmt::put<std::uint32_t>(bytes, ix.group(d));
      fmt::put<std::uint32_t>(bytes, ix.map_of[d]);
    }
    store.write(bytes.data(), bytes.size());
    bucket_map_meta = {{"offset", off},
                       {"length", store.tell() - off},
                       {"maps", ix.num_maps},
                       {"hands", ix.num_hands},
                       {"groups", ix.num_groups},
                       {"decision_count", tree.num_decision_nodes}};

    pad_to(store, 8);
    const std::uint64_t roff = store.tell();
    std::vector<std::uint8_t> rbytes;
    fmt::put<std::uint32_t>(rbytes, static_cast<std::uint32_t>(game.num_seats()));
    fmt::put<std::uint32_t>(rbytes, ix.num_hands);
    for (int s = 0; s < game.num_seats(); ++s) {
      const std::vector<float>& range = game.initial_range(s);
      for (std::uint32_t h = 0; h < ix.num_hands; ++h) {
        fmt::put<float>(rbytes, h < range.size() ? range[h] : 0.0f);
      }
    }
    store.write(rbytes.data(), rbytes.size());
    root_reach_meta = {{"offset", roff},
                       {"length", store.tell() - roff},
                       {"seats", game.num_seats()},
                       {"hands", ix.num_hands}};
  }

  // Node blobs, collecting the index: one per decision node (keyed by node
  // id) in the per-hand export, one per storage group (keyed by group id)
  // in the bucketed one.
  struct IndexEntry {
    std::uint32_t node_id;
    std::uint64_t offset;
    std::uint64_t length;
  };
  std::vector<IndexEntry> index;
  if (bucketed) {
    const InfosetIndexer& ix = *indexer;
    std::vector<NodeId> node_of_decision(tree.num_decision_nodes);
    for (NodeId id = 0; id < tree.size(); ++id) {
      if (tree[id].kind == NodeKind::Decision) node_of_decision[tree[id].decision_index] = id;
    }
    std::vector<float> rows;
    std::vector<std::uint8_t> blob;
    for (std::uint32_t g = 0; g < ix.num_groups; ++g) {
      const Node& rep = tree[node_of_decision[ix.group_rep[g]]];
      const std::uint32_t nrows = ix.rows(ix.group_rep[g]);
      source.bucket_strategy(g, rows);
      blob.clear();
      fmt::put<std::uint16_t>(blob, static_cast<std::uint16_t>(game.num_seats()));
      fmt::put<std::uint16_t>(blob, rep.num_children);
      fmt::put<std::uint16_t>(blob, rep.actor);
      fmt::put<std::uint16_t>(blob, 1);  // bucketed blob marker
      fmt::put<std::uint32_t>(blob, nrows);
      for (std::size_t i = 0; i < rows.size(); ++i) {
        if (strategy_u8) {
          fmt::put<std::uint8_t>(blob, static_cast<std::uint8_t>(std::lround(
                                           std::clamp(rows[i], 0.0f, 1.0f) * 255.0f)));
        } else {
          fmt::put<float>(blob, rows[i]);
        }
      }
      pad_to(store, 64);
      const std::uint64_t off = store.tell();
      store.write(blob.data(), blob.size());
      index.push_back({g, off, blob.size()});
    }
  } else {
    // Encode across the pool, write in node order. A blob is a pure function
    // of its own node's slice, so a window of nodes encodes concurrently and
    // is then written out serially - the file is byte for byte what a serial
    // loop writes (the committed fixture and tests/test_parallel.cpp hold it
    // to that). Encoding one node at a time on one core was most of the
    // export on a flop tree.
    //
    // The window's buffers are allocated once and refilled. That was measured
    // while the store was still a heap block per section (hh_small, 312092
    // decision nodes, 40 threads; the encode phase alone):
    //   a fresh buffer per node, records released as encoded   7.0 s
    //   the window's buffers reused, records still released    5.0 s
    //   buffers reused, records left for the end               0.6 s
    // The heap is what does not scale. The store is one allocation now, so
    // there is nothing per node to release and the question of when no longer
    // comes up; reusing the buffers is the half of that lesson still in
    // force. The window is extra memory at the export's high-water mark, and
    // export_pass_bytes counts it.
    std::vector<NodeId> decisions;
    decisions.reserve(tree.num_decision_nodes);
    for (NodeId id = 0; id < tree.size(); ++id) {
      if (tree[id].kind == NodeKind::Decision) decisions.push_back(id);
    }
    ThreadPool& pool = source.pool();
    const ExportStore& filled = pass.store;  // read-only from here on
    constexpr std::size_t kNodesPerTask = 16;
    const std::size_t window = std::min(decisions.size(), kExportWindowNodes);
    std::vector<std::vector<std::uint8_t>> blobs(window);
    index.reserve(decisions.size());
    for (std::size_t begin = 0; begin < decisions.size(); begin += window) {
      const std::size_t count = std::min(window, decisions.size() - begin);
      const int tasks = static_cast<int>((count + kNodesPerTask - 1) / kNodesPerTask);
      pool.parallel_for(tasks, [&](int t) {
        const std::size_t lo = static_cast<std::size_t>(t) * kNodesPerTask;
        const std::size_t hi = std::min(count, lo + kNodesPerTask);
        for (std::size_t i = lo; i < hi; ++i) {
          const Node& node = tree[decisions[begin + i]];
          encode_node_blob(game, node, filled.slice(game, node), dicts, strategy_u8, ev_f16,
                           rollups, blobs[i]);
        }
      });
      for (std::size_t i = 0; i < count; ++i) {
        pad_to(store, 64);
        const std::uint64_t off = store.tell();
        store.write(blobs[i].data(), blobs[i].size());
        index.push_back({decisions[begin + i], off, blobs[i].size()});
      }
    }
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
  meta["solver_version"] = kSolverVersion;
  // Static across builds; engine_build is what tells two builds apart.
  meta["engine_build"] = engine_build_id();
  meta["format_version"] = fmt::kFormatVersion;
  meta["config_hash"] = config_hash(config);
  // The spot's identity - what a checkpoint refuses to continue across. With
  // solve_id below it lets a consumer tell "the same lineage, further along"
  // from "a different spot that reused the id".
  meta["solve_key"] = config_solve_key(config);
  meta["config"] = config.raw;
  meta["game"] = config.game;
  // "nash" | "qre". Downstream refusals key off this: the Pio harness will not
  // rate a QRE solve against Pio, and the solutions exporter will not publish
  // one. Both are correct - a QRE deliberately is not a Nash equilibrium.
  meta["mode"] = config.qre_mode;
  meta["solver_family"] = config.sampled.enabled ? "sampled" : "vectorized";
  meta["sampled"] =
      config.sampled.enabled
          ? json({{"seed", config.sampled.seed},
                  {"batch", config.sampled.batch},
                  {"lanes", config.sampled.lanes},
                  {"hero", config.sampled.hero == HeroMode::Pinned ? "pinned" : "vectorized"},
                  {"update",
                   config.sampled.update == UpdateScheme::External ? "external" : "chance"},
                  {"deal", config.sampled.range_deal ? "range" : "uniform"},
                  {"ev_deals", stats.ev_deals}})
          : json(nullptr);

  meta["lambda"] = config.qre.enabled ? json(config.qre.lambda) : json(nullptr);
  meta["iterations"] = stats.iterations;
  meta["final_nashconv"] = stats.nashconv;
  // Pio-comparable convergence: per-player "exploitable for", in chips and
  // as a percent of the root pot. Null for a team solve: best response
  // against per-seat marginals cannot rate a correlated joint strategy, so
  // there is no honest nashconv to print.
  if (stats.nashconv_valid) {
    const double exploitable_chips = stats.nashconv / game.num_seats();
    meta["final_exploitable_chips"] = exploitable_chips;
    meta["final_exploitable_pct_pot"] =
        config.pot > 0
            ? json(exploitable_chips / static_cast<double>(config.pot) * 100.0)
            : json(nullptr);
  } else {
    meta["final_nashconv"] = nullptr;
    meta["final_exploitable_chips"] = nullptr;
    meta["final_exploitable_pct_pot"] = nullptr;
  }
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
  // The convergence trace: every checkpoint this run measured, as parallel
  // arrays (an array of objects costs ~40 more bytes per point). Thinned to
  // at most kMaxConvergencePoints by a fixed stride that always keeps the
  // LAST point, so the final entry is the final checkpoint whatever the
  // stride; `total_points` and `stride` say what was dropped. Times rounded
  // to a millisecond and chips to a micro-chip so 2000 points stay under
  // ~100 KB. Absent on a team solve (no best response) and on artifacts from
  // before it existed - additive, like every key here.
  if (!stats.convergence.empty()) {
    constexpr std::size_t kMaxConvergencePoints = 2000;
    const std::size_t total = stats.convergence.size();
    const std::size_t stride = (total + kMaxConvergencePoints - 1) / kMaxConvergencePoints;
    const auto round_to = [](double v, double unit) { return std::round(v / unit) * unit; };
    json iteration = json::array(), elapsed = json::array(), solve = json::array(),
         nashconv = json::array(), exploitable = json::array();
    for (std::size_t i = 0; i < total; ++i) {
      if (i % stride != 0 && i + 1 != total) continue;
      const ConvergencePoint& p = stats.convergence[i];
      iteration.push_back(p.iteration);
      elapsed.push_back(round_to(p.elapsed_s, 1e-3));
      solve.push_back(round_to(p.solve_s, 1e-3));
      nashconv.push_back(round_to(p.nashconv, 1e-6));
      exploitable.push_back(round_to(p.exploitable_chips, 1e-6));
    }
    const std::size_t points = iteration.size();
    meta["convergence"] = {{"iteration", std::move(iteration)},
                           {"elapsed_s", std::move(elapsed)},
                           {"solve_s", std::move(solve)},
                           {"nashconv", std::move(nashconv)},
                           {"exploitable_chips", std::move(exploitable)},
                           {"points", points},
                           {"total_points", total},
                           {"stride", stride}};
  }


  // Root EVs come from the sampled pass on sampled-family solves (each
  // deal's payoffs sum to the pot, so they conserve exactly); the
  // vectorized family keeps its best-response EVs.
  meta["root_ev_estimator"] = config.sampled.enabled ? "sampled_deals" : "best_response";
  // The lineage, not this run: two artifacts sharing it are the same solve at
  // different iteration counts.
  if (!stats.solve_id.empty()) meta["solve_id"] = stats.solve_id;
  // Present only on a solve that ended early, so its absence keeps meaning
  // "ran the budget it was given".
  if (!stats.stopped_reason.empty()) {
    meta["stopped_reason"] = stats.stopped_reason;
    meta["requested_iterations"] = config.iterations;
  }
  // What "solved" means for this artifact, in one place: why the loop
  // ended, what it was asked to reach, and the LAST exploitability actually
  // measured (with where on the clock it was measured). Null measurements
  // where none is possible (teams, 4+ seats). A reader that wants the
  // whole curve has metadata.convergence.
  {
    json solved;
    solved["stopped_reason"] =
        stats.stopped_reason.empty() ? json("budget") : json(stats.stopped_reason);
    solved["target_exploitable_pct"] =
        stats.target_exploitable_pct > 0.0 ? json(stats.target_exploitable_pct) : json(nullptr);
    if (stats.nashconv_valid && !stats.convergence.empty()) {
      const ConvergencePoint& last = stats.convergence.back();
      const double pct = config.pot > 0 ? last.exploitable_chips /
                                              static_cast<double>(config.pot) * 100.0
                                        : 0.0;
      solved["last_exploitable_chips"] = last.exploitable_chips;
      solved["last_exploitable_pct_pot"] = config.pot > 0 ? json(pct) : json(nullptr);
      solved["measured_at_iteration"] = last.iteration;
      solved["measured_at_solve_s"] = last.solve_s;
      solved["reached"] = stats.target_exploitable_pct > 0.0 && config.pot > 0 &&
                          pct <= stats.target_exploitable_pct;
    } else {
      solved["last_exploitable_chips"] = nullptr;
      solved["last_exploitable_pct_pot"] = nullptr;
      solved["measured_at_iteration"] = nullptr;
      solved["measured_at_solve_s"] = nullptr;
      solved["reached"] = nullptr;
    }
    meta["solved"] = std::move(solved);
  }
  if (!config.partition.empty()) {
    meta["partition"] = config.partition;
  } else {
    json partition = json::array();
    for (int s = 0; s < game.num_seats(); ++s) partition.push_back(json::array({s}));
    meta["partition"] = std::move(partition);
  }
  meta["payoff_weights"] = nullptr;
  meta["collusion"] = {{"mode", "none"}, {"p", nullptr}};
  if (!stats.team_seats.empty()) {
    json team;
    team["seats"] = stats.team_seats;
    team["awareness"] = stats.awareness;
    double team_ev = 0.0;
    for (int q : stats.team_seats) team_ev += stats.ev_chips[static_cast<std::size_t>(q)];
    team["ev_chips"] = team_ev;
    if (!stats.baseline_ev_chips.empty()) {
      team["baseline_ev_chips"] = stats.baseline_ev_chips;
      team["baseline_iterations"] = stats.baseline_iterations;
      double base_team = 0.0;
      for (int q : stats.team_seats) {
        base_team += stats.baseline_ev_chips[static_cast<std::size_t>(q)];
      }
      team["baseline_team_ev_chips"] = base_team;
      team["uplift_chips"] = team_ev - base_team;
    }
    if (!stats.baseline_solve_id.empty()) team["baseline_solve_id"] = stats.baseline_solve_id;
    // The per-hand strategy blobs and rollups are MARGINALS over the
    // partner; the conditioned chart is team_rollup.
    team["strategy_export"] = "marginal_over_partner";
    meta["team"] = std::move(team);
    meta["team_rollup"] = stats.team_rollup;
    // The exact joint rows the rollup was marginalized from, keyed by real
    // cards. Additive metadata, so no format bump; absent on artifacts from
    // before it existed.
    if (!stats.team_joint.empty()) meta["team_joint"] = stats.team_joint;
  } else {
    meta["team"] = nullptr;
  }
  // CFR has no Nash guarantee with 3+ players (it converges to the coarse
  // correlated equilibrium set); flagged here so downstream consumers can
  // surface it.
  meta["multiway_no_nash_guarantee"] = game.num_seats() > 2;
  // Whether the per-hand `ev` / `action_ev` fields in the node blobs mean
  // anything. Without a vectorized terminal there is no per-hand value to
  // carry up, so the export leaves those columns at zero (see visit()) - and
  // a zero that is indistinguishable from a real EV is worse than no number
  // at all. Stated here so a reader can drop the columns rather than having
  // to infer the rule from the seat count.
  // A bucketed artifact carries no EV columns at all, whatever the seat
  // count; the reader zero-fills them and this says so.
  meta["per_hand_ev"] = game.vectorized_terminals() && !bucketed;
  // Hand abstraction, when the sampled core solved per bucket. The blobs
  // are still per hand (average_strategy expands through the bucket map),
  // and hands sharing a bucket carry identical rows; this says which hands
  // those were and how the buckets were formed. Absent = solved per hand.
  {
    const InfosetIndexer* ix = source.bucket_indexer();
    meta["hand_abstraction"] = ix != nullptr && ix->mode == InfosetIndexer::Mode::Abstraction;
  }
  if (!stats.abstraction.empty()) meta["abstraction"] = stats.abstraction;
  meta["export"] = config.export_bucketed ? "bucketed" : "per_hand";
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
    // Named rather than described so a consumer can tell artifacts written
    // under different removal rules apart. The sampled core deals concrete
    // cards, so removal between every pair of seats is exact in expectation;
    // the vectorized preflop estimator applies first-order pairwise
    // inclusion-exclusion (exact at 2-3 seats, first-order at 4+). Either
    // way the export pass's per-hand reach/EV fields ride the factorized
    // evaluator, and export_ev_estimator says so.
    meta["opponent_card_removal"] =
        config.sampled.enabled ? "exact_sampled" : "pairwise_mass";
    // The suit quotient is a lossless relabeling, not abstraction - but a
    // consumer deciding how to render per-combo data deserves to know that
    // members of a class are identical by construction.
    meta["hand_symmetry"] = config.sampled.enabled && config.sampled.symmetry
                                ? "suit_classes_169"
                                : "none";
    meta["export_ev_estimator"] = "factorized_first_order";
  }
  meta["sections"] = {
      {"node_table",
       {{"offset", node_table_off},
        {"length", node_table_len},
        {"record_size", fmt::kNodeRecordSize},
        {"count", tree.size()}}},
      {"hand_dicts", dict_meta}};
  if (bucketed) {
    meta["sections"]["bucket_map"] = bucket_map_meta;
    meta["sections"]["root_reach"] = root_reach_meta;
  }

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
