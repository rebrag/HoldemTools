#include <algorithm>
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
      const auto fold_in = [&](std::uint16_t k, const std::vector<float>& cbr,
                               const std::vector<float>& cev) {
        for (std::uint32_t h = 0; h < hands; ++h) {
          ev[h] += sigma[static_cast<std::size_t>(h) * actions + k] * cev[h];
          if (k == 0 || cbr[h] > br[h]) br[h] = cbr[h];
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

BrResult compute_best_response(const Game& game, const CfrSolver& solver) {
  const int seats = game.num_seats();
  const double z = game.total_profile_weight();
  BrResult result;
  result.br_value.resize(seats);
  result.ev.resize(seats);
  for (int p = 0; p < seats; ++p) {
    std::vector<std::vector<float>> reach(seats);
    for (int s = 0; s < seats; ++s) reach[s] = game.initial_range(s);
    std::vector<float> br, ev;
    BrTraverser{game, solver, solver.pool(), p}.traverse(game.tree().root(), reach, br, ev,
                                                        solver.split_budget(), 0);
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

}  // namespace engine
