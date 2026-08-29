#include "solver/cfr.hpp"

#include "solver/memory.hpp"  // kHeapBlockOverhead
#include "solver/sample.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <utility>
#include <vector>

// __restrict is spelled the same on MSVC, clang-cl, Clang and GCC, which is
// every compiler this project targets; the fallback keeps it portable anyway.
#if defined(_MSC_VER) || defined(__GNUC__) || defined(__clang__)
#define ENGINE_RESTRICT __restrict
#else
#define ENGINE_RESTRICT
#endif

namespace engine {

namespace {
// Scratch slot ids per recursion level.
constexpr int kSlotSigma = 0;
constexpr int kSlotChild = 1;
// One hands-wide buffer reused twice per decision node: first the
// regret-matching row sums, then the strategy-averaging reach weights.
// They never overlap in time, and an arena slot is not free.
constexpr int kSlotHandScratch = 2;
// Compatible-opponent-reach pi(h) at an actor decision node. Only allocated
// work when QRE is on; the slot exists unconditionally so the arena sizing
// (and memory.cpp's per_level term) does not depend on a runtime flag.
constexpr int kSlotCompat = 3;
constexpr int kSlotSavedBase = 4;  // + seat index
constexpr int kSlotsPerLevel = kSlotSavedBase + kMaxSeats;
// There is deliberately no per-level "value" slot: an actor decision node
// accumulates its node value directly into the caller's `out` buffer, so the
// slot it used to need is gone. Keep memory.cpp's per_level term in step.

// Forking below this many children is not worth a reach-vector copy per
// child; the pool would spend more on hand-off than the subtree costs.
constexpr int kMinSplitChildren = 2;

// Regret matching, action-major in and out. `sums` is scratch of length
// `hands`.
//
// The per-hand total is accumulated in ascending action order and the
// normalization is a division rather than a multiply by the reciprocal -
// both deliberately, because 1/s then x*(1/s) is not the same float as x/s
// and this has to stay bit-for-bit what the hand-major version produced.
void regret_matched_action_major(const float* regrets, std::uint32_t hands,
                                 std::uint16_t actions, float* out, float* sums) {
  for (std::uint32_t h = 0; h < hands; ++h) sums[h] = 0.0f;
  for (std::uint16_t k = 0; k < actions; ++k) {
    const float* r = regrets + static_cast<std::size_t>(k) * hands;
    float* col = out + static_cast<std::size_t>(k) * hands;
    for (std::uint32_t h = 0; h < hands; ++h) {
      const float p = r[h] > 0.0f ? r[h] : 0.0f;
      col[h] = p;
      sums[h] += p;
    }
  }
  const float uniform = 1.0f / static_cast<float>(actions);
  for (std::uint16_t k = 0; k < actions; ++k) {
    float* col = out + static_cast<std::size_t>(k) * hands;
    for (std::uint32_t h = 0; h < hands; ++h) {
      col[h] = sums[h] > 0.0f ? col[h] / sums[h] : uniform;
    }
  }
}

// Hand-major row for one hand, read out of action-major storage. Cold path
// (export + best response), so the strided reads are fine.
void row_from_action_major(const float* values, std::uint32_t hands, std::uint16_t actions,
                           std::uint32_t hand, bool positive_part, float* row) {
  float sum = 0.0f;
  for (std::uint16_t k = 0; k < actions; ++k) {
    float v = values[static_cast<std::size_t>(k) * hands + hand];
    if (positive_part && v < 0.0f) v = 0.0f;
    row[k] = v;
    sum += v;
  }
  if (sum > 0.0f) {
    for (std::uint16_t k = 0; k < actions; ++k) row[k] /= sum;
  } else {
    const float u = 1.0f / static_cast<float>(actions);
    for (std::uint16_t k = 0; k < actions; ++k) row[k] = u;
  }
}

// The update and fold-in loops below take raw restrict-qualified pointers and their
// loop invariants BY VALUE, and that shape is the point rather than a style
// choice. As lambdas capturing std::vector references they compiled fully
// scalar: the compiler could not prove the five arrays disjoint, and every
// invariant was re-loaded through the capture block on each element.
// regret_matched_action_major above vectorizes precisely because it takes
// three plain float* parameters - the difference is pointer provenance, not
// arithmetic.
//
// The disjointness restrict promises, which the compiler cannot check:
// `out` at depth d is the CALLER's buffer - the parent's kSlotChild at depth
// d-1, a parent-owned forked_out[c], or iterate()'s local `values`. It is
// never an arena slot at depth d and never inside regrets_. `regret_col`
// points into regrets_; `sigma_col` and `c` are depth-d arena slots
// (kSlotSigma, kSlotCompat); `child_vals` is the depth-d kSlotChild or a
// forked buffer. All five are distinct allocations. See the aliasing note in
// traverse_impl for the same argument spelled out.
// The end-of-node update, fused so regrets and strategy sums are walked once
// between them rather than once each. Templated on the clamp rather than
// branching inside, for the same reason the clamp was hoisted originally:
// two branch-free bodies vectorize, one predicated body does not.
template <bool Clamp>
void update_row_f32(float* ENGINE_RESTRICT regret_col, float* ENGINE_RESTRICT strat_col,
                    const float* ENGINE_RESTRICT sigma_col, const float* ENGINE_RESTRICT out,
                    const float* ENGINE_RESTRICT rw, std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float r = regret_col[h] - out[h];
    // `r < 0 ? 0 : r` rather than std::max, which keeps -0.0f as -0.0f.
    regret_col[h] = Clamp ? (r < 0.0f ? 0.0f : r) : r;
    strat_col[h] += rw[h] * sigma_col[h];
  }
}

// The u16 path, split in two rather than fused. Fusing them (one loop doing
// the f32 regret update and the u16 accumulate together) compiles fully
// SCALAR on MSVC - dumpbin shows zero packed ymm ops against the f32
// version's seven - because the mixed output widths defeat the vectorizer.
// Splitting lets the regret half keep the same vector code the f32 path has.
template <bool Clamp>
void update_regret_row(float* ENGINE_RESTRICT regret_col, const float* ENGINE_RESTRICT out,
                       std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float r = regret_col[h] - out[h];
    regret_col[h] = Clamp ? (r < 0.0f ? 0.0f : r) : r;
  }
}

