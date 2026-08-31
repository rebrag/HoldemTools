#include "solver/sampled_cfr.hpp"

#include <algorithm>
#include <cmath>
#include <array>
#include <cstddef>
#include <limits>
#include <stdexcept>
#include <string>

namespace engine {

namespace {

constexpr std::uint16_t kNoHand = std::numeric_limits<std::uint16_t>::max();
constexpr std::uint32_t kNoJointRow = std::numeric_limits<std::uint32_t>::max();
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
                                   const SampledConfig& config, int threads, AgentMap agents)
    : game_(game), deals_(deals), config_(config), agents_(std::move(agents)) {
  if (agents_.seat_to_agent.empty()) agents_ = AgentMap::identity(game.num_seats());
  frozen_seat_.assign(static_cast<std::size_t>(game.num_seats()), false);
  frozen_rows_.resize(game.tree().size());
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
  // The suit-symmetry quotient: storage rows are per CLASS when the game
  // reports one and the config keeps it on (the default). Identity
  // otherwise, with store_* equal to the hand layout, so that path is
  // bit-for-bit the unquotiented solver.
  {
    std::vector<std::uint16_t> class_of;
    int num_classes = 0;
    deals.hand_classes(class_of, num_classes);
    if (config_.symmetry && num_classes > 0) {
      class_of_ = std::move(class_of);
      num_classes_ = num_classes;
    } else if (config_.symmetry && config_.symmetry_explicit && num_classes == 0) {
      throw std::runtime_error(
          "algorithm.sampled.symmetry was requested but this game reports no "
          "suit-symmetry quotient");
    }
  }
  if (num_classes_ == 0) {
    int max_hands = 0;
    for (int seat = 0; seat < game.num_seats(); ++seat) {
      max_hands = std::max(max_hands, game.num_hands(seat));
    }
    class_of_.resize(static_cast<std::size_t>(max_hands));
    for (int h = 0; h < max_hands; ++h) class_of_[static_cast<std::size_t>(h)] = static_cast<std::uint16_t>(h);
  }
  if (agents_.has_team()) {
    // The team's infosets are (node, own hand, partner hand): rows are the
    // suit orbits of the ordered pair - the exact quotient, or nothing.
    if (!deals.joint_hand_classes(joint_class_, joint_classes_) || joint_classes_ <= 0) {
      throw std::runtime_error(
          "this game/range cannot form the joint suit quotient a hand-sharing team "
          "needs (asymmetric ranges break the orbit structure)");
    }
    universe_hands_ = game.num_hands(0);
  }
  store_offset_.assign(layout_.node_offset.size(), InfosetLayout::kNoOffset);
  store_hands_.assign(layout_.node_hands.size(), 0);
  store_total_ = 0;
  for (const Node& node : game.tree().nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const std::size_t d = node.decision_index;
    const bool team_actor = agents_.teammate_of[node.actor] >= 0;
    const std::uint32_t rows =
        team_actor ? static_cast<std::uint32_t>(joint_classes_)
                   : (num_classes_ > 0 ? static_cast<std::uint32_t>(num_classes_)
                                       : layout_.node_hands[d]);
    store_offset_[d] = store_total_;
    store_hands_[d] = rows;
    store_total_ += static_cast<std::size_t>(layout_.node_actions[d]) * rows;
  }
  regrets_.assign(store_total_, 0.0f);
  strat_sum_.assign(store_total_, 0.0f);
  max_depth_ = tree_depth(game.tree());
  lanes_.resize(config_.lanes);
  for (Lane& lane : lanes_) {
    lane.regret_delta.assign(store_total_, 0.0f);
    lane.strat_delta.assign(store_total_, 0.0f);
    lane.class_sigma.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.mate_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.sigma_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.child_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.reach_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
    lane.value_stack.resize(static_cast<std::size_t>(max_depth_) + 2);
  }
  pool_ = std::make_unique<ThreadPool>(resolve_thread_count(threads));
  split_budget_ = pool_->threads() > 1 ? pool_->threads() * 4 : 1;
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
      for (std::size_t i = 0; i < store_total_; ++i) regrets_[i] += lane.regret_delta[i];
      for (std::size_t i = 0; i < store_total_; ++i) strat_sum_[i] += lane.strat_delta[i];
    }
    t_ = b1;
  }
}

