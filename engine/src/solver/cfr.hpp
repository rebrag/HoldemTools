#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

#include "game/game.hpp"
#include "solver/updates.hpp"
#include "util/parallel.hpp"

namespace engine {

// Flat storage layout for cumulative regrets and cumulative strategy.
// For decision node d (dense decision_index) with H actor hands and A
// actions, values live at node_offset[d] + action * H + hand. Both arrays
// share this layout. This is the hot data; keep it flat f32 - CFR is
// memory-latency-bound and pointer-chasing here would dominate runtime.
//
// ACTION-MAJOR, not hand-major, and that is load-bearing. Every hot loop in
// the traversal walks hands for a FIXED action - accumulate a child's values
// into one action's regrets, weight one action's reach, fold one action's
// strategy into the average. Hand-major made all of those a stride-A scatter
// across the hand universe, which is both cache-hostile and unvectorizable.
// Action-major makes them contiguous runs of H floats. The only loop that
// wants the other order is the per-hand normalization in regret matching,
// and that is A elements wide (2-5), so it loses far less than the hot
// loops gain.
//
// average_strategy() and current_strategy() still EMIT hand-major rows -
// that is the public contract every consumer (artifact writer, best
// response) reads - so this layout stays internal to the solver.
struct InfosetLayout {
  std::vector<std::size_t> node_offset;  // by decision_index
  std::vector<std::uint32_t> node_hands;
  std::vector<std::uint16_t> node_actions;
  std::size_t total = 0;

  // Decision nodes inside suit-isomorphic MEMBER subtrees own no storage:
  // their data is the representative's, read through Game::iso_rep(). They
  // carry node_hands == 0 and this sentinel offset; nothing may form a
  // pointer from it.
  static constexpr std::size_t kNoOffset = static_cast<std::size_t>(-1);

  static InfosetLayout build(const Game& game);
};

// Hard cap on how many times one root-to-leaf path may fork. Bounds both the
// helper recursion inside ThreadPool and the number of scratch arenas alive
// at once (<= threads * (kMaxSplitLevels + 1) + 1), which is what the memory
// estimator budgets for.
inline constexpr int kMaxSplitLevels = 4;

// Upper bound on scratch arenas checked out at once: every worker can be
// nested one level per fork, plus the traversal the caller itself started.
int max_live_arenas(int threads);

class CfrSolver {
 public:
  // `threads` follows the config convention (0 = one per hardware thread,
  // negative = leave that many cores free). Traversal parallelism is
  // arithmetically identical to the single-threaded path: sibling subtrees
  // touch disjoint regret ranges, and every cross-child accumulation still
  // happens serially in child order after the join. Same config, same
  // thread count or not, same numbers.
  CfrSolver(const Game& game, UpdateConfig update, int threads = 1,
            RecalcConfig recalc = {});

  // Run `iterations` full iterations (one traversal per seat each) and leave
  // the solver readable: any deferred DCFR discount is settled before this
  // returns, so callers see exactly the state an eager per-iteration sweep
  // would have left.
  void run(std::uint64_t iterations);
  std::uint64_t iteration() const { return t_; }

  // Average strategy at a decision node: row-major [hand][action] - the
  // transpose of the internal storage, kept because that is what the
  // artifact writer and the best-response pass consume. Rows sum to 1
  // (uniform when the strategy sum is all zero). A suit-isomorphic member
  // node transparently returns its representative's rows with the hands
  // relabeled - callers cannot tell the difference, which is the whole
  // compatibility story for isomorphism.
  void average_strategy(NodeId node, std::vector<float>& out) const;

  // Current (regret-matched) strategy, same shape.
  void current_strategy(NodeId node, std::vector<float>& out) const;

  const InfosetLayout& layout() const { return layout_; }
  const Game& game() const { return game_; }
  // Shared with the best-response pass so one solve owns one set of threads.
  ThreadPool& pool() const { return *pool_; }
  // Fan-out budget handed to the root of a traversal; 1 disables splitting.
  int split_budget() const { return split_budget_; }

  // Subtree traversals the recalc schedule skipped (0 when disabled).
  // Observability, and what keeps the recalc tests non-vacuous.
  std::uint64_t recalc_skips() const {
    return recalc_skips_.load(std::memory_order_relaxed);
  }

  // Feed the schedule the measured per-player exploitability (chips) from
  // the caller's latest best-response checkpoint. Until the first call the
  // budget is zero and nothing is ever skipped, so a caller that never
  // checkpoints gets plain CFR. Deterministic: best response itself is
  // bit-identical at any thread count.
  void set_recalc_budget(double exploitable_chips);

  // Estimated bytes for regrets + strategy sums under this layout.
  static std::size_t state_bytes(const Game& game);

 private:
  // Scratch buffers for one in-flight traversal, keyed by (depth, slot).
  // A forked subtree gets its own arena: the parent holds references into
  // its own slots across the recursive call, so arenas are never shared.
  struct Arena {
    std::vector<std::vector<float>> slots;
  };
  // Checks an arena out for the lifetime of a forked subtree.
  class ArenaLease {
   public:
    explicit ArenaLease(CfrSolver& solver) : solver_(solver), arena_(solver.acquire_arena()) {}
    ~ArenaLease() { solver_.release_arena(arena_); }
    ArenaLease(const ArenaLease&) = delete;
    ArenaLease& operator=(const ArenaLease&) = delete;
    Arena& operator*() const { return *arena_; }

