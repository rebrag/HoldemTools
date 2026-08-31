#include "solver/sampled_cfr.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <limits>
#include <stdexcept>
#include <string>

namespace engine {

namespace {

constexpr std::uint16_t kNoHand = std::numeric_limits<std::uint16_t>::max();
// Small fixed bound on actions per node so the pinned-seat hot loop never
// allocates; every current tree is far below it.
constexpr int kMaxActionsSampled = 64;

int tree_depth(const PublicTree& tree) {
  std::vector<int> depth(tree.size(), 0);
  int max_depth = 0;
  for (std::size_t i = 1; i < tree.size(); ++i) {
    const NodeId parent = tree[static_cast<NodeId>(i)].parent;
    depth[i] = depth[static_cast<std::size_t>(parent)] + 1;
    max_depth = std::max(max_depth, depth[i]);
  }
  return max_depth;
}

}  // namespace

SampledCfrSolver::SampledCfrSolver(const Game& game, const DealGame& deals,
                                   const SampledConfig& config, int threads)
    : game_(game), deals_(deals), config_(config) {
  if (config_.lanes == 0) throw std::runtime_error("sampled.lanes must be positive");
  if (config_.batch == 0) throw std::runtime_error("sampled.batch must be positive");
  layout_ = InfosetLayout::build(game);
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    if (layout_.node_offset[node.decision_index] == InfosetLayout::kNoOffset) {
      // A member subtree's storage would need the iso gather on every read
      // and write; no game this core runs uses isomorphism yet, so refuse
      // loudly instead of silently mis-indexing.
      throw std::runtime_error("the sampled core does not support suit-isomorphic trees yet");
    }
    if (node.num_children > kMaxActionsSampled) {
      throw std::runtime_error("sampled core caps a decision node at " +
                               std::to_string(kMaxActionsSampled) + " actions");
    }
  }
  regrets_.assign(layout_.total, 0.0f);
  strat_sum_.assign(layout_.total, 0.0f);
  max_depth_ = tree_depth(game.tree());
  lanes_.resize(config_.lanes);
  for (Lane& lane : lanes_) {
    lane.regret_delta.assign(layout_.total, 0.0f);
    lane.strat_delta.assign(layout_.total, 0.0f);
    lane.sigma_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.child_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.reach_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.value_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
  }
  pool_ = std::make_unique<ThreadPool>(resolve_thread_count(threads));
}

void SampledCfrSolver::run(std::uint64_t iterations) {
  const std::uint64_t end = t_ + iterations;
  const int lanes = static_cast<int>(config_.lanes);
  while (t_ < end) {
    const std::uint64_t b0 = t_;
    const std::uint64_t b1 = std::min<std::uint64_t>(end, b0 + config_.batch);

    // Linear discount, keyed to ABSOLUTE iteration count: scaling by b0/b1
    // before folding [b0, b1) telescopes so a batch ending at iteration b
    // carries weight b/T at the end - the same weighting whatever run()
    // segmentation or checkpoint cadence produced the batches. (Keying on a
    // batch COUNTER was measured to make the result depend on
    // checkpoint_every, because checkpoints truncate batches.) Serial, so
    // bit-exact.
    if (b0 > 0) {
      const float scale =
          static_cast<float>(static_cast<double>(b0) / static_cast<double>(b1));
      for (float& r : regrets_) r *= scale;
      for (float& s : strat_sum_) s *= scale;
    }

    // Lanes read the master (frozen for the whole batch - nothing below
    // writes it) and accumulate into private buffers, each in ascending t.
    pool_->parallel_for(lanes, [&](int l) {
      Lane& lane = lanes_[static_cast<std::size_t>(l)];
      std::fill(lane.regret_delta.begin(), lane.regret_delta.end(), 0.0f);
      std::fill(lane.strat_delta.begin(), lane.strat_delta.end(), 0.0f);
      for (std::uint64_t t = b0; t < b1; ++t) {
        if (static_cast<int>(t % static_cast<std::uint64_t>(lanes)) != l) continue;
        run_iteration(t, lane);
      }
    });

    // The fold-back is SERIAL and in lane order - the float-addition
    // ordering that makes any thread-to-lane assignment produce the same
    // bits, mirroring the vectorized core's child-order fold.
    for (int l = 0; l < lanes; ++l) {
      const Lane& lane = lanes_[static_cast<std::size_t>(l)];
      for (std::size_t i = 0; i < layout_.total; ++i) regrets_[i] += lane.regret_delta[i];
      for (std::size_t i = 0; i < layout_.total; ++i) strat_sum_[i] += lane.strat_delta[i];
    }
    t_ = b1;
  }
}

