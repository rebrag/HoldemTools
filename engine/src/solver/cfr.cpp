#include "solver/cfr.hpp"

#include <cassert>
#include <cstdint>

namespace engine {

namespace {
// Scratch slot ids per recursion level.
constexpr int kSlotSigma = 0;
constexpr int kSlotValue = 1;
constexpr int kSlotChild = 2;
constexpr int kSlotSavedBase = 3;  // + seat index
constexpr int kSlotsPerLevel = kSlotSavedBase + kMaxSeats;

// Row-normalized positive-part-of-regrets strategy (regret matching).
void regret_matched_rows(const float* regrets, std::uint32_t hands,
                         std::uint16_t actions, float* out) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float* r = regrets + static_cast<std::size_t>(h) * actions;
    float* row = out + static_cast<std::size_t>(h) * actions;
    float sum = 0.0f;
    for (std::uint16_t k = 0; k < actions; ++k) {
      const float p = r[k] > 0.0f ? r[k] : 0.0f;
      row[k] = p;
      sum += p;
    }
    if (sum > 0.0f) {
      for (std::uint16_t k = 0; k < actions; ++k) row[k] /= sum;
    } else {
      const float u = 1.0f / static_cast<float>(actions);
      for (std::uint16_t k = 0; k < actions; ++k) row[k] = u;
    }
  }
}
}  // namespace

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
    offset += static_cast<std::size_t>(hands) * n.num_children;
  }
  layout.total = offset;
  return layout;
}

CfrSolver::CfrSolver(const Game& game, UpdateConfig update)
    : game_(game), update_(update), layout_(InfosetLayout::build(game)) {
  regrets_.assign(layout_.total, 0.0f);
  strat_sum_.assign(layout_.total, 0.0f);
  // Pre-size the scratch pool for the full tree depth. scratch() must never
  // grow pool_ mid-traversal: callers hold references into it across
  // recursive calls, and a reallocation would invalidate them.
  const PublicTree& tree = game.tree();
  std::vector<int> depth(tree.size(), 0);
  int max_depth = 0;
  for (NodeId id = 1; id < tree.size(); ++id) {
    depth[id] = depth[tree[id].parent] + 1;
    if (depth[id] > max_depth) max_depth = depth[id];
  }
  pool_.resize(static_cast<std::size_t>(max_depth + 2) * kSlotsPerLevel);
}

std::size_t CfrSolver::state_bytes(const Game& game) {
  return InfosetLayout::build(game).total * 2 * sizeof(float);
}

std::vector<float>& CfrSolver::scratch(int depth, int slot) {
  const std::size_t idx = static_cast<std::size_t>(depth) * kSlotsPerLevel + slot;
  assert(idx < pool_.size());  // pre-sized in the constructor; never grows here
  return pool_[idx];
}

void CfrSolver::iterate() {
  ++t_;
  const int seats = game_.num_seats();
  std::vector<std::vector<float>> reach(seats);
  std::vector<float> values;
  for (int p = 0; p < seats; ++p) {
    for (int s = 0; s < seats; ++s) reach[s] = game_.initial_range(s);
    traverse_impl(game_.tree().root(), p, 0, reach, values);
  }
  apply_discounts();
}

void CfrSolver::run(std::uint64_t iterations) {
  for (std::uint64_t i = 0; i < iterations; ++i) iterate();
}

void CfrSolver::apply_discounts() {
  float pos, neg, strat;
  if (!update_.discounts(t_, pos, neg, strat)) return;
  for (float& r : regrets_) r *= (r > 0.0f ? pos : neg);
  for (float& s : strat_sum_) s *= strat;
}