void SampledCfrSolver::run_iteration(std::uint64_t t, Lane& lane) {
  deals_.sample_deal(config_.seed, t, lane.deal);
  deals_.deal_strengths(lane.deal, lane.strengths);
  const int seats = game_.num_seats();
  for (int hero = 0; hero < seats; ++hero) {
    // Frozen seats (unaware mode) do not train; their policy is read from
    // the frozen rows wherever they are pinned.
    if (frozen_seat_[static_cast<std::size_t>(hero)]) continue;
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
    traverse(game_.tree().root(), hero, lane, w, lane.hero_root, nullptr, 0, 0,
             lane.value_stack[0]);
  }
}

void SampledCfrSolver::traverse(NodeId id, int hero, Lane& lane, double opp_w,
                               const std::vector<float>& hero_reach,
                               const float* mate_reach, int chance_depth, int depth,
                               std::vector<float>& out) {
  const PublicTree& tree = game_.tree();
  const Node& node = tree[id];
  const std::uint32_t my_hands = static_cast<std::uint32_t>(game_.num_hands(hero));

  if (node.kind == NodeKind::Terminal) {
    const int hero_mate = agents_.teammate_of[hero];
    if (node.terminal_kind == TerminalKind::Fold) {
      // Public information only: the pot goes to the last seat standing and
      // everyone pays what they committed, on every deal alike. A team hero
      // values its partner's chips as its own.
      double share = node.fold_winner == hero ? static_cast<double>(node.pot) : 0.0;
      double commit = static_cast<double>(node.commit[hero]);
      if (hero_mate >= 0) {
        share += node.fold_winner == hero_mate ? static_cast<double>(node.pot) : 0.0;
        commit += static_cast<double>(node.commit[hero_mate]);
      }
      const float v = static_cast<float>(opp_w * (share - commit));
      out.assign(my_hands, v);
    } else {
      if (hero_mate >= 0) {
        deals_.deal_showdown_values_team(id, hero, hero_mate, lane.deal, lane.strengths, out);
      } else {
        deals_.deal_showdown_values(id, hero, lane.deal, lane.strengths, out);
      }
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
        traverse(child, hero, lane, opp_w, hero_reach, mate_reach, chance_depth + 1,
                 depth + 1, out);
        return;
      }
    }
    throw std::runtime_error("sampled traversal: no chance child matches the dealt card");
  }

  const int actor = node.actor;
  const std::uint16_t actions = node.num_children;
  const std::size_t offset = store_offset_[node.decision_index];
  const std::uint32_t rows = store_hands_[node.decision_index];

  if (actor != hero) {
    out.assign(my_hands, 0.0f);
    const std::uint16_t hq = lane.deal.hand[static_cast<std::size_t>(actor)];
    if (hq == kNoHand) return;
    if (agents_.teammate_of[actor] == hero) {
      // THE HERO'S OWN PARTNER. Its policy conditions on the hero's hand,
      // and the hero is vectorized - so its sigma is a VECTOR over hero
      // hands (joint row (partner's dealt hand, h)), folded into the
      // returned values per hand rather than the scalar weight. Getting
      // this wrong - conditioning on the hero's DEALT hand - trains each
      // member against a partner reacting to the wrong cards, and the
      // measured result was a team that lost to its own no-team baseline.
      std::vector<float>& sig = lane.sigma_stack[static_cast<std::size_t>(depth)];
      const std::size_t cells = static_cast<std::size_t>(actions) * my_hands;
      sig.resize(cells);
      const std::size_t mbase =
          static_cast<std::size_t>(hq) * static_cast<std::size_t>(universe_hands_);
      for (std::uint32_t h = 0; h < my_hands; ++h) {
        const std::uint32_t jc = joint_class_[mbase + h];
        const std::size_t r0 = offset + (jc == kNoJointRow ? 0 : jc);
        float pos_sum = 0.0f;
        for (std::uint16_t a = 0; a < actions; ++a) {
          const float r = regrets_[r0 + static_cast<std::size_t>(a) * rows];
          const float pr = r > 0.0f ? r : 0.0f;
          sig[static_cast<std::size_t>(a) * my_hands + h] = pr;
          pos_sum += pr;
        }
        if (pos_sum > 0.0f) {
          for (std::uint16_t a = 0; a < actions; ++a) {
            sig[static_cast<std::size_t>(a) * my_hands + h] /= pos_sum;
          }
        } else {
          const float uniform = 1.0f / static_cast<float>(actions);
          for (std::uint16_t a = 0; a < actions; ++a) {
            sig[static_cast<std::size_t>(a) * my_hands + h] = uniform;
          }
        }
      }
      // TWO-SIDED TEAM UPDATE. Descend each action WITHOUT this node's
      // sigma, so the child values u_a[h] are the mate's counterfactual
      // action values (values are elementwise-linear in the weights, so
      // folding sigma in after the descent returns the same expectation to
      // the parent). That turns every deal into a CFR update for the mate's
      // FULL conditioned row (own = dealt hand, partner = every hero hand)
      // instead of only the dealt pair - per-cell coverage goes from
      // freq(own)*freq(partner) to about freq(own)+freq(partner), which is
      // what makes the conditioned charts converge.
      std::vector<float>& child_vals = lane.child_stack[static_cast<std::size_t>(depth)];
      std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
      std::vector<float>& mate_child = lane.mate_stack[static_cast<std::size_t>(depth)];
      child_vals.resize(cells);
      mate_child.resize(my_hands);
      for (std::uint16_t a = 0; a < actions; ++a) {
        const float* srow = sig.data() + static_cast<std::size_t>(a) * my_hands;
        if (mate_reach != nullptr) {
          for (std::uint32_t h = 0; h < my_hands; ++h) {
            mate_child[h] = mate_reach[h] * srow[h];
          }
        } else {
          for (std::uint32_t h = 0; h < my_hands; ++h) mate_child[h] = srow[h];
        }
        traverse(node.first_child + a, hero, lane, opp_w, hero_reach, mate_child.data(),
                 chance_depth, depth + 1, child_out);
        std::copy(child_out.begin(), child_out.end(),
                  child_vals.begin() + static_cast<std::size_t>(a) * my_hands);
      }
      for (std::uint16_t a = 0; a < actions; ++a) {
        const float* srow = sig.data() + static_cast<std::size_t>(a) * my_hands;
        const float* vrow = child_vals.data() + static_cast<std::size_t>(a) * my_hands;
        for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += srow[h] * vrow[h];
      }
      // Regret: hero_reach[h] times the returned value (which already
      // carries the external opponents' reach via opp_w at the terminals) is
      // exactly the everyone-but-the-mate counterfactual weight - no mate
      // sigma ever reaches the values, since every mate node folds its own
      // sigma in only after its own descent. Strategy sum: weighted by the
      // hero's reach (the actor's PARTNER) and the actor's own earlier
      // sigma, so the stored mass is the conditioning's actual reach.
      float* rd = lane.regret_delta.data() + offset;
      float* sd = lane.strat_delta.data() + offset;
      for (std::uint16_t a = 0; a < actions; ++a) {
        const std::size_t srow_off = static_cast<std::size_t>(a) * my_hands;
        const std::size_t drow_off = static_cast<std::size_t>(a) * rows;
        const float* srow = sig.data() + srow_off;
        const float* vrow = child_vals.data() + srow_off;
        for (std::uint32_t h = 0; h < my_hands; ++h) {
          const std::uint32_t jc = joint_class_[mbase + h];
          if (jc == kNoJointRow) continue;
          rd[drow_off + jc] += hero_reach[h] * (vrow[h] - out[h]);
          const float own = mate_reach != nullptr ? mate_reach[h] : 1.0f;
          sd[drow_off + jc] += hero_reach[h] * own * srow[h];
        }
      }
      return;
    }
    // Any other pinned seat: one row, scalar reach per action, and the
    // action loop ENUMERATES rather than samples - a public preflop tree is
    // small enough that the lower variance is free. The row is frozen
    // (unaware opponents), joint (a team actor conditioning on its OWN
    // partner, both pinned), or the plain class row.
    std::array<float, kMaxActionsSampled> sigma{};
    if (frozen_seat_[static_cast<std::size_t>(actor)] &&
        !frozen_rows_[static_cast<std::size_t>(id)].empty()) {
      const std::vector<float>& fr = frozen_rows_[static_cast<std::size_t>(id)];
      for (std::uint16_t a = 0; a < actions; ++a) {
        sigma[a] = fr[static_cast<std::size_t>(hq) * actions + a];
      }
    } else {
      std::size_t hrow;
      const int amate = agents_.teammate_of[actor];
      if (amate >= 0) {
        const std::uint16_t hm = lane.deal.hand[static_cast<std::size_t>(amate)];
        if (hm == kNoHand) return;
        const std::uint32_t jc =
            joint_class_[static_cast<std::size_t>(hq) *
                             static_cast<std::size_t>(universe_hands_) +
                         hm];
        if (jc == kNoJointRow) return;  // impossible deal
        hrow = jc;
      } else {
        hrow = class_of_[hq];
      }
      float pos_sum = 0.0f;
      for (std::uint16_t a = 0; a < actions; ++a) {
        const float r = regrets_[offset + static_cast<std::size_t>(a) * rows + hrow];
        sigma[a] = r > 0.0f ? r : 0.0f;
        pos_sum += sigma[a];
      }
      if (pos_sum > 0.0f) {
        for (std::uint16_t a = 0; a < actions; ++a) sigma[a] /= pos_sum;
      } else {
        const float uniform = 1.0f / static_cast<float>(actions);
        for (std::uint16_t a = 0; a < actions; ++a) sigma[a] = uniform;
      }
    }
    std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
    for (std::uint16_t a = 0; a < actions; ++a) {
      traverse(node.first_child + a, hero, lane, opp_w * static_cast<double>(sigma[a]),
               hero_reach, mate_reach, chance_depth, depth + 1, child_out);
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += child_out[h];
    }
    return;
  }

  // Hero node. A TEAM hero conditions on its pinned partner: each hand h
  // reads the joint row for (h, partner's dealt hand) - that indexing IS
  // hand-sharing. Deal-blocked hands map to row 0 harmlessly: their reach,
  // terminal values, and therefore deltas are all exactly zero.
  const int mate = agents_.teammate_of[hero];
  if (mate >= 0) {
    const std::uint16_t hm = lane.deal.hand[static_cast<std::size_t>(mate)];
    if (hm == kNoHand) {
      out.assign(my_hands, 0.0f);
      return;
    }
    std::vector<std::uint32_t>& team_rows = lane.team_rows;
    team_rows.resize(my_hands);
    const std::size_t hbase = static_cast<std::size_t>(hm);
    for (std::uint32_t h = 0; h < my_hands; ++h) {
      const std::uint32_t jc =
          joint_class_[static_cast<std::size_t>(h) *
                           static_cast<std::size_t>(universe_hands_) +
                       hbase];
      team_rows[h] = jc == kNoJointRow ? 0 : jc;
    }
    std::vector<float>& sigma = lane.sigma_stack[static_cast<std::size_t>(depth)];
    std::vector<float>& child_vals = lane.child_stack[static_cast<std::size_t>(depth)];
    std::vector<float>& child_reach = lane.reach_stack[static_cast<std::size_t>(depth)];
    std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
    const std::size_t cells = static_cast<std::size_t>(actions) * my_hands;
    sigma.resize(cells);
    child_vals.resize(cells);
    child_reach.resize(my_hands);
    for (std::uint32_t h = 0; h < my_hands; ++h) {
      const std::size_t r0 = offset + team_rows[h];
      float pos_sum = 0.0f;
      for (std::uint16_t a = 0; a < actions; ++a) {
        const float r = regrets_[r0 + static_cast<std::size_t>(a) * rows];
        const float pr = r > 0.0f ? r : 0.0f;
        sigma[static_cast<std::size_t>(a) * my_hands + h] = pr;
        pos_sum += pr;
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
      traverse(node.first_child + a, hero, lane, opp_w, child_reach, mate_reach,
               chance_depth, depth + 1, child_out);
      std::copy(child_out.begin(), child_out.end(),
                child_vals.begin() + static_cast<std::size_t>(a) * my_hands);
    }
    out.assign(my_hands, 0.0f);
    for (std::uint16_t a = 0; a < actions; ++a) {
      const float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
      const float* vrow = child_vals.data() + static_cast<std::size_t>(a) * my_hands;
      for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += srow[h] * vrow[h];
    }
    // Strategy sums carry the partner's reach too (mate_reach), so the
    // joint mass measures how often the conditioning reaches this node -
    // see the traverse contract in the header.
    float* rd = lane.regret_delta.data() + offset;
    float* sd = lane.strat_delta.data() + offset;
    for (std::uint16_t a = 0; a < actions; ++a) {
      const std::size_t srow_off = static_cast<std::size_t>(a) * my_hands;
      const std::size_t drow_off = static_cast<std::size_t>(a) * rows;
      const float* srow = sigma.data() + srow_off;
      const float* vrow = child_vals.data() + srow_off;
      for (std::uint32_t h = 0; h < my_hands; ++h) {
        const float mr = mate_reach != nullptr ? mate_reach[h] : 1.0f;
        rd[drow_off + team_rows[h]] += vrow[h] - out[h];
        sd[drow_off + team_rows[h]] += hero_reach[h] * mr * srow[h];
      }
    }
    return;
  }

  // Non-team hero: regret matching per STORAGE row (a suit class under the
  // quotient, a hand without it), broadcast to a per-hand sigma for reach
  // descent. On the identity path this computes the exact floats the
  // unquotiented code did - the broadcast is a copy.
  std::vector<float>& class_sigma = lane.class_sigma[static_cast<std::size_t>(depth)];
  std::vector<float>& sigma = lane.sigma_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_vals = lane.child_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_reach = lane.reach_stack[static_cast<std::size_t>(depth)];
  std::vector<float>& child_out = lane.value_stack[static_cast<std::size_t>(depth) + 1];
  const std::size_t cells = static_cast<std::size_t>(actions) * my_hands;
  class_sigma.resize(static_cast<std::size_t>(actions) * rows);
  sigma.resize(cells);
  child_vals.resize(cells);
  child_reach.resize(my_hands);

  for (std::uint32_t c = 0; c < rows; ++c) {
    float pos_sum = 0.0f;
    for (std::uint16_t a = 0; a < actions; ++a) {
      const float r = regrets_[offset + static_cast<std::size_t>(a) * rows + c];
      const float p = r > 0.0f ? r : 0.0f;
      class_sigma[static_cast<std::size_t>(a) * rows + c] = p;
      pos_sum += p;
    }
    if (pos_sum > 0.0f) {
      for (std::uint16_t a = 0; a < actions; ++a) {
        class_sigma[static_cast<std::size_t>(a) * rows + c] /= pos_sum;
      }
    } else {
      const float uniform = 1.0f / static_cast<float>(actions);
      for (std::uint16_t a = 0; a < actions; ++a) {
        class_sigma[static_cast<std::size_t>(a) * rows + c] = uniform;
      }
    }
  }
  for (std::uint16_t a = 0; a < actions; ++a) {
    const float* crow = class_sigma.data() + static_cast<std::size_t>(a) * rows;
    float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
    for (std::uint32_t h = 0; h < my_hands; ++h) srow[h] = crow[class_of_[h]];
  }

  for (std::uint16_t a = 0; a < actions; ++a) {
    const float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
    for (std::uint32_t h = 0; h < my_hands; ++h) child_reach[h] = hero_reach[h] * srow[h];
    traverse(node.first_child + a, hero, lane, opp_w, child_reach, mate_reach, chance_depth,
             depth + 1, child_out);
    std::copy(child_out.begin(), child_out.end(),
              child_vals.begin() + static_cast<std::size_t>(a) * my_hands);
  }

  out.assign(my_hands, 0.0f);
  for (std::uint16_t a = 0; a < actions; ++a) {
    const float* srow = sigma.data() + static_cast<std::size_t>(a) * my_hands;
    const float* vrow = child_vals.data() + static_cast<std::size_t>(a) * my_hands;
    for (std::uint32_t h = 0; h < my_hands; ++h) out[h] += srow[h] * vrow[h];
  }

  // Deltas land on the STORAGE rows: under the quotient every member combo
  // of a class adds its sample into the shared row - that pooling IS the
  // variance reduction. Hand order is fixed, so the accumulation stays
  // deterministic; identity reduces to the original per-hand loop.
  float* rd = lane.regret_delta.data() + offset;
  float* sd = lane.strat_delta.data() + offset;
  for (std::uint16_t a = 0; a < actions; ++a) {
    const std::size_t srow_off = static_cast<std::size_t>(a) * my_hands;
    const std::size_t drow_off = static_cast<std::size_t>(a) * rows;
    const float* srow = sigma.data() + srow_off;
    const float* vrow = child_vals.data() + srow_off;
    for (std::uint32_t h = 0; h < my_hands; ++h) {
      rd[drow_off + class_of_[h]] += vrow[h] - out[h];
      sd[drow_off + class_of_[h]] += hero_reach[h] * srow[h];
    }
  }
}