// The caller has already guaranteed via strat_reserve_headroom that q plus
// the largest possible addition stays inside the range, which is what keeps
// this loop free of any per-cell overflow check.
// `rw` arrives PRE-SCALED by 1/scale: the caller folds it into the hands-wide
// buffer once per node rather than once per cell, which is `actions - 1`
// multiplies per hand saved and matches how the QRE transform already folds
// its own per-node constant into the compat buffer.
void strat_accum_q16(std::uint16_t* ENGINE_RESTRICT q_col, const float* ENGINE_RESTRICT sigma_col,
                     const float* ENGINE_RESTRICT rw_scaled, std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    // Both factors are non-negative, so the +0.5f truncation is a correct
    // round-to-nearest and cannot go below zero.
    const float d = rw_scaled[h] * sigma_col[h] + 0.5f;
    q_col[h] = static_cast<std::uint16_t>(q_col[h] + static_cast<unsigned>(d));
  }
}

void plain_fold_in(float* ENGINE_RESTRICT out, float* ENGINE_RESTRICT regret_col,
                   const float* ENGINE_RESTRICT sigma_col,
                   const float* ENGINE_RESTRICT child_vals, std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    out[h] += sigma_col[h] * child_vals[h];
    // Defer subtracting v(h): R += cv now, R -= v after the action loop.
    regret_col[h] += child_vals[h];
  }
}

// The QRE reward transformation, per (hand, action). `c[h]` already carries
// max(pi(h), 0) / lambda, folded once per node rather than once per cell.
void qre_fold_in(float* ENGINE_RESTRICT out, float* ENGINE_RESTRICT regret_col,
                 const float* ENGINE_RESTRICT sigma_col,
                 const float* ENGINE_RESTRICT child_vals,
                 const float* ENGINE_RESTRICT c, std::uint32_t hands,
                 float prob_floor, float log_actions) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    // The floor keeps log() finite - sigma is exactly 0 for any action whose
    // cumulative regret is non-positive - and a hand the opponent cannot hold
    // has c[h] == 0 and is charged nothing.
    //
    // This unconditional max-then-log is the FASTEST of five formulations
    // measured; see docs/roadmap.md M7 for the four that lost. In particular
    // do not "optimize" the shared log(prob_floor) out with a branch, and do
    // not replace std::log with a vendored polynomial - both were tried and
    // both are slower.
    const float sp = sigma_col[h] > prob_floor ? sigma_col[h] : prob_floor;
    const float v = child_vals[h] - c[h] * (std::log(sp) + log_actions);
    out[h] += sigma_col[h] * v;
    regret_col[h] += v;
  }
}

// Chunk a flat elementwise pass so the pool has something worth handing out.
constexpr std::size_t kDiscountChunk = 1u << 16;
}  // namespace

int max_live_arenas(int threads) {
  const int t = std::max(1, threads);
  if (t <= 1) return 1;
  // One arena per worker per fork level - a worker that helps with a nested
  // batch while waiting on its own holds one lease per level - plus the
  // traversal the calling thread started.
  return t * (kMaxSplitLevels + 1) + 1;
}

InfosetLayout InfosetLayout::build(const Game& game) {
  const PublicTree& tree = game.tree();
  InfosetLayout layout;
  layout.node_offset.resize(tree.num_decision_nodes);
  layout.node_hands.resize(tree.num_decision_nodes);
  layout.node_actions.resize(tree.num_decision_nodes);
  std::size_t offset = 0;
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& n = tree[id];
    if (n.kind != NodeKind::Decision) continue;
    if (game.iso_rep(id).rep != id) {
      // Member of a suit-isomorphic subtree: reads redirect to the rep.
      layout.node_offset[n.decision_index] = kNoOffset;
      layout.node_hands[n.decision_index] = 0;
      layout.node_actions[n.decision_index] = n.num_children;
      continue;
    }
    const std::uint32_t hands = static_cast<std::uint32_t>(game.num_hands(n.actor));
    layout.node_offset[n.decision_index] = offset;
    layout.node_hands[n.decision_index] = hands;
    layout.node_actions[n.decision_index] = n.num_children;
    offset += static_cast<std::size_t>(hands) * n.num_children;  // action-major
  }
  layout.total = offset;
  return layout;
}

CfrSolver::CfrSolver(const Game& game, UpdateConfig update, int threads, RecalcConfig recalc,
                     SamplingConfig sampling, QreConfig qre)
    : game_(game), update_(update), qre_(std::move(qre)), layout_(InfosetLayout::build(game)),
      recalc_config_(recalc), sampling_(sampling) {
  // A QRE solve needs one lambda per seat. Defaulting a missing entry would
  // silently solve a different game than the config asked for.
  if (qre_.enabled &&
      qre_.lambda.size() != static_cast<std::size_t>(game.num_seats())) {
    throw std::runtime_error("QreConfig::lambda must have one entry per seat");
  }
  // Sampling and the recalc schedule cannot both run: the cache holds
  // full-enumeration values while a sampled iteration produces n/m-scaled
  // ones, and recalc's movement metric would be reading sampling noise.
  // config.cpp rejects the combination; this is the belt-and-braces copy so
  // a programmatic caller cannot construct the broken pairing.
  if (sampling_.enabled) recalc_config_.enabled = false;
  regrets_.assign(layout_.total, 0.0f);
  if (update_.precision == Precision::I16) {
    strat_q_.assign(layout_.total, 0);
    strat_scale_.assign(layout_.node_offset.size(), 1.0f);
    strat_bound_.assign(layout_.node_offset.size(), 0.0f);
  } else {
    strat_sum_.assign(layout_.total, 0.0f);
  }
  pool_ = std::make_unique<ThreadPool>(resolve_thread_count(threads));
  // Aim for a few subtrees per worker so a slow branch cannot strand the
  // pool; the budget divides among children at each fork, which is what
  // stops the frontier from widening forever.
  split_budget_ = pool_->threads() > 1 ? pool_->threads() * 4 : 1;

  // Arena slots cover the full tree depth. scratch() must never grow an
  // arena mid-traversal: callers hold references into it across recursive
  // calls, and a reallocation would invalidate them.
  const PublicTree& tree = game.tree();
  std::vector<int> depth(tree.size(), 0);
  int max_depth = 0;
  for (NodeId id = 1; id < tree.size(); ++id) {
    depth[id] = depth[tree[id].parent] + 1;
    if (depth[id] > max_depth) max_depth = depth[id];
  }
  arena_slots_ = static_cast<std::size_t>(max_depth + 2) * kSlotsPerLevel;
  discount_stamp_.assign(layout_.node_offset.size(), 0);
  discount_history_.push_back({});  // entry 0 unused; entry t = iteration t's factors

  // Recalc slots: one per chance-node child, contiguous per node. The value
  // caches depend on the opponent reach alone, which only holds with exactly
  // one opponent - gate on 2 seats.
  recalc_on_ = recalc_config_.enabled && game.num_seats() == 2;
  recalc_base_.assign(tree.size(), kNoIndex);
  std::uint32_t slots = 0;
  if (recalc_on_) {
    for (NodeId id = 0; id < tree.size(); ++id) {
      if (tree[id].kind != NodeKind::Chance) continue;
      recalc_base_[id] = slots;
      slots += tree[id].num_children;
    }
  }
  recalc_.resize(slots);
  recalc_aggress_ = static_cast<double>(recalc_config_.margin);

  // Suit-isomorphism fold lists: which member children fold from each rep
  // child, and through which hand gather.
  iso_base_.assign(tree.size(), kNoIndex);
  for (NodeId id = 0; id < tree.size(); ++id) {
    if (tree[id].kind != NodeKind::Chance) continue;
    if (game.iso_rep(id).rep != id) continue;  // inside a member subtree
    const Node& n = tree[id];
    bool any = false;
    std::vector<std::vector<const std::vector<std::uint16_t>*>> per_child(n.num_children);
    for (std::uint16_t c = 0; c < n.num_children; ++c) {
      const NodeId child = n.first_child + c;
      const Game::IsoRef ref = game.iso_rep(child);
      if (ref.rep == child) continue;
      // rep children precede members in child order (rep = lowest card).
      const std::uint16_t rep_index = static_cast<std::uint16_t>(ref.rep - n.first_child);
      per_child[rep_index].push_back(ref.map);
      any = true;
    }
    if (any) {
      iso_base_[id] = static_cast<std::uint32_t>(iso_members_.size());
      for (auto& list : per_child) iso_members_.push_back(std::move(list));
    }
  }
}