void CfrSolver::traverse_impl(NodeId id, int seat, int depth,
                              std::vector<std::vector<float>>& reach,
                              std::vector<float>& out) {
  const PublicTree& tree = game_.tree();
  const Node& node = tree[id];
  const std::uint32_t my_hands = static_cast<std::uint32_t>(game_.num_hands(seat));
  out.assign(my_hands, 0.0f);

  if (node.kind == NodeKind::Terminal) {
    game_.terminal_values(id, seat, reach, out);
    return;
  }

  if (node.kind == NodeKind::Chance) {
    const float w = static_cast<float>(game_.chance_weight(id));
    std::vector<float>& child_vals = scratch(depth, kSlotChild);
    const int seats = game_.num_seats();
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      const NodeId child = node.first_child + c;
      const int card = tree[child].dealt_card;
      // Mask every seat's reach for hands that block the dealt card, so
      // strategy averaging and terminal weighting below this card are exact.
      for (int s = 0; s < seats; ++s) {
        std::vector<float>& saved = scratch(depth, kSlotSavedBase + s);
        saved = reach[s];
        const int hands = game_.num_hands(s);
        for (int h = 0; h < hands; ++h) {
          if (game_.hand_blocks_card(s, h, card)) reach[s][h] = 0.0f;
        }
      }
      traverse_impl(child, seat, depth + 1, reach, child_vals);
      for (std::uint32_t h = 0; h < my_hands; ++h) {
        if (!game_.hand_blocks_card(seat, h, card)) out[h] += w * child_vals[h];
      }
      for (int s = 0; s < seats; ++s) reach[s] = scratch(depth, kSlotSavedBase + s);
    }
    return;
  }

  // Decision node.
  const int actor = node.actor;
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];

  std::vector<float>& sigma = scratch(depth, kSlotSigma);
  sigma.resize(static_cast<std::size_t>(hands) * actions);
  regret_matched_rows(regrets_.data() + off, hands, actions, sigma.data());

  std::vector<float>& child_vals = scratch(depth, kSlotChild);

  if (actor == seat) {
    std::vector<float>& v = scratch(depth, kSlotValue);
    v.assign(hands, 0.0f);
    for (std::uint16_t k = 0; k < actions; ++k) {
      traverse_impl(node.first_child + k, seat, depth + 1, reach, child_vals);
      for (std::uint32_t h = 0; h < hands; ++h) {
        v[h] += sigma[static_cast<std::size_t>(h) * actions + k] * child_vals[h];
        // Defer subtracting v(h): R += cv now, R -= v after the loop.
        regrets_[off + static_cast<std::size_t>(h) * actions + k] += child_vals[h];
      }
    }
    const float sw = static_cast<float>(update_.strategy_weight(t_));
    const bool clamp = update_.clamp_regrets();
    for (std::uint32_t h = 0; h < hands; ++h) {
      const std::size_t row = off + static_cast<std::size_t>(h) * actions;
      const float rw = reach[actor][h] * sw;
      for (std::uint16_t k = 0; k < actions; ++k) {
        float r = regrets_[row + k] - v[h];
        if (clamp && r < 0.0f) r = 0.0f;
        regrets_[row + k] = r;
        strat_sum_[row + k] += rw * sigma[static_cast<std::size_t>(h) * actions + k];
      }
    }
    out = v;
  } else {
    std::vector<float>& saved = scratch(depth, kSlotSavedBase + actor);
    saved = reach[actor];
    for (std::uint16_t k = 0; k < actions; ++k) {
      for (std::uint32_t h = 0; h < hands; ++h) {
        reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
      }
      traverse_impl(node.first_child + k, seat, depth + 1, reach, child_vals);
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += child_vals[h];
    }
    reach[actor] = saved;
  }
}

void CfrSolver::average_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  assert(node.kind == NodeKind::Decision);
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  const std::size_t off = layout_.node_offset[node.decision_index];
  out.resize(static_cast<std::size_t>(hands) * actions);
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float* s = strat_sum_.data() + off + static_cast<std::size_t>(h) * actions;
    float* row = out.data() + static_cast<std::size_t>(h) * actions;
    float sum = 0.0f;
    for (std::uint16_t k = 0; k < actions; ++k) sum += s[k];
    if (sum > 0.0f) {
      for (std::uint16_t k = 0; k < actions; ++k) row[k] = s[k] / sum;
    } else {
      const float u = 1.0f / static_cast<float>(actions);
      for (std::uint16_t k = 0; k < actions; ++k) row[k] = u;
    }
  }
}

void CfrSolver::current_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  assert(node.kind == NodeKind::Decision);
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  out.resize(static_cast<std::size_t>(hands) * actions);
  regret_matched_rows(regrets_.data() + layout_.node_offset[node.decision_index],
                      hands, actions, out.data());
}

}  // namespace engine
