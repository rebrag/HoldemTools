#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "solver/best_response.hpp"

namespace engine {

namespace {

// Recursion helper: returns, for `seat`'s hands, both the best-response
// counterfactual value (seat deviates, everyone else plays the average
// strategy) and the on-profile counterfactual value (seat also plays the
// average strategy).
//
// Splits sibling subtrees across the solver's pool the same way the CFR
// traversal does, and for the same reason: this pass runs at every
// checkpoint and walks the whole tree. Nothing here writes shared state -
// average_strategy() is a read - so the only per-task cost is a reach copy,
// and the fold-back below stays serial and in child order.
struct BrTraverser {
  const Game& game;
  const CfrSolver& solver;
  ThreadPool& pool;
  int seat;
  // Null = the plain Nash best response, bit-for-bit what this pass has always
  // computed. Non-null = the best response in the entropy-augmented game, whose
  // gap against the on-profile value is the QRE gap.
  const QreConfig* qre = nullptr;
  std::uint64_t t = 0;

  void traverse(NodeId id, std::vector<std::vector<float>>& reach,
                std::vector<float>& br, std::vector<float>& ev, int split, int fork_depth) {
    const PublicTree& tree = game.tree();
    const Node& node = tree[id];
    const std::uint32_t my_hands = static_cast<std::uint32_t>(game.num_hands(seat));
    br.assign(my_hands, 0.0f);
    ev.assign(my_hands, 0.0f);

    if (node.kind == NodeKind::Terminal) {
      game.terminal_values(id, seat, reach, ev);
      br = ev;
      return;
    }

    const int seats = game.num_seats();
    const int children = node.num_children;
    const bool fork = split > 1 && fork_depth < kMaxSplitLevels && children >= 2;
    const int child_split = fork ? std::max(1, split / children) : split;
    const int child_fork_depth = fork ? fork_depth + 1 : fork_depth;

    std::vector<std::vector<std::vector<float>>> forked_reach;
    std::vector<std::vector<float>> forked_br, forked_ev;
    if (fork) {
      forked_reach.assign(static_cast<std::size_t>(children), {});
      forked_br.assign(static_cast<std::size_t>(children), {});
      forked_ev.assign(static_cast<std::size_t>(children), {});
    }
    const auto run_children = [&](const auto& prepare) {
      pool.parallel_for(children, [&](int c) {
        const std::size_t i = static_cast<std::size_t>(c);
        forked_reach[i] = reach;
        prepare(c, forked_reach[i]);
        traverse(node.first_child + static_cast<NodeId>(c), forked_reach[i], forked_br[i],
                 forked_ev[i], child_split, child_fork_depth);
      });
    };

    if (node.kind == NodeKind::Chance) {
      const float w = static_cast<float>(game.chance_weight(id));
      const auto mask_for_card = [&](int card, std::vector<std::vector<float>>& target) {
        for (int s = 0; s < seats; ++s) {
          for (std::uint16_t h : game.hands_blocking_card(s, card)) target[s][h] = 0.0f;
        }
      };
      // Zero the hero's blocked hands, then accumulate branch-free - adding an
      // exact 0.0f is a no-op on values that start at +0.0f. Same trick as the
      // CFR traversal's chance node.
      const auto fold_in = [&](int card, std::vector<float>& cbr, std::vector<float>& cev) {
        for (std::uint16_t h : game.hands_blocking_card(seat, card)) {
          cbr[h] = 0.0f;
          cev[h] = 0.0f;
        }
        for (std::uint32_t h = 0; h < my_hands; ++h) {
          br[h] += w * cbr[h];
          ev[h] += w * cev[h];
        }
      };

      if (fork) {
        run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
          mask_for_card(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, child_reach);
        });
        for (int c = 0; c < children; ++c) {
          const std::size_t i = static_cast<std::size_t>(c);
          fold_in(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, forked_br[i],
                  forked_ev[i]);
        }
        return;
      }

