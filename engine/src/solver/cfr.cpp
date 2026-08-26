#include "solver/cfr.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>

namespace engine {

namespace {
// Scratch slot ids per recursion level.
constexpr int kSlotSigma = 0;
constexpr int kSlotValue = 1;
constexpr int kSlotChild = 2;
// One hands-wide buffer reused twice per decision node: first the
// regret-matching row sums, then the strategy-averaging reach weights.
// They never overlap in time, and an arena slot is not free.
constexpr int kSlotHandScratch = 3;
constexpr int kSlotSavedBase = 4;  // + seat index
constexpr int kSlotsPerLevel = kSlotSavedBase + kMaxSeats;

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
  for (const Node& n : tree.nodes) {
    if (n.kind != NodeKind::Decision) continue;
    const std::uint32_t hands = static_cast<std::uint32_t>(game.num_hands(n.actor));
    layout.node_offset[n.decision_index] = offset;
    layout.node_hands[n.decision_index] = hands;
    layout.node_actions[n.decision_index] = n.num_children;
    offset += static_cast<std::size_t>(hands) * n.num_children;  // action-major
  }
  layout.total = offset;
  return layout;
}

CfrSolver::CfrSolver(const Game& game, UpdateConfig update, int threads, RecalcConfig recalc)
    : game_(game), update_(update), layout_(InfosetLayout::build(game)),
      recalc_config_(recalc) {
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
  out.assign(my_hands, 0.0f);

  if (node.kind == NodeKind::Terminal) {
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
    const float w = static_cast<float>(game_.chance_weight(id));
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
    const auto accumulate = [&](const std::vector<float>& child_vals) {
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += w * child_vals[h];
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
        if (!skip[static_cast<std::size_t>(c)]) full.push_back(c);
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
        if (skip[static_cast<std::size_t>(c)]) {
          recalc_skips_.fetch_add(1, std::memory_order_relaxed);
          accumulate(recalc_[base + static_cast<std::uint32_t>(c)].value[seat]);
        } else {
          accumulate(forked_out[static_cast<std::size_t>(c)]);
        }
      }
      return;
    }

    std::vector<float>& child_vals = scratch(arena, depth, kSlotChild);
    for (int c = 0; c < children; ++c) {
      if (skip[static_cast<std::size_t>(c)]) {
        recalc_skips_.fetch_add(1, std::memory_order_relaxed);
        accumulate(recalc_[base + static_cast<std::uint32_t>(c)].value[seat]);
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
    std::vector<float>& v = scratch(arena, depth, kSlotValue);
    v.assign(hands, 0.0f);
    const auto fold_in = [&](std::uint16_t k, const std::vector<float>& child_vals) {
      const std::size_t col = static_cast<std::size_t>(k) * hands;
      float* regret_col = regrets_.data() + off + col;
      const float* sigma_col = sigma.data() + col;
      for (std::uint32_t h = 0; h < hands; ++h) {
        v[h] += sigma_col[h] * child_vals[h];
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
          const float r = regret_col[h] - v[h];
          regret_col[h] = r < 0.0f ? 0.0f : r;
          strat_col[h] += rw[h] * sigma_col[h];
        }
      } else {
        for (std::uint32_t h = 0; h < hands; ++h) {
          regret_col[h] -= v[h];
          strat_col[h] += rw[h] * sigma_col[h];
        }
      }
    }
    out = v;
    return;
  }

  // Opponent decision: weight the actor's reach by each action's probability.
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

void CfrSolver::average_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  assert(node.kind == NodeKind::Decision);
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];
  out.resize(static_cast<std::size_t>(hands) * actions);
  for (std::uint32_t h = 0; h < hands; ++h) {
    row_from_action_major(strat_sum_.data() + off, hands, actions, h, /*positive_part=*/false,
                          out.data() + static_cast<std::size_t>(h) * actions);
  }
}

void CfrSolver::current_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  assert(node.kind == NodeKind::Decision);
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];
  out.resize(static_cast<std::size_t>(hands) * actions);
  for (std::uint32_t h = 0; h < hands; ++h) {
    row_from_action_major(regrets_.data() + off, hands, actions, h, /*positive_part=*/true,
                          out.data() + static_cast<std::size_t>(h) * actions);
  }
}

}  // namespace engine