void SampledCfrSolver::run_iteration(std::uint64_t t, Lane& lane) {
  deals_.sample_deal(config_.seed, t, lane.deal);
  deals_.deal_strengths(lane.deal, lane.strengths);
  const int seats = game_.num_seats();
  for (int hero = 0; hero < seats; ++hero) {
    // Hero's universe restricted to the deal: every hand colliding with an
    // opponent's dealt cards or the board is zeroed. Hero's OWN dealt cards
    // do not restrict anything - see deal_game.hpp for why ignoring them is
    // unbiased.
    lane.hero_root = game_.initial_range(hero);
    lane.blocked.clear();
    for (int q = 0; q < seats; ++q) {
      if (q == hero) continue;
      for (int c = 0; c < lane.deal.hole_per_seat; ++c) {
        const int card =
            lane.deal.hole[static_cast<std::size_t>(q * lane.deal.hole_per_seat + c)];
        for (std::uint16_t h : game_.hands_blocking_card(hero, card)) {
          lane.hero_root[h] = 0.0f;
          lane.blocked.push_back(h);
        }
      }
    }
    for (int b = 0; b < lane.deal.board_count; ++b) {
      for (std::uint16_t h :
           game_.hands_blocking_card(hero, lane.deal.board[static_cast<std::size_t>(b)])) {
        lane.hero_root[h] = 0.0f;
        lane.blocked.push_back(h);
      }
    }
    // The pinned seats enter with their range weight; their strategy weight
    // multiplies in at their decision nodes on the way down. A dealt combo
    // outside a seat's range zeroes the whole traversal's values (an
    // unbiased zero, not an error) but hero's strategy still accumulates.
    double w = 1.0;
    for (int q = 0; q < seats; ++q) {
      if (q == hero) continue;
      const std::uint16_t hq = lane.deal.hand[static_cast<std::size_t>(q)];
      w *= hq == kNoHand ? 0.0 : static_cast<double>(game_.initial_range(q)[hq]);
    }
    traverse(game_.tree().root(), hero, lane, w, lane.hero_root, 0, 0, lane.value_stack[0]);
  }
}