std::size_t CfrSolver::state_bytes(const Game& game, Precision precision) {
  const InfosetLayout layout = InfosetLayout::build(game);
  // Regrets, plus the per-node "discount paid at" stamp.
  std::size_t bytes = layout.total * sizeof(float) +
                      layout.node_offset.size() * sizeof(std::uint32_t);
  // Strategy sums: f32 per cell, or u16 per cell plus a per-node scale and
  // range bound. The two per-node floats are counted because the solver
  // allocates them, and at hundreds of thousands of nodes they are not noise.
  if (precision == Precision::I16) {
    bytes += layout.total * sizeof(std::uint16_t) +
             layout.node_offset.size() * 2 * sizeof(float);
  } else {
    bytes += layout.total * sizeof(float);
  }
  return bytes;
}

std::size_t CfrSolver::recalc_state_bytes(const Game& game, bool enabled) {
  const PublicTree& tree = game.tree();
  // recalc_base_ is assigned whether or not the schedule is on.
  std::size_t bytes = tree.size() * sizeof(std::uint32_t);
  if (!enabled || game.num_seats() != 2) return bytes;

  // The slot ARRAY covers every chance node's every child, isomorphic member
  // subtrees included: the constructor indexes it by raw NodeId and does not
  // filter. Only representative children are ever traversed, so only those
  // fill in the four hand-wide vectors - the rest cost one empty struct each,
  // which at hundreds of thousands of slots is still worth counting.
  std::size_t slots = 0;
  std::size_t populated = 0;
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& n = tree[id];
    if (n.kind != NodeKind::Chance) continue;
    slots += n.num_children;
    if (game.iso_rep(id).rep != id) continue;
    for (std::uint16_t c = 0; c < n.num_children; ++c) {
      const NodeId child = n.first_child + c;
      if (game.iso_rep(child).rep == child) ++populated;
    }
  }
  std::size_t hands = 0;
  for (int s = 0; s < game.num_seats(); ++s) {
    hands = std::max(hands, static_cast<std::size_t>(game.num_hands(s)));
  }
  bytes += slots * sizeof(RecalcSlot);
  // Per traversing seat: the cached value vector and the reach snapshot that
  // produced it, both hand-universe wide, each its own heap block.
  bytes += populated * 2 /*seats*/ * 2 /*value + snapshot*/ *
           (hands * sizeof(float) + kHeapBlockOverhead);
  return bytes;
}

CfrSolver::Arena* CfrSolver::acquire_arena() {
  std::lock_guard<std::mutex> lock(arena_mu_);
  if (!free_arenas_.empty()) {
    Arena* arena = free_arenas_.back();
    free_arenas_.pop_back();
    return arena;
  }
  auto arena = std::make_unique<Arena>();
  arena->slots.resize(arena_slots_);
  Arena* raw = arena.get();
  arenas_.push_back(std::move(arena));
  return raw;
}

void CfrSolver::release_arena(Arena* arena) {
  std::lock_guard<std::mutex> lock(arena_mu_);
  free_arenas_.push_back(arena);
}

std::vector<float>& CfrSolver::scratch(Arena& arena, int depth, int slot) {
  const std::size_t idx = static_cast<std::size_t>(depth) * kSlotsPerLevel + slot;
  assert(idx < arena.slots.size());  // pre-sized in the constructor; never grows here
  return arena.slots[idx];
}

void CfrSolver::iterate() {
  ++t_;
  // Annealing lambda changes the game being solved every iteration, so a
  // strategy average spanning the anneal would be an average over DIFFERENT
  // games and the convergence argument would not apply to any of them. Drop
  // it once at the moment lambda reaches its final value; from here on the
  // average is over one fixed game, which is the thing that converges.
  //
  // Deterministic (a pure function of t_) and safe against the deferred
  // discount: a node that has not been visited since the reset still owes its
  // factors, and multiplying zero by them is still zero.
  if (qre_.enabled && qre_.anneal_full_at != 0 && qre_.anneal_factor > 1.0 &&
      t_ == qre_.anneal_full_at) {
    std::fill(strat_sum_.begin(), strat_sum_.end(), 0.0f);
    std::fill(strat_q_.begin(), strat_q_.end(), std::uint16_t{0});
    std::fill(strat_scale_.begin(), strat_scale_.end(), 1.0f);
    std::fill(strat_bound_.begin(), strat_bound_.end(), 0.0f);
  }
  const int seats = game_.num_seats();
  std::vector<std::vector<float>> reach(seats);
  std::vector<float> values;
  ArenaLease arena(*this);
  for (int p = 0; p < seats; ++p) {
    for (int s = 0; s < seats; ++s) reach[s] = game_.initial_range(s);
    traverse_impl(game_.tree().root(), p, 0, reach, values, *arena, split_budget_, 0);
  }
  // Record this iteration's discount factors. Nodes pay on their next visit
  // (or at flush); a skipped subtree simply accrues more than one entry.
  DiscountFactors f;
  update_.discounts(t_, f.pos, f.neg, f.strat);
  discount_history_.push_back(f);
}