      std::vector<float> cbr, cev;
      std::vector<std::vector<float>> saved(seats);
      for (int c = 0; c < children; ++c) {
        const NodeId child = node.first_child + static_cast<NodeId>(c);
        const int card = tree[child].dealt_card;
        for (int s = 0; s < seats; ++s) saved[s] = reach[s];
        mask_for_card(card, reach);
        traverse(child, reach, cbr, cev, child_split, child_fork_depth);
        fold_in(card, cbr, cev);
        for (int s = 0; s < seats; ++s) reach[s] = saved[s];
      }
      return;
    }

    const int actor = node.actor;
    const std::uint32_t hands = static_cast<std::uint32_t>(game.num_hands(actor));
    const std::uint16_t actions = node.num_children;
    std::vector<float> sigma;
    solver.average_strategy(id, sigma);

    if (actor == seat) {
      // Under QRE the hero's own nodes are regularized exactly as the solver's
      // traversal regularizes them: `br` becomes a SMOOTH maximum (log-sum-exp)
      // and `ev` is charged the same dilated KL. Their difference is therefore
      // exploitability in the entropy-augmented game - the quantity that
      // actually reaches zero at a QRE. Plain exploitability plateaus at a
      // lambda-dependent floor by construction, which is why this exists.
      //
      // Charging `ev` too is the part that is easy to miss: regularizing only
      // the best-response side would leave a gap that never closes.
      //
      // Only the hero's own entropy appears. In the saddle formulation
      // u + (1/L0)H(s0) - (1/L1)H(s1), seat p's objective carries its own
      // regularizer and not its opponent's, so opponent and chance nodes fold
      // children unchanged and deeper terms arrive through `cev` on their own.
      std::vector<float> compat, per_action;
      double inv_lambda = 0.0;
      double log_actions = 0.0;
      if (qre != nullptr) {
        game.compat_weights(actor, reach, compat);
        inv_lambda = 1.0 / qre->lambda_at(t, seat);
        log_actions = std::log(static_cast<double>(actions));
        per_action.assign(static_cast<std::size_t>(actions) * hands, 0.0f);
      }
      const auto fold_in = [&](std::uint16_t k, const std::vector<float>& cbr,
                               const std::vector<float>& cev) {
        for (std::uint32_t h = 0; h < hands; ++h) {
          ev[h] += sigma[static_cast<std::size_t>(h) * actions + k] * cev[h];
          if (k == 0 || cbr[h] > br[h]) br[h] = cbr[h];
        }
        if (qre != nullptr) {
          float* col = per_action.data() + static_cast<std::size_t>(k) * hands;
          for (std::uint32_t h = 0; h < hands; ++h) col[h] = cbr[h];
        }
      };
      if (fork) {
        // Own actions leave the reach vectors untouched on the way down.
        run_children([](int, std::vector<std::vector<float>>&) {});
        for (std::uint16_t k = 0; k < actions; ++k) fold_in(k, forked_br[k], forked_ev[k]);
      } else {
        std::vector<float> cbr, cev;
        for (std::uint16_t k = 0; k < actions; ++k) {
          traverse(node.first_child + k, reach, cbr, cev, child_split, child_fork_depth);
          fold_in(k, cbr, cev);
        }
      }
      if (qre == nullptr) return;

      // This pass is cold (measured at 0.06% of solve time), so everything
      // below is done in double: lambda * Q reaches the thousands on a wide
      // range and expf would overflow well before that.
      const double prob_floor = static_cast<double>(qre->min_prob);
      for (std::uint32_t h = 0; h < hands; ++h) {
        const double w = compat[h] > 0.0f ? static_cast<double>(compat[h]) : 0.0;
        if (w <= 0.0) {
          // The opponent holds nothing compatible with this hand: every
          // counterfactual value here is already exactly 0, and cbr/pi would be
          // a ratio of two denormals rather than a meaningful action value.
          br[h] = 0.0f;
          ev[h] = 0.0f;
          continue;
        }
        // Charge the on-profile value the same dilated KL(sigma || uniform)
        // the traversal charges.
        double kl = 0.0;
        for (std::uint16_t k = 0; k < actions; ++k) {
          const double p = static_cast<double>(sigma[static_cast<std::size_t>(h) * actions + k]);
          kl += p * (std::log(p > prob_floor ? p : prob_floor) + log_actions);
        }
        ev[h] -= static_cast<float>(w * inv_lambda * kl);

        // Smooth maximum. `scale` = pi(h)/lambda, and the shift by the plain
        // max that fold_in already computed is exactly the log-sum-exp
        // stabilizer - exact, because scale > 0 preserves which action is
        // largest.
        const double scale = w * inv_lambda;
        const double m = static_cast<double>(br[h]);
        double sum = 0.0;
        for (std::uint16_t k = 0; k < actions; ++k) {
          const double d =
              static_cast<double>(per_action[static_cast<std::size_t>(k) * hands + h]);
          sum += std::exp((d - m) / scale);
        }
        br[h] = static_cast<float>(m + scale * (std::log(sum) - log_actions));
      }
      return;
    }