   private:
    CfrSolver& solver_;
    Arena* arena_;
  };

  void iterate();
  // Apply every discount owed for iterations (stamp, upto] to one decision
  // node's regrets and strategy sums, and stamp it paid through `upto`.
  void pay_discount(std::uint32_t decision_index, std::uint32_t upto);
  // Settle discounts everywhere they have not already been paid.
  void flush_discounts();
  Arena* acquire_arena();
  void release_arena(Arena* arena);

  const Game& game_;
  UpdateConfig update_;
  InfosetLayout layout_;
  std::vector<float> regrets_;
  std::vector<float> strat_sum_;
  std::uint64_t t_ = 0;
  std::unique_ptr<ThreadPool> pool_;
  int split_budget_ = 1;

  // Deferred DCFR discount.
  //
  // Applying it as its own sweep over every regret and strategy entry costs
  // 13% of an iteration on a turn tree and 18% on a flop tree - pure memory
  // traffic over data nothing else is touching at that moment. Instead the
  // factors owed for each iteration are recorded here, and a decision node
  // pays everything it owes on its next visit, when its rows are already in
  // cache for regret matching.
  //
  // The recalc schedule means a node can miss SEVERAL iterations' discounts,
  // so the history is per iteration (entry t = factors owed after iteration
  // t; (1,1,1) when the rule has none - multiplying by exactly 1.0f is a
  // bit-exact no-op). Catch-up compounds the missed factors into one product
  // per sign before the memory pass; that is valid because a node's regret
  // signs cannot change while it is not being visited, and it keeps the pass
  // O(row) regardless of how many iterations were missed. With recalc off a
  // node never misses more than one, the product is a single factor, and the
  // result is bit-for-bit the old eager sweep.
  struct DiscountFactors {
    float pos = 1.0f;
    float neg = 1.0f;
    float strat = 1.0f;
  };
  std::vector<DiscountFactors> discount_history_;  // index = iteration, entry 0 unused
  std::vector<std::uint32_t> discount_stamp_;      // by decision_index: paid through

  // Returns counterfactual values for `seat`'s hands at `node`. `split` is
  // the remaining fan-out budget: a node with C children hands each child
  // split/C, so the fork frontier stops widening once the pool is saturated.
  void traverse_impl(NodeId node, int seat, int depth,
                     std::vector<std::vector<float>>& reach,
                     std::vector<float>& out, Arena& arena, int split, int fork_depth);

  std::vector<float>& scratch(Arena& arena, int depth, int slot);

  std::size_t arena_slots_ = 0;
  std::mutex arena_mu_;
  std::vector<std::unique_ptr<Arena>> arenas_;
  std::vector<Arena*> free_arenas_;

  // ---- chance-child recalc schedule (see RecalcConfig) -------------------
  // One slot per chance-node child, per traversing seat: the child's cached
  // value vector (post blocked-hand zeroing, so a skip folds it in with a
  // single unconditional accumulate), a snapshot of the opponent reach that
  // produced it (the returned values depend on nothing else above the node),
  // and the doubling revisit period. Slots for one chance node are
  // contiguous at recalc_base_[node] + child.
  struct RecalcSlot {
    std::vector<float> value[2];
    std::vector<float> reach_snap[2];
    float movement[2] = {0.0f, 0.0f};  // value drift measured at the last revisit
    float snap_l1[2] = {0.0f, 0.0f};
    std::uint32_t next_due[2] = {0, 0};
    std::uint16_t period[2] = {1, 1};
    bool valid[2] = {false, false};
  };
  // Revisit the child now, or fold in its cache? Deterministic: every input
  // is a traversal value that is itself bit-identical at any thread count.
  bool recalc_should_skip(const RecalcSlot& slot, int seat,
                          const std::vector<float>& opp_reach) const;
  // After a full traversal of the child: update period from value movement,
  // then cache the (already blocked-hand-zeroed) values and the reach.
  void recalc_store(RecalcSlot& slot, int seat, const std::vector<float>& child_vals,
                    const std::vector<float>& opp_reach);

  // Suit-isomorphism fold lists: for each chance node (by NodeId, kNoIndex
  // when it has none), for each of its children, the hand-gather maps of the
  // member children collapsed into it. A rep child's values are folded once
  // for itself and once per member through the gather.
  std::vector<std::uint32_t> iso_base_;
  std::vector<std::vector<const std::vector<std::uint16_t>*>> iso_members_;

  void strategy_rows(NodeId node, bool current, std::vector<float>& out) const;

  RecalcConfig recalc_config_;
  bool recalc_on_ = false;                    // enabled AND a 2-seat game
  std::vector<std::uint32_t> recalc_base_;    // by NodeId: first child's slot, or kNoIndex
  std::vector<RecalcSlot> recalc_;
  // aggressiveness * exploitable * Z / num_subtrees, refreshed by
  // set_recalc_budget. Z (the profile normalizer) converts the caller's
  // chips into the raw counterfactual-value scale the movements live in.
  // The controller state below is what makes stalls self-correcting.
  float recalc_threshold_ = 0.0f;
  double recalc_aggress_ = 0.0;      // set to margin at construction
  double recalc_last_e_ = 0.0;       // exploitability at the previous budget call
  std::uint64_t recalc_last_t_ = 0;  // iteration of the previous budget call
  std::atomic<std::uint64_t> recalc_skips_{0};
};

}  // namespace engine