void CfrSolver::run(std::uint64_t iterations) {
  for (std::uint64_t i = 0; i < iterations; ++i) iterate();
  // Leave the solver readable: best response, the export pass and the tests
  // all expect the same state the old eager sweep left behind.
  flush_discounts();
}

void CfrSolver::pay_discount(std::uint32_t decision_index, std::uint32_t upto) {
  const std::uint32_t stamp = discount_stamp_[decision_index];
  discount_stamp_[decision_index] = upto;
  // Iso member nodes own no storage; their rep pays for both.
  if (layout_.node_hands[decision_index] == 0) return;
  // Compound the missed iterations' factors. Valid because a node's regret
  // signs cannot change while it is not being visited (the factors are all
  // positive), and with recalc off there is only ever one factor, so this is
  // bit-for-bit the sequential payment.
  float pos = 1.0f, neg = 1.0f, strat = 1.0f;
  for (std::uint32_t k = stamp + 1; k <= upto; ++k) {
    const DiscountFactors& f = discount_history_[k];
    pos *= f.pos;
    neg *= f.neg;
    strat *= f.strat;
  }
  if (pos == 1.0f && neg == 1.0f && strat == 1.0f) return;  // e.g. non-DCFR rules
  const std::size_t off = layout_.node_offset[decision_index];
  const std::size_t n = static_cast<std::size_t>(layout_.node_hands[decision_index]) *
                        layout_.node_actions[decision_index];
  float* r = regrets_.data() + off;
  if (update_.precision == Precision::I16) {
    for (std::size_t i = 0; i < n; ++i) r[i] *= (r[i] > 0.0f ? pos : neg);
    // The strategy discount is ONE sign-independent factor, so it can be
    // charged to the scale instead of to 65536 stored cells - the whole pass
    // disappears. Doing the same for regrets is not available: pos and neg
    // differ, so their discount has to touch the data.
    //
    // Folding it into the scale rather than the data is also what keeps the
    // accumulator's range stable. Discounting the DATA would shrink stored
    // values every iteration while the additions stayed the same size, so
    // the u16 range would drift toward the top end and force a rescale pass
    // that costs exactly what was just saved.
    strat_scale_[decision_index] *= strat;
    strat_bound_[decision_index] *= strat;
    return;
  }
  float* s = strat_sum_.data() + off;
  for (std::size_t i = 0; i < n; ++i) {
    r[i] *= (r[i] > 0.0f ? pos : neg);
    s[i] *= strat;
  }
}

void CfrSolver::strat_reserve_headroom(std::uint32_t decision_index, float max_add) {
  // Keep (bound + max_add) / scale inside the u16 range with margin. kQCeil
  // is below 65535 so the per-cell truncating round cannot cross the top.
  constexpr float kQCeil = 64000.0f;
  float scale = strat_scale_[decision_index];
  const float bound = strat_bound_[decision_index] + max_add;
  if (bound <= kQCeil * scale) {
    strat_bound_[decision_index] = bound;
    return;
  }
  const std::size_t off = layout_.node_offset[decision_index];
  const std::size_t n = static_cast<std::size_t>(layout_.node_hands[decision_index]) *
                        layout_.node_actions[decision_index];
  std::uint16_t* q = strat_q_.data() + off;
  do {
    for (std::size_t i = 0; i < n; ++i) q[i] = static_cast<std::uint16_t>(q[i] >> 1);
    scale *= 2.0f;
  } while (bound > kQCeil * scale);
  strat_scale_[decision_index] = scale;
  strat_bound_[decision_index] = bound;
}

void CfrSolver::flush_discounts() {
  const std::uint32_t upto = static_cast<std::uint32_t>(t_);
  const std::size_t nodes = layout_.node_offset.size();
  const int chunks = static_cast<int>((nodes + kDiscountChunk - 1) / kDiscountChunk);
  // Elementwise per node, so chunking changes nothing about the result.
  pool_->parallel_for(chunks, [&](int c) {
    const std::size_t begin = static_cast<std::size_t>(c) * kDiscountChunk;
    const std::size_t end = std::min(nodes, begin + kDiscountChunk);
    for (std::size_t d = begin; d < end; ++d) {
      if (discount_stamp_[d] < upto) pay_discount(static_cast<std::uint32_t>(d), upto);
    }
  });
}

namespace {
// Relative-L1 helpers for the recalc triggers. Plain serial sums: they feed
// scheduling decisions, so they must be deterministic, and H is small.
float l1_norm(const std::vector<float>& v) {
  float sum = 0.0f;
  for (float x : v) sum += x < 0.0f ? -x : x;
  return sum;
}
float l1_diff(const std::vector<float>& a, const std::vector<float>& b) {
  float sum = 0.0f;
  const std::size_t n = a.size();
  for (std::size_t i = 0; i < n; ++i) {
    const float d = a[i] - b[i];
    sum += d < 0.0f ? -d : d;
  }
  return sum;
}
// The movement metric behind the skip budget. Range-WEIGHTED, because that
// is the quantity the error bound is actually made of: freezing a subtree
// perturbs the seat's best-response value by at most
// sum_h reach[h] * |delta cfv[h]| <= sum_h initial_range[h] * |delta cfv[h]|.
// Plain L1 over-counts by the full hand count and made the budget engage on
// big games but never on small ones.
float weighted_l1_diff(const std::vector<float>& range, const std::vector<float>& a,
                       const std::vector<float>& b) {
  float sum = 0.0f;
  const std::size_t n = a.size();
  for (std::size_t i = 0; i < n; ++i) {
    const float d = a[i] - b[i];
    sum += range[i] * (d < 0.0f ? -d : d);
  }
  return sum;
}
}  // namespace