    const auto fold_in = [&](const std::vector<float>& cbr, const std::vector<float>& cev) {
      for (std::uint32_t h = 0; h < my_hands; ++h) {
        br[h] += cbr[h];
        ev[h] += cev[h];
      }
    };
    if (fork) {
      run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
        for (std::uint32_t h = 0; h < hands; ++h) {
          child_reach[actor][h] =
              reach[actor][h] *
              sigma[static_cast<std::size_t>(h) * actions + static_cast<std::size_t>(c)];
        }
      });
      for (int c = 0; c < children; ++c) {
        const std::size_t i = static_cast<std::size_t>(c);
        fold_in(forked_br[i], forked_ev[i]);
      }
      return;
    }

    std::vector<float> cbr, cev;
    std::vector<float> saved = reach[actor];
    for (std::uint16_t k = 0; k < actions; ++k) {
      for (std::uint32_t h = 0; h < hands; ++h) {
        reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
      }
      traverse(node.first_child + k, reach, cbr, cev, child_split, child_fork_depth);
      fold_in(cbr, cev);
    }
    reach[actor] = saved;
  }
};

}  // namespace

namespace {

BrResult run_br(const Game& game, const CfrSolver& solver, const QreConfig* qre) {
  const int seats = game.num_seats();
  const double z = game.total_profile_weight();
  BrResult result;
  result.br_value.resize(seats);
  result.ev.resize(seats);
  for (int p = 0; p < seats; ++p) {
    std::vector<std::vector<float>> reach(seats);
    for (int s = 0; s < seats; ++s) reach[s] = game.initial_range(s);
    std::vector<float> br, ev;
    BrTraverser{game, solver, solver.pool(), p, qre, solver.iteration()}.traverse(
        game.tree().root(), reach, br, ev, solver.split_budget(), 0);
    const std::vector<float>& range = game.initial_range(p);
    double br_sum = 0.0, ev_sum = 0.0;
    for (std::size_t h = 0; h < range.size(); ++h) {
      br_sum += static_cast<double>(range[h]) * br[h];
      ev_sum += static_cast<double>(range[h]) * ev[h];
    }
    result.br_value[p] = br_sum / z;
    result.ev[p] = ev_sum / z;
  }
  return result;
}

}  // namespace

BrResult compute_best_response(const Game& game, const CfrSolver& solver) {
  return run_br(game, solver, nullptr);
}

BrResult compute_qre_best_response(const Game& game, const CfrSolver& solver) {
  // With no regularization in force the "QRE gap" would just be NashConv.
  // Returning that silently would let a misconfigured solve look like it
  // converged to something it never targeted, so callers must check
  // QreConfig::enabled - but returning the honest Nash number is the safe
  // fallback if one does not.
  if (!solver.qre().enabled) return run_br(game, solver, nullptr);
  return run_br(game, solver, &solver.qre());
}

}  // namespace engine
