#include "solver/cfr.hpp"

#include <algorithm>
#include <cassert>
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

CfrSolver::CfrSolver(const Game& game, UpdateConfig update, int threads)
    : game_(game), update_(update), layout_(InfosetLayout::build(game)) {
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
  // Anything the traversal did not reach still owes the previous discount.
  // Normally nothing: a traversal visits every decision node. The scan is
  // over stamps only, so it costs nothing next to the sweep it replaces.
  flush_discounts();

  float pos, neg, strat;
  pending_.active = update_.discounts(t_, pos, neg, strat);
  pending_.pos = pos;
  pending_.neg = neg;
  pending_.strat = strat;
  pending_iter_ = static_cast<std::uint32_t>(t_);
}

void CfrSolver::run(std::uint64_t iterations) {
  for (std::uint64_t i = 0; i < iterations; ++i) iterate();
  // Leave the solver readable: best response, the export pass and the tests
  // all expect the same state the old eager sweep left behind.
  flush_discounts();
}

void CfrSolver::pay_discount(std::uint32_t decision_index) {
  discount_stamp_[decision_index] = pending_iter_;
  const std::size_t off = layout_.node_offset[decision_index];
  const std::size_t n = static_cast<std::size_t>(layout_.node_hands[decision_index]) *
                        layout_.node_actions[decision_index];
  float* r = regrets_.data() + off;
  float* s = strat_sum_.data() + off;
  const float pos = pending_.pos;
  const float neg = pending_.neg;
  const float strat = pending_.strat;
  for (std::size_t i = 0; i < n; ++i) {
    r[i] *= (r[i] > 0.0f ? pos : neg);
    s[i] *= strat;
  }
}

void CfrSolver::flush_discounts() {
  if (!pending_.active) return;
  const std::size_t nodes = layout_.node_offset.size();
  const int chunks = static_cast<int>((nodes + kDiscountChunk - 1) / kDiscountChunk);
  // Elementwise per node, so chunking changes nothing about the result.
  pool_->parallel_for(chunks, [&](int c) {
    const std::size_t begin = static_cast<std::size_t>(c) * kDiscountChunk;
    const std::size_t end = std::min(nodes, begin + kDiscountChunk);
    for (std::size_t d = begin; d < end; ++d) {
      if (discount_stamp_[d] < pending_iter_) pay_discount(static_cast<std::uint32_t>(d));
    }
  });
  pending_.active = false;
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
    // Folding a child in: zero the hero's blocked hands in the child's values
    // first, then accumulate over every hand unconditionally. Adding an exact
    // 0.0f leaves out[h] untouched (out starts at +0.0f and can never become
    // -0.0f, the one value that would change), and the branch-free loop is
    // one the compiler can vectorize where the per-hand blocking test was not.
    const auto fold_child = [&](int card, std::vector<float>& child_vals) {
      for (std::uint16_t h : game_.hands_blocking_card(seat, card)) child_vals[h] = 0.0f;
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += w * child_vals[h];
    };

    if (fork) {
      run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
        mask_for_card(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, child_reach);
      });
      for (int c = 0; c < children; ++c) {
        fold_child(tree[node.first_child + static_cast<NodeId>(c)].dealt_card,
                   forked_out[static_cast<std::size_t>(c)]);
      }
      return;
    }

    std::vector<float>& child_vals = scratch(arena, depth, kSlotChild);
    for (int c = 0; c < children; ++c) {
      const NodeId child = node.first_child + static_cast<NodeId>(c);
      const int card = tree[child].dealt_card;
      for (int s = 0; s < seats; ++s) scratch(arena, depth, kSlotSavedBase + s) = reach[s];
      mask_for_card(card, reach);
      traverse_impl(child, seat, depth + 1, reach, child_vals, arena, child_split,
                    child_fork_depth);
      fold_child(card, child_vals);
      for (int s = 0; s < seats; ++s) reach[s] = scratch(arena, depth, kSlotSavedBase + s);
    }
    return;
  }

  // Decision node.
  const int actor = node.actor;
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];

  // Settle what this node owes before anything reads its regrets - its rows
  // are about to be pulled into cache for regret matching anyway.
  if (pending_.active && discount_stamp_[node.decision_index] < pending_iter_) {
    pay_discount(node.decision_index);
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