void CfrSolver::set_recalc_budget(double exploitable_chips) {
  if (!recalc_on_ || recalc_.empty() || exploitable_chips <= 0.0) {
    recalc_threshold_ = 0.0f;
    return;
  }
  // Feedback control on the skip aggressiveness. Healthy DCFR convergence is
  // roughly 1/t, so between checkpoints at t0 and t1 exploitability should
  // shrink at least like sqrt(t0/t1) (half order, deliberately slack). A
  // checkpoint that misses even that means the frozen subtrees are holding
  // the solve back: cut aggressiveness hard. Checkpoints that keep pace let
  // it relax back toward the configured ceiling. Every input here is a
  // deterministic best-response measurement, so the schedule stays
  // bit-identical at any thread count.
  if (recalc_last_t_ > 0 && t_ > recalc_last_t_ && recalc_last_e_ > 0.0) {
    const double expected =
        std::sqrt(static_cast<double>(recalc_last_t_) / static_cast<double>(t_));
    if (exploitable_chips > recalc_last_e_ * expected) {
      recalc_aggress_ *= 0.25;
    } else {
      recalc_aggress_ =
          std::min(recalc_aggress_ * 1.5, static_cast<double>(recalc_config_.margin));
    }
    // Never fully zero: a floor keeps the controller able to re-engage.
    recalc_aggress_ = std::max(recalc_aggress_, 1e-4);
  }
  recalc_last_e_ = exploitable_chips;
  recalc_last_t_ = t_;

  // Divide the error budget across the subtrees, and lift it from chips into
  // the raw counterfactual-value scale (the movements are range-weighted
  // sums over unnormalized CFVs; Z is the profile weight normalizer).
  const double z = game_.total_profile_weight();
  recalc_threshold_ = static_cast<float>(recalc_aggress_ * exploitable_chips * z /
                                         static_cast<double>(recalc_.size()));
}

bool CfrSolver::recalc_should_skip(const RecalcSlot& slot, int seat,
                                   const std::vector<float>& opp_reach) const {
  if (!slot.valid[seat]) return false;
  if (recalc_threshold_ <= 0.0f) return false;  // no budget fed yet
  if (static_cast<std::uint32_t>(t_) >= slot.next_due[seat]) return false;
  if (t_ <= static_cast<std::uint64_t>(recalc_config_.warmup)) return false;
  // Budget test: this subtree's residual movement must be small against the
  // CURRENT error budget, which tightens as the solve converges - that is
  // what prevents the fixed-epsilon stall.
  if (slot.movement[seat] > recalc_threshold_) return false;
  // Staleness guard: the cached values are exact for the opponent reach that
  // produced them and nothing else above the node. If that reach has drifted,
  // the cache is answering a different question - revisit regardless of the
  // period. (Blocked hands are zero on both sides of the comparison for the
  // hands that matter, so comparing the pre-mask vectors is fine.)
  const float drift = l1_diff(opp_reach, slot.reach_snap[seat]);
  return drift <= recalc_config_.eps_reach * (slot.snap_l1[seat] + 1e-30f);
}

void CfrSolver::recalc_store(RecalcSlot& slot, int seat, const std::vector<float>& child_vals,
                             const std::vector<float>& opp_reach) {
  std::uint16_t period = 1;
  float movement = 0.0f;
  if (slot.valid[seat]) {
    movement = weighted_l1_diff(game_.initial_range(seat), child_vals, slot.value[seat]);
    const bool quiet = recalc_threshold_ > 0.0f && movement <= recalc_threshold_;
    period = quiet ? static_cast<std::uint16_t>(std::min<int>(slot.period[seat] * 2,
                                                              recalc_config_.max_period))
                   : static_cast<std::uint16_t>(1);
  }
  slot.movement[seat] = movement;
  slot.period[seat] = period;
  slot.next_due[seat] = static_cast<std::uint32_t>(t_) + period;
  slot.value[seat] = child_vals;
  slot.reach_snap[seat] = opp_reach;
  slot.snap_l1[seat] = l1_norm(opp_reach);
  slot.valid[seat] = true;
}