void SampledCfrSolver::traverse(NodeId id, int hero, Lane& lane, double opp_w,
                               const std::vector<float>& hero_reach, int chance_depth,
                               int depth, std::vector<float>& out) {
  const PublicTree& tree = game_.tree();
  const Node& node = tree[id];
  const std::uint32_t my_hands = static_cast<std::uint32_t>(game_.num_hands(hero));

  if (node.kind == NodeKind::Terminal) {
    if (node.terminal_kind == TerminalKind::Fold) {
      // Public information only: the pot goes to the last seat standing and
      // everyone pays what they committed, on every deal alike.
      const double share = node.fold_winner == hero ? static_cast<double>(node.pot) : 0.0;
      const float v =
          static_cast<float>(opp_w * (share - static_cast<double>(node.commit[hero])));
      out.assign(my_hands, v);
    } else {
      deals_.deal_showdown_values(id, hero, lane.deal, lane.strengths, out);
      const float w = static_cast<float>(opp_w);
      for (float& v : out) v *= w;
    }
    // A hand colliding with the deal is an impossible holding on this
    // sample: its counterfactual value is 0, not the fold constant or the
    // showdown row's garbage. In the vectorized core the opponent REACH
    // VECTOR does this zeroing inside terminal_values; with a pinned scalar
    // reach nothing else can, and skipping it feeds impossible deals into
    // the regrets of exactly the hands the opponents are holding - measured
    // as Kuhn converging to a wrong equilibrium at nashconv 0.16.
    for (std::uint16_t h : lane.blocked) out[h] = 0.0f;
    return;
  }

  if (node.kind == NodeKind::Chance) {
    // Chance is SAMPLED: descend only the child matching the deal's next
    // public card. The pinned seats' cards were drawn from the same deck, so
    // the matching child always exists.
    const int card = lane.deal.board[static_cast<std::size_t>(chance_depth)];
    for (int c = 0; c < node.num_children; ++c) {
      const NodeId child = node.first_child + static_cast<NodeId>(c);
      if (tree[child].dealt_card == card) {
        traverse(child, hero, lane, opp_w, hero_reach, chance_depth + 1, depth + 1, out);
        return;
      }
    }
    throw std::runtime_error("sampled traversal: no chance child matches the dealt card");
  }

  const int actor = node.actor;
  const std::uint16_t actions = node.num_children;
  const std::size_t offset = layout_.node_offset[node.decision_index];

  if (actor != hero) {
    // Pinned seat: one regret-matched row, scalar reach per action, and the
    // action loop ENUMERATES rather than samples - a public preflop tree is
    // small enough that the lower variance is free.
    out.assign(my_hands, 0.0f);
    const std::uint16_t hq = lane.deal.hand[static_cast<std::size_t>(actor)];
    if (hq == kNoHand) return;
    const std::uint32_t actor_hands = layout_.node_hands[node.decision_index];
    std::array<float, kMaxActionsSampled> sigma{};
    float pos_sum = 0.0f;
    for (std::uint16_t a = 0; a < actions; ++a) {
      const float r = regrets_[offset + static_cast<std::size_t>(a) * actor_hands + hq];
      sigma[a] = r > 0.0f ? r : 0.0f;
      pos_sum += sigma[a];
    }
    if (pos_sum > 0.0f) {
      for (std::uint16_t a = 0; a < actions; ++a) sigma[a] /= pos_sum;
    } else {
      const float uniform = 1.0f / static_cast<float>(actions);
      for (std::uint16_t a = 0; a < actions; ++a) sigma[a] = uniform;
    }
    std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
    for (std::uint16_t a = 0; a < actions; ++a) {
      traverse(node.first_child + a, hero, lane, opp_w * static_cast<double>(sigma[a]),
               hero_reach, chance_depth, depth + 1, child_out);
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += child_out[h];
    }
    return;
  }

  // Hero node: vectorized regret matching over every hand - the vectorized
  // core's update shape against a one-deal opponent measure.
  std::vector<float>& sigma = lane.sigma_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_vals = lane.child_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_reach = lane.reach_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
  const std::size_t cells = static_cast<std::size_t>(actions) * my_hands;
  sigma.resize(cells);
  child_vals.resize(cells);
  child_reach.resize(my_hands);

  for (std::uint32_t h = 0; h < my_hands; ++h) {
    float pos_sum = 0.0f;
    for (std::uint16_t a = 0; a < actions; ++a) {
      const float r = regrets_[offset + static_cast<std::size_t>(a) * my_hands + h];
      const float p = r > 0.0f ? r : 0.0f;
      sigma[static_cast<std::size_t>(a) * my_hands + h] = p;
      pos_sum += p;
    }
    if (pos_sum > 0.0f) {
      for (std::uint16_t a = 0; a < actions; ++a) {
        sigma[static_cast<std::size_t>(a) * my_hands + h] /= pos_sum;
      }
    } else {
      const float uniform = 1.0f / static_cast<float>(actions);
      for (std::uint16_t a = 0; a < actions; ++a) {
        sigma[static_cast<std::size_t>(a) * my_hands + h] = uniform;
      }
    }
  }

  for (std::uint16_t a = 0; a < actions; ++a) {
    const float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
    for (std::uint32_t h = 0; h < my_hands; ++h) child_reach[h] = hero_reach[h] * srow[h];
    traverse(node.first_child + a, hero, lane, opp_w, child_reach, chance_depth, depth + 1,
             child_out);
    std::copy(child_out.begin(), child_out.end(),
              child_vals.begin() + static_cast<std::size_t>(a) * my_hands);
  }

  out.assign(my_hands, 0.0f);
  for (std::uint16_t a = 0; a < actions; ++a) {
    const float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
    const float* vrow = child_vals.data() + static_cast<std::size_t>(a) * my_hands;
    for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += srow[h] * vrow[h];
  }

  float* rd = lane.regret_delta.data() + offset;
  float* sd = lane.strat_delta.data() + offset;
  for (std::uint16_t a = 0; a < actions; ++a) {
    const std::size_t row = static_cast<std::size_t>(a) * my_hands;
    const float* srow = sigma.data() + row;
    const float* vrow = child_vals.data() + row;
    for (std::uint32_t h = 0; h < my_hands; ++h) {
      rd[row + h] += vrow[h] - out[h];
      sd[row + h] += hero_reach[h] * srow[h];
    }
  }
}

void SampledCfrSolver::average_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  const std::size_t offset = layout_.node_offset[node.decision_index];
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  out.assign(static_cast<std::size_t>(hands) * actions, 0.0f);
  // Same contract as CfrSolver::average_strategy: hand-major rows summing to
  // 1, uniform where nothing accumulated.
  for (std::uint32_t h = 0; h < hands; ++h) {
    float sum = 0.0f;
    for (std::uint16_t a = 0; a < actions; ++a) {
      sum += strat_sum_[offset + static_cast<std::size_t>(a) * hands + h];
    }
    float* row = out.data() + static_cast<std::size_t>(h) * actions;
    if (sum > 0.0f) {
      for (std::uint16_t a = 0; a < actions; ++a) {
        row[a] = strat_sum_[offset + static_cast<std::size_t>(a) * hands + h] / sum;
      }
    } else {
      const float uniform = 1.0f / static_cast<float>(actions);
      for (std::uint16_t a = 0; a < actions; ++a) row[a] = uniform;
    }
  }
}

}  // namespace engine
