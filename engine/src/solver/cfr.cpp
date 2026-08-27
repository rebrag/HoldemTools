#include "solver/cfr.hpp"

#include "solver/sample.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>

namespace engine {

namespace {
// Scratch slot ids per recursion level.
constexpr int kSlotSigma = 0;
constexpr int kSlotChild = 1;
// One hands-wide buffer reused twice per decision node: first the
// regret-matching row sums, then the strategy-averaging reach weights.
// They never overlap in time, and an arena slot is not free.
constexpr int kSlotHandScratch = 2;
constexpr int kSlotSavedBase = 3;  // + seat index
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
                     SamplingConfig sampling)
    : game_(game), update_(update), layout_(InfosetLayout::build(game)),
      recalc_config_(recalc), sampling_(sampling) {
  // Sampling and the recalc schedule cannot both run: the cache holds
  // full-enumeration values while a sampled iteration produces n/m-scaled
  // ones, and recalc's movement metric would be reading sampling noise.
  // config.cpp rejects the combination; this is the belt-and-braces copy so
  // a programmatic caller cannot construct the broken pairing.
  if (sampling_.enabled) recalc_config_.enabled = false;
  regrets_.assign(layout_.total, 0.0f);
  strat_sum_.assign(layout_.total, 0.0f);
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

std::size_t CfrSolver::state_bytes(const Game& game) {
  const InfosetLayout layout = InfosetLayout::build(game);
  // Regrets + strategy sums, plus the per-node "discount paid at" stamp.
  return layout.total * 2 * sizeof(float) +
         layout.node_offset.size() * sizeof(std::uint32_t);
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
  float* s = strat_sum_.data() + off;
  for (std::size_t i = 0; i < n; ++i) {
    r[i] *= (r[i] > 0.0f ? pos : neg);
    s[i] *= strat;
  }
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
    const auto fold_in = [&](std::uint16_t k, const std::vector<float>& child_vals) {
      const std::size_t col = static_cast<std::size_t>(k) * hands;
      float* regret_col = regrets_.data() + off + col;
      const float* sigma_col = sigma.data() + col;
      for (std::uint32_t h = 0; h < hands; ++h) {
        out[h] += sigma_col[h] * child_vals[h];
        // Defer subtracting v(h): R += cv now, R -= v after the loop.
        regret_col[h] += child_vals[h];
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
    for (std::uint32_t h = 0; h < hands; ++h) rw[h] = reach[actor][h] * sw;
    // Action-outer so all four arrays are walked contiguously. Every (hand,
    // action) cell is independent, so this is the same arithmetic the
    // hand-outer version did, in a different visiting order.
    for (std::uint16_t k = 0; k < actions; ++k) {
      const std::size_t col = static_cast<std::size_t>(k) * hands;
      float* regret_col = regrets_.data() + off + col;
      float* strat_col = strat_sum_.data() + off + col;
      const float* sigma_col = sigma.data() + col;
      // The clamp is loop-invariant; hoisting it leaves two branch-free
      // bodies. `r < 0 ? 0 : r` (not std::max) keeps -0.0f as -0.0f, which
      // is what the branch did.
      if (clamp) {
        for (std::uint32_t h = 0; h < hands; ++h) {
          const float r = regret_col[h] - out[h];
          regret_col[h] = r < 0.0f ? 0.0f : r;
          strat_col[h] += rw[h] * sigma_col[h];
        }
      } else {
        for (std::uint32_t h = 0; h < hands; ++h) {
          regret_col[h] -= out[h];
          strat_col[h] += rw[h] * sigma_col[h];
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
  const float* values = (current ? regrets_ : strat_sum_).data() + off;
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