void SampledCfrSolver::average_strategy(NodeId id, std::vector<float>& out) const {
  const Node& node = game_.tree()[id];
  const std::size_t offset = store_offset_[node.decision_index];
  const std::uint32_t rows = store_hands_[node.decision_index];
  const std::uint32_t hands = layout_.node_hands[node.decision_index];
  const std::uint16_t actions = layout_.node_actions[node.decision_index];
  out.assign(static_cast<std::size_t>(hands) * actions, 0.0f);
  // A FROZEN seat (unaware phase 2) never trains in this solver, so its
  // strategy sums are all zero and the fallback below would export uniform
  // rows. Its actual play is the frozen baseline - export that.
  if (frozen_seat_[static_cast<std::size_t>(node.actor)] &&
      !frozen_rows_[static_cast<std::size_t>(id)].empty()) {
    const std::vector<float>& fr = frozen_rows_[static_cast<std::size_t>(id)];
    std::copy(fr.begin(), fr.end(), out.begin());
    return;
  }
  // Same contract as CfrSolver::average_strategy: hand-major rows summing to
  // 1, uniform where nothing accumulated.
  // A team actor's exported rows are the MARGINAL over the partner: per
  // own hand, the joint strategy-sum rows summed across every compatible
  // partner, then normalized - reach-weighted by construction, since
  // strategy sums accumulate reach. The full conditioned strategy lives in
  // team_rollup_json(); metadata flags the export as marginal.
  if (agents_.teammate_of[node.actor] >= 0) {
    const std::size_t H = static_cast<std::size_t>(universe_hands_);
    for (std::uint32_t h = 0; h < hands; ++h) {
      float sums[kMaxActionsSampled] = {};
      float total = 0.0f;
      const std::size_t base = static_cast<std::size_t>(h) * H;
      for (std::size_t m = 0; m < H; ++m) {
        const std::uint32_t jc = joint_class_[base + m];
        if (jc == kNoJointRow) continue;
        for (std::uint16_t a = 0; a < actions; ++a) {
          const float v = strat_sum_[offset + static_cast<std::size_t>(a) * rows + jc];
          sums[a] += v;
          total += v;
        }
      }
      float* row = out.data() + static_cast<std::size_t>(h) * actions;
      if (total > 0.0f) {
        for (std::uint16_t a = 0; a < actions; ++a) row[a] = sums[a] / total;
      } else {
        const float uniform = 1.0f / static_cast<float>(actions);
        for (std::uint16_t a = 0; a < actions; ++a) row[a] = uniform;
      }
    }
    return;
  }
  // Hand-major rows summing to 1, per the StrategySource contract. Under
  // the quotient every member combo of a class reads the same storage row,
  // so members emit IDENTICAL rows by construction - the consumers cannot
  // tell a quotiented solve apart from a converged symmetric one.
  for (std::uint32_t h = 0; h < hands; ++h) {
    const std::uint16_t c = class_of_[h];
    float sum = 0.0f;
    for (std::uint16_t a = 0; a < actions; ++a) {
      sum += strat_sum_[offset + static_cast<std::size_t>(a) * rows + c];
    }
    float* row = out.data() + static_cast<std::size_t>(h) * actions;
    if (sum > 0.0f) {
      for (std::uint16_t a = 0; a < actions; ++a) {
        row[a] = strat_sum_[offset + static_cast<std::size_t>(a) * rows + c] / sum;
      }
    } else {
      const float uniform = 1.0f / static_cast<float>(actions);
      for (std::uint16_t a = 0; a < actions; ++a) row[a] = uniform;
    }
  }
}