void CfrSolver::traverse_impl(NodeId id, int seat, int depth,
                              std::vector<std::vector<float>>& reach,
                              std::vector<float>& out, Arena& arena, int split, int fork_depth) {
  const PublicTree& tree = game_.tree();
  const Node& node = tree[id];
  const std::uint32_t my_hands = static_cast<std::uint32_t>(game_.num_hands(seat));

  // `out` is sized here but NOT zeroed here. Two of the four branches below
  // overwrite every entry, so a blanket zero-fill was a wasted pass over a
  // hands-wide buffer at every node in the tree. Each branch now does exactly
  // what it needs: the two accumulators zero, the two overwriters only size.
  //
  // Aliasing note, load-bearing now that the actor branch accumulates in
  // place: `out` at depth d is always the caller's scratch(arena, d-1,
  // kSlotChild), a parent-owned forked_out[c], or iterate()'s local `values`.
  // A node at depth d only ever touches scratch(arena, d, *), so no slot it
  // uses can alias `out`. `reach` is never aliased into an arena slot either
  // - the save/restore below copies through kSlotSavedBase rather than
  // binding a reference.

  if (node.kind == NodeKind::Terminal) {
    // terminal_values fully overwrites: the showdown path writes every entry
    // through out.data(), and the fold path's compat_weights does its own
    // assign. It does NOT resize, so the size still has to be right here.
    out.resize(my_hands);
    game_.terminal_values(id, seat, reach, out);
    return;
  }

  const int seats = game_.num_seats();
  const int children = node.num_children;
  const bool fork = split > 1 && fork_depth < kMaxSplitLevels && children >= kMinSplitChildren;
  const int child_split = fork ? std::max(1, split / children) : split;
  const int child_fork_depth = fork ? fork_depth + 1 : fork_depth;

  // Forked layout: every child gets its own reach copy and its own output
  // buffer, so the subtrees never touch each other. The parent then folds
  // them in IN CHILD ORDER below - identical arithmetic to the serial walk.
  std::vector<std::vector<std::vector<float>>> forked_reach;
  std::vector<std::vector<float>> forked_out;
  if (fork) {
    forked_reach.assign(static_cast<std::size_t>(children), {});
    forked_out.assign(static_cast<std::size_t>(children), {});
  }
  const auto run_children = [&](const auto& prepare) {
    pool_->parallel_for(children, [&](int c) {
      ArenaLease child_arena(*this);
      std::vector<std::vector<float>>& child_reach = forked_reach[static_cast<std::size_t>(c)];
      child_reach = reach;
      prepare(c, child_reach);
      traverse_impl(node.first_child + static_cast<NodeId>(c), seat, depth + 1, child_reach,
                    forked_out[static_cast<std::size_t>(c)], *child_arena, child_split,
                    child_fork_depth);
    });
  };

  if (node.kind == NodeKind::Chance) {
    out.assign(my_hands, 0.0f);  // accumulator: every child folds in below
    // Mask every seat's reach for hands that block the dealt card, so
    // strategy averaging and terminal weighting below this card are exact.
    const auto mask_for_card = [&](int card, std::vector<std::vector<float>>& target) {
      for (int s = 0; s < seats; ++s) {
        for (std::uint16_t h : game_.hands_blocking_card(s, card)) target[s][h] = 0.0f;
      }
    };
    // A child's contribution: zero the hero's blocked hands in its values,
    // then accumulate over every hand unconditionally. Adding an exact 0.0f
    // leaves out[h] untouched (out starts at +0.0f and can never become
    // -0.0f, the one value that would change), and the branch-free loop is
    // one the compiler can vectorize where the per-hand blocking test was not.
    const auto zero_blocked = [&](int card, std::vector<float>& child_vals) {
      for (std::uint16_t h : game_.hands_blocking_card(seat, card)) child_vals[h] = 0.0f;
    };

    // Suit isomorphism: a member child is never traversed; its contribution
    // is its representative's values read through the member's hand gather.
    // The rep's values are zeroed at the hands blocked by the REP's card,
    // and the gather maps those positions exactly onto the hands blocked by
    // the MEMBER's card, so no further zeroing is needed.
    const std::uint32_t iso_base = iso_base_[id];
    const auto is_member = [&](int c) {
      return iso_base != kNoIndex && game_.iso_rep(node.first_child + static_cast<NodeId>(c)).rep !=
                                         node.first_child + static_cast<NodeId>(c);
    };

    // Chance sampling. Units are the REPRESENTATIVE children only - a
    // suit-isomorphic member is never a unit, because its contribution comes
    // from its rep's values through a gather. An unsampled rep therefore
    // takes its members with it, and the n/m scaling (applied to `w`, which
    // both accumulate and fold_members use) compensates in expectation.
    //
    // Decided serially here, before any forking, and keyed only on
    // (node id, iteration) - so the sampled game is a pure function of
    // position and is identical at any thread count.
    // Everything in this block is skipped outright when sampling is off.
    // Building the unit list means calling is_member() - and so
    // Game::iso_rep() - once per child per chance-node visit, which is work
    // a solve that is not sampling should not do. The saving is below this
    // benchmark's noise floor (see docs/roadmap.md on measurement); the
    // early-out is kept because it is obviously less work, not because a
    // number was demonstrated.
    std::array<bool, 52> sampled_in{};
    bool sampling_here = false;
    float ht_scale = 1.0f;
    if (sampling_.enabled) {
      std::uint8_t units[64];
      int num_units = 0;
      for (int c = 0; c < children && num_units < 64; ++c) {
        if (!is_member(c)) units[num_units++] = static_cast<std::uint8_t>(c);
      }
      const int take = sampling_.runouts_at(t_, num_units);
      sampling_here = take < num_units;
      if (sampling_here) {
        std::uint8_t chosen[64];
        sample_without_replacement(units, num_units, take, id, t_, chosen);
        for (int i = 0; i < take; ++i) sampled_in[chosen[i]] = true;
        sampling_skips_.fetch_add(static_cast<std::uint64_t>(num_units - take),
                                  std::memory_order_relaxed);
        // Horvitz-Thompson: scale every surviving unit by n/m so the
        // estimator stays unbiased regardless of what chance_weight returns
        // (it is 1/(52 - known - 4), not a distribution summing to 1 over
        // children - HT does not care).
        ht_scale = static_cast<float>(num_units) / static_cast<float>(take);
      }
    }
    // The chance weight, final and CONST, so the accumulate loops below can
    // treat it as loop-invariant. The sampling factor is folded in here
    // rather than by mutating `w` after the fold lambdas have captured it -
    // a reference-captured mutable would have to be reloaded inside the
    // innermost fold. (Measured as neutral on the flop benchmark, which
    // cannot resolve a change this size; the const form is simply the one
    // that does not depend on the optimizer proving anything.)
    const float w = static_cast<float>(game_.chance_weight(id)) * ht_scale;
    const auto accumulate = [&](const std::vector<float>& child_vals) {
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += w * child_vals[h];
    };
    const auto fold_members = [&](int c, const std::vector<float>& vals) {
      if (iso_base == kNoIndex) return;
      for (const std::vector<std::uint16_t>* map : iso_members_[iso_base + static_cast<std::uint32_t>(c)]) {
        const std::uint16_t* g = map->data();
        for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += w * vals[g[h]];
      }
    };

    // A member rides on its rep, so it is "in" exactly when its rep is.
    const auto dropped = [&](int c) {
      if (!sampling_here) return false;
      const NodeId child = node.first_child + static_cast<NodeId>(c);
      const NodeId rep = game_.iso_rep(child).rep;
      return !sampled_in[static_cast<std::size_t>(rep - node.first_child)];
    };

    // Recalc decisions per child, made serially BEFORE any forking so the
    // schedule is a deterministic function of bit-deterministic state. The
    // caches store post-zeroing vectors, so a skipped child folds in with a
    // single unconditional accumulate.
    const std::uint32_t base = recalc_on_ ? recalc_base_[id] : kNoIndex;
    // recalc_on_ implies exactly 2 seats; the binding must stay in-bounds
    // even when recalc is off and a future N-seat game passes seat > 1.
    const std::vector<float>& opp_reach = reach[recalc_on_ ? 1 - seat : 0];
    std::array<bool, 52> skip{};
    if (base != kNoIndex) {
      for (int c = 0; c < children; ++c) {
        if (is_member(c)) continue;  // members are never traversed at all
        skip[static_cast<std::size_t>(c)] =
            recalc_should_skip(recalc_[base + static_cast<std::uint32_t>(c)], seat, opp_reach);
      }
    }
    // After a full traversal of child c: zero blocked hands, refresh its slot.
    const auto finish_child = [&](int c, std::vector<float>& child_vals) {
      zero_blocked(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, child_vals);
      // No cache maintenance until the first budget arrives: skipping cannot
      // start before then anyway, and quick solves (or callers that never
      // checkpoint) should not pay the copy/compare overhead at all.
      if (base != kNoIndex && recalc_threshold_ > 0.0f) {
        recalc_store(recalc_[base + static_cast<std::uint32_t>(c)], seat, child_vals, opp_reach);
      }
    };

    if (fork) {
      // Fork only the children that need a real traversal; skipped ones fold
      // from their caches. Fold order stays child order either way.
      std::vector<int> full;
      full.reserve(static_cast<std::size_t>(children));
      for (int c = 0; c < children; ++c) {
        if (!is_member(c) && !skip[static_cast<std::size_t>(c)] && !(sampling_here && dropped(c))) {
          full.push_back(c);
        }
      }
      pool_->parallel_for(static_cast<int>(full.size()), [&](int i) {
        const int c = full[static_cast<std::size_t>(i)];
        ArenaLease child_arena(*this);
        std::vector<std::vector<float>>& child_reach = forked_reach[static_cast<std::size_t>(c)];
        child_reach = reach;
        mask_for_card(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, child_reach);
        traverse_impl(node.first_child + static_cast<NodeId>(c), seat, depth + 1, child_reach,
                      forked_out[static_cast<std::size_t>(c)], *child_arena, child_split,
                      child_fork_depth);
        // Slot writes are disjoint per child, so doing this inside the task
        // is race-free; the values it derives from are bit-deterministic.
        finish_child(c, forked_out[static_cast<std::size_t>(c)]);
      });
      for (int c = 0; c < children; ++c) {
        if (is_member(c) || (sampling_here && dropped(c))) continue;
        if (skip[static_cast<std::size_t>(c)]) {
          recalc_skips_.fetch_add(1, std::memory_order_relaxed);
          const std::vector<float>& vals = recalc_[base + static_cast<std::uint32_t>(c)].value[seat];
          accumulate(vals);
          fold_members(c, vals);
        } else {
          accumulate(forked_out[static_cast<std::size_t>(c)]);
          fold_members(c, forked_out[static_cast<std::size_t>(c)]);
        }
      }
      return;
    }

    std::vector<float>& child_vals = scratch(arena, depth, kSlotChild);
    for (int c = 0; c < children; ++c) {
      if (is_member(c) || (sampling_here && dropped(c))) continue;
      if (skip[static_cast<std::size_t>(c)]) {
        recalc_skips_.fetch_add(1, std::memory_order_relaxed);
        const std::vector<float>& vals = recalc_[base + static_cast<std::uint32_t>(c)].value[seat];
        accumulate(vals);
        fold_members(c, vals);
        continue;
      }
      const NodeId child = node.first_child + static_cast<NodeId>(c);
      const int card = tree[child].dealt_card;
      for (int s = 0; s < seats; ++s) scratch(arena, depth, kSlotSavedBase + s) = reach[s];
      mask_for_card(card, reach);
      traverse_impl(child, seat, depth + 1, reach, child_vals, arena, child_split,
                    child_fork_depth);
      for (int s = 0; s < seats; ++s) reach[s] = scratch(arena, depth, kSlotSavedBase + s);
      finish_child(c, child_vals);
      accumulate(child_vals);
      fold_members(c, child_vals);
    }
    return;
  }

  // Decision node.
  const int actor = node.actor;
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];

  // Settle everything this node owes through the PREVIOUS iteration before
  // anything reads its regrets - its rows are about to be pulled into cache
  // for regret matching anyway. (This iteration's own factors do not exist
  // yet; they are recorded after the traversal.)
  const std::uint32_t paid_through = static_cast<std::uint32_t>(t_) - 1;
  if (discount_stamp_[node.decision_index] < paid_through) {
    pay_discount(node.decision_index, paid_through);
  }

  std::vector<float>& sigma = scratch(arena, depth, kSlotSigma);
  sigma.resize(static_cast<std::size_t>(hands) * actions);
  std::vector<float>& hand_scratch = scratch(arena, depth, kSlotHandScratch);
  hand_scratch.resize(hands);
  regret_matched_action_major(regrets_.data() + off, hands, actions, sigma.data(),
                              hand_scratch.data());

  if (actor == seat) {
    // The node value accumulates straight into `out` instead of into a
    // scratch slot that then had to be copied over it. hands == my_hands
    // here, because actor == seat and node_hands is num_hands(actor).
    out.assign(hands, 0.0f);

    // QRE reward transformation (see QreConfig). Each action's counterfactual
    // value is charged the dilated KL of the current strategy to uniform,
    //
    //     vt(h,a) = v(h,a) - pi(h) * (1/lambda) * (log sigma(h,a) + log A)
    //
    // which makes the fixed point the logit QRE instead of Nash. Everything
    // downstream - regret matching, the DCFR discount, strategy averaging,
    // both strategy accessors - is untouched; only what gets accumulated
    // changes.
    //
    // pi(h) = the opponent-profile weight compatible with hand h, which is
    // exactly the factor the counterfactual values already carry. Without it
    // one lambda would mean a different rationality at every infoset, because
    // softmax is not scale-invariant. Own actions leave every seat's reach
    // alone on the way down, so this is computed once for the whole node.
    const bool use_qre = qre_.enabled;
    std::vector<float>& compat = scratch(arena, depth, kSlotCompat);
    float log_actions = 0.0f;
    const float prob_floor = qre_.min_prob;
    if (use_qre) {
      game_.compat_weights(actor, reach, compat);
      const float inv_lambda = static_cast<float>(1.0 / qre_.lambda_at(t_, actor));
      log_actions = static_cast<float>(std::log(static_cast<double>(actions)));
      // Fold the unreachable-hand clamp and the 1/lambda scale into the buffer
      // once per node instead of once per (hand, action). Inclusion-exclusion
      // can land a hair below zero, hence the clamp. `w * inv_lambda * (...)`
      // already associated this way, so this is bit-for-bit the per-cell form.
      float* c = compat.data();
      for (std::uint32_t h = 0; h < hands; ++h) {
        c[h] = (c[h] > 0.0f ? c[h] : 0.0f) * inv_lambda;
      }
    }

    const auto fold_in = [&](std::uint16_t k, const std::vector<float>& child_vals) {
      const std::size_t col = static_cast<std::size_t>(k) * hands;
      if (use_qre) {
        qre_fold_in(out.data(), regrets_.data() + off + col, sigma.data() + col,
                    child_vals.data(), compat.data(), hands, prob_floor, log_actions);
      } else {
        plain_fold_in(out.data(), regrets_.data() + off + col, sigma.data() + col,
                      child_vals.data(), hands);
      }
    };

    if (fork) {
      // Own actions leave every seat's reach untouched on the way down.
      run_children([](int, std::vector<std::vector<float>>&) {});
      for (std::uint16_t k = 0; k < actions; ++k) fold_in(k, forked_out[k]);
    } else {
      std::vector<float>& child_vals = scratch(arena, depth, kSlotChild);
      for (std::uint16_t k = 0; k < actions; ++k) {
        traverse_impl(node.first_child + k, seat, depth + 1, reach, child_vals, arena,
                      child_split, child_fork_depth);
        fold_in(k, child_vals);
      }
    }

    const float sw = static_cast<float>(update_.strategy_weight(t_));
    const bool clamp = update_.clamp_regrets();
    // The regret-matching sums are done with; the buffer becomes the reach
    // weights, hoisted out of the action loop below.
    float* rw = hand_scratch.data();
    // sigma is a probability, so no cell can grow by more than max(rw) this
    // visit. That single number is the whole overflow argument for the u16
    // path, and it is free here because rw is being built anyway.
    float max_rw = 0.0f;
    for (std::uint32_t h = 0; h < hands; ++h) {
      const float w = reach[actor][h] * sw;
      rw[h] = w;
      if (w > max_rw) max_rw = w;
    }
    const bool quantized = update_.precision == Precision::I16;
    if (quantized) {
      strat_reserve_headroom(node.decision_index, max_rw);
      // Fold 1/scale into rw once per node. rw is not read by anything else
      // on this path - the f32 branch below is the only other consumer and
      // the two are mutually exclusive.
      const float inv_scale = 1.0f / strat_scale_[node.decision_index];
      for (std::uint32_t h = 0; h < hands; ++h) rw[h] *= inv_scale;
    }
    // Action-outer so all four arrays are walked contiguously. Every (hand,
    // action) cell is independent, so this is the same arithmetic the
    // hand-outer version did, in a different visiting order.
    for (std::uint16_t k = 0; k < actions; ++k) {
      const std::size_t col = static_cast<std::size_t>(k) * hands;
      float* regret_col = regrets_.data() + off + col;
      const float* sigma_col = sigma.data() + col;
      if (quantized) {
        if (clamp) {
          update_regret_row<true>(regret_col, out.data(), hands);
        } else {
          update_regret_row<false>(regret_col, out.data(), hands);
        }
        strat_accum_q16(strat_q_.data() + off + col, sigma_col, rw, hands);
      } else {
        float* strat_col = strat_sum_.data() + off + col;
        if (clamp) {
          update_row_f32<true>(regret_col, strat_col, sigma_col, out.data(), rw, hands);
        } else {
          update_row_f32<false>(regret_col, strat_col, sigma_col, out.data(), rw, hands);
        }
      }
    }
    return;
  }

  // Opponent decision: weight the actor's reach by each action's probability.
  out.assign(my_hands, 0.0f);  // accumulator: every action folds in below
  if (fork) {
    run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
      const float* sigma_col = sigma.data() + static_cast<std::size_t>(c) * hands;
      for (std::uint32_t h = 0; h < hands; ++h) {
        child_reach[actor][h] = reach[actor][h] * sigma_col[h];
      }
    });
    for (int c = 0; c < children; ++c) {
      const std::vector<float>& vals = forked_out[static_cast<std::size_t>(c)];
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += vals[h];
    }
    return;
  }

  std::vector<float>& child_vals = scratch(arena, depth, kSlotChild);
  std::vector<float>& saved = scratch(arena, depth, kSlotSavedBase + actor);
  saved = reach[actor];
  for (std::uint16_t k = 0; k < actions; ++k) {
    const float* sigma_col = sigma.data() + static_cast<std::size_t>(k) * hands;
    for (std::uint32_t h = 0; h < hands; ++h) reach[actor][h] = saved[h] * sigma_col[h];
    traverse_impl(node.first_child + k, seat, depth + 1, reach, child_vals, arena, child_split,
                  child_fork_depth);
    for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += child_vals[h];
  }
  reach[actor] = saved;
}