void SampledCfrSolver::freeze_seats_from(const StrategySource& source,
                                         const std::vector<bool>& frozen) {
  frozen_seat_ = frozen;
  const PublicTree& tree = game_.tree();
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& node = tree[id];
    if (node.kind != NodeKind::Decision) continue;
    if (!frozen_seat_[static_cast<std::size_t>(node.actor)]) continue;
    source.average_strategy(id, frozen_rows_[static_cast<std::size_t>(id)]);
  }
}

void SampledCfrSolver::pinned_sigma(NodeId id, int actor, const Deal& deal,
                                    float* out) const {
  // AVERAGE-profile sigma for one pinned seat - the EV walk's policy.
  // Frozen seats read their frozen hand-major rows; a team seat reads its
  // joint strategy-sum row (the conditioned policy, NOT the marginal);
  // everyone else reads the class row.
  const Node& node = game_.tree()[id];
  const std::uint16_t actions = node.num_children;
  const std::uint16_t hq = deal.hand[static_cast<std::size_t>(actor)];
  const float uniform = 1.0f / static_cast<float>(actions);
  if (frozen_seat_[static_cast<std::size_t>(actor)] &&
      !frozen_rows_[static_cast<std::size_t>(id)].empty()) {
    const std::vector<float>& fr = frozen_rows_[static_cast<std::size_t>(id)];
    for (std::uint16_t a = 0; a < actions; ++a) {
      out[a] = fr[static_cast<std::size_t>(hq) * actions + a];
    }
    return;
  }
  const std::size_t offset = store_offset_[node.decision_index];
  const std::uint32_t rows = store_hands_[node.decision_index];
  std::size_t row;
  const int amate = agents_.teammate_of[actor];
  if (amate >= 0) {
    const std::uint32_t jc =
        joint_class_[static_cast<std::size_t>(hq) * static_cast<std::size_t>(universe_hands_) +
                     deal.hand[static_cast<std::size_t>(amate)]];
    if (jc == kNoJointRow) {
      for (std::uint16_t a = 0; a < actions; ++a) out[a] = uniform;
      return;
    }
    row = jc;
  } else {
    row = class_of_[hq];
  }
  float sum = 0.0f;
  for (std::uint16_t a = 0; a < actions; ++a) {
    out[a] = strat_sum_[offset + static_cast<std::size_t>(a) * rows + row];
    sum += out[a];
  }
  if (sum > 0.0f) {
    for (std::uint16_t a = 0; a < actions; ++a) out[a] /= sum;
  } else {
    for (std::uint16_t a = 0; a < actions; ++a) out[a] = uniform;
  }
}

void SampledCfrSolver::ev_walk(NodeId id, double weight, const Deal& deal,
                               const std::vector<std::uint32_t>& strengths,
                               std::vector<double>& pinned_scratch,
                               std::vector<double>& ev) const {
  if (weight <= 0.0) return;
  const PublicTree& tree = game_.tree();
  const Node& node = tree[id];
  const int seats = game_.num_seats();
  if (node.kind == NodeKind::Terminal) {
    if (node.terminal_kind == TerminalKind::Fold) {
      for (int q = 0; q < seats; ++q) {
        const double share = node.fold_winner == q ? static_cast<double>(node.pot) : 0.0;
        ev[static_cast<std::size_t>(q)] +=
            weight * (share - static_cast<double>(node.commit[q]));
      }
    } else {
      deals_.deal_showdown_pinned(id, deal, strengths, seats, pinned_scratch);
      for (int q = 0; q < seats; ++q) {
        ev[static_cast<std::size_t>(q)] += weight * pinned_scratch[static_cast<std::size_t>(q)];
      }
    }
    return;
  }
  if (node.kind == NodeKind::Chance) {
    // The EV walk follows the same dealt-board convention as the training
    // traversal; preflop trees have no chance nodes, toys have one level.
    for (int c = 0; c < node.num_children; ++c) {
      const NodeId child = node.first_child + static_cast<NodeId>(c);
      if (tree[child].dealt_card == deal.board[0]) {
        ev_walk(child, weight, deal, strengths, pinned_scratch, ev);
        return;
      }
    }
    throw std::runtime_error("ev walk: no chance child matches the dealt card");
  }
  float sigma[kMaxActionsSampled];
  pinned_sigma(id, node.actor, deal, sigma);
  for (std::uint16_t a = 0; a < node.num_children; ++a) {
    ev_walk(node.first_child + a, weight * static_cast<double>(sigma[a]), deal, strengths,
            pinned_scratch, ev);
  }
}