void CfrSolver::strategy_rows(NodeId id, bool current, std::vector<float>& out) const {
  const Game::IsoRef ref = game_.iso_rep(id);
  if (ref.rep != id) {
    // Suit-isomorphic member: the rep's rows, hands relabeled through the
    // gather. Cold path (export / best response), so the extra pass is fine.
    std::vector<float> rep_rows;
    strategy_rows(ref.rep, current, rep_rows);
    const Node& node = game_.tree()[id];
    const std::uint16_t actions = node.num_children;
    const std::uint32_t hands = static_cast<std::uint32_t>(game_.num_hands(node.actor));
    out.resize(static_cast<std::size_t>(hands) * actions);
    const std::uint16_t* g = ref.map->data();
    for (std::uint32_t h = 0; h < hands; ++h) {
      const float* src = rep_rows.data() + static_cast<std::size_t>(g[h]) * actions;
      float* dst = out.data() + static_cast<std::size_t>(h) * actions;
      for (std::uint16_t k = 0; k < actions; ++k) dst[k] = src[k];
    }
    return;
  }
  const Node& node = game_.tree()[id];
  assert(node.kind == NodeKind::Decision);
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];
  out.resize(static_cast<std::size_t>(hands) * actions);
  // The u16 strategy sums are widened into a scratch buffer rather than
  // dequantized: row_from_action_major normalizes every row by its own sum,
  // so the per-node scale cancels and only the ratios matter. Cold path
  // (export + best response), so the extra buffer is free.
  std::vector<float> widened;
  const float* values;
  if (!current && update_.precision == Precision::I16) {
    const std::uint16_t* q = strat_q_.data() + off;
    const std::size_t n = static_cast<std::size_t>(hands) * actions;
    widened.resize(n);
    for (std::size_t i = 0; i < n; ++i) widened[i] = static_cast<float>(q[i]);
    values = widened.data();
  } else {
    values = (current ? regrets_ : strat_sum_).data() + off;
  }
  for (std::uint32_t h = 0; h < hands; ++h) {
    row_from_action_major(values, hands, actions, h, /*positive_part=*/current,
                          out.data() + static_cast<std::size_t>(h) * actions);
  }
}

void CfrSolver::average_strategy(NodeId id, std::vector<float>& out) const {
  strategy_rows(id, /*current=*/false, out);
}

void CfrSolver::current_strategy(NodeId id, std::vector<float>& out) const {
  strategy_rows(id, /*current=*/true, out);
}

}  // namespace engine