std::vector<double> SampledCfrSolver::sampled_ev(std::uint64_t num_deals,
                                                 std::uint64_t seed) const {
  const int seats = game_.num_seats();
  std::vector<double> ev(static_cast<std::size_t>(seats), 0.0);
  Deal deal;
  std::vector<std::uint32_t> strengths;
  std::vector<double> pinned_scratch;
  std::uint64_t counted = 0;
  for (std::uint64_t t = 0; t < num_deals; ++t) {
    deals_.sample_deal(seed, t, deal);
    bool ok = true;
    for (int q = 0; q < seats; ++q) {
      if (deal.hand[static_cast<std::size_t>(q)] == kNoHand) ok = false;
    }
    if (!ok) continue;  // a zero-range combo: skip, count nothing
    ++counted;
    deals_.deal_strengths(deal, strengths);
    ev_walk(game_.tree().root(), 1.0, deal, strengths, pinned_scratch, ev);
  }
  const double n = counted > 0 ? static_cast<double>(counted) : 1.0;
  for (double& v : ev) v /= n;
  return ev;
}

nlohmann::json SampledCfrSolver::team_rollup_json() const {
  nlohmann::json out = nlohmann::json::object();
  if (!agents_.has_team()) return out;
  std::vector<std::uint16_t> cls;
  int ncls = 0;
  deals_.hand_classes(cls, ncls);
  if (ncls <= 0) return out;
  const std::size_t H = static_cast<std::size_t>(universe_hands_);
  const std::size_t cells = static_cast<std::size_t>(ncls) * static_cast<std::size_t>(ncls);
  const PublicTree& tree = game_.tree();
  for (NodeId id = 0; id < tree.size(); ++id) {
    const Node& node = tree[id];
    if (node.kind != NodeKind::Decision) continue;
    const int mate = agents_.teammate_of[node.actor];
    if (mate < 0) continue;
    const std::size_t offset = store_offset_[node.decision_index];
    const std::uint32_t rows = store_hands_[node.decision_index];
    const std::uint16_t actions = layout_.node_actions[node.decision_index];
    std::vector<double> freq(cells * actions, 0.0);
    std::vector<double> weight(cells, 0.0);
    for (std::size_t h = 0; h < H; ++h) {
      const std::size_t oc = cls[h];
      const std::size_t base = h * H;
      for (std::size_t m = 0; m < H; ++m) {
        const std::uint32_t jc = joint_class_[base + m];
        if (jc == kNoJointRow) continue;
        const std::size_t cell = static_cast<std::size_t>(cls[m]) * ncls + oc;
        double wsum = 0.0;
        for (std::uint16_t a = 0; a < actions; ++a) {
          const double v = strat_sum_[offset + static_cast<std::size_t>(a) * rows + jc];
          freq[cell * actions + a] += v;
          wsum += v;
        }
        weight[cell] += wsum;
      }
    }
    // Emit the first actions-1 frequencies (the last is 1 minus the rest),
    // rounded, nested [partner class][own class]. Keeps the metadata blob
    // an order of magnitude smaller than the naive dump. Alongside each
    // partner class, its REACH relative to the node's most-reached partner
    // class (strategy sums are reach-weighted, so the stored mass is a real
    // reach signal): the frontend uses it to flag conditionings that never
    // actually happen at this node - e.g. "partner folded AA".
    nlohmann::json fr = nlohmann::json::array();
    std::vector<double> partner_w(static_cast<std::size_t>(ncls), 0.0);
    double max_partner_w = 0.0;
    for (int pc = 0; pc < ncls; ++pc) {
      double sum = 0.0;
      for (int oc = 0; oc < ncls; ++oc) {
        sum += weight[static_cast<std::size_t>(pc) * ncls + static_cast<std::size_t>(oc)];
      }
      partner_w[static_cast<std::size_t>(pc)] = sum;
      max_partner_w = std::max(max_partner_w, sum);
    }
    nlohmann::json pw = nlohmann::json::array();
    for (int pc = 0; pc < ncls; ++pc) {
      const double rel =
          max_partner_w > 0.0 ? partner_w[static_cast<std::size_t>(pc)] / max_partner_w : 0.0;
      pw.push_back(std::round(rel * 10000.0) / 10000.0);
      nlohmann::json prow = nlohmann::json::array();
      for (int oc = 0; oc < ncls; ++oc) {
        const std::size_t cell = static_cast<std::size_t>(pc) * ncls + static_cast<std::size_t>(oc);
        nlohmann::json f = nlohmann::json::array();
        for (std::uint16_t a = 0; a + 1 < actions || actions == 1; ++a) {
          const double w = weight[cell];
          const double v = w > 0.0 ? freq[cell * actions + a] / w : 1.0 / actions;
          f.push_back(std::round(v * 10000.0) / 10000.0);
          if (actions == 1) break;
        }
        prow.push_back(std::move(f));
      }
      fr.push_back(std::move(prow));
    }
    nlohmann::json node_j;
    node_j["actor"] = node.actor;
    node_j["partner"] = mate;
    node_j["num_actions"] = actions;
    node_j["freq"] = std::move(fr);
    node_j["partner_reach"] = std::move(pw);
    out[std::to_string(id)] = std::move(node_j);
  }
  return out;
}

}  // namespace engine
