#include "solver/depth_limit.hpp"

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "game/types.hpp"
#include "solver/cfr.hpp"
#include "util/parallel.hpp"

namespace engine {

namespace {

void descend(const PublicTree& trunc, const PublicTree& full, NodeId t, NodeId f,
             TruncationMap& map) {
  map.to_full[t] = f;
  map.to_trunc[f] = t;

  if (trunc[t].terminal_kind == TerminalKind::DepthLimit) {
    if (full[f].kind != NodeKind::Chance) {
      throw std::runtime_error("truncation boundary does not sit on a chance node in the full "
                               "tree - the two trees were built from different parameters");
    }
    map.boundary_trunc.push_back(t);
    map.boundary_full.push_back(f);
    return;  // everything below belongs to the full tree only
  }

  if (trunc[t].kind != full[f].kind || trunc[t].num_children != full[f].num_children) {
    throw std::runtime_error("truncated and full trees diverge above the depth limit at node " +
                             std::to_string(t));
  }
  for (std::uint16_t c = 0; c < trunc[t].num_children; ++c) {
    descend(trunc, full, trunc[t].first_child + c, full[f].first_child + c, map);
  }
}

// On-profile counterfactual values for one seat, recorded at the boundary.
//
// This is BrTraverser's `ev` half and nothing else: no best-response max, no
// QRE regularization. Kept separate rather than bolted onto that pass because
// the two want different things at a boundary node - the best response wants
// to walk through it, this wants to stop and record.
struct ProfileTraverser {
  const Game& game;
  const StrategySource& src;
  ThreadPool& pool;
  int seat;
  // Boundary index by full node id, kNoIndex elsewhere. Every boundary node
  // is reached exactly once, so the recording writes below never race.
  const std::vector<std::uint32_t>& boundary_index;
  // Null when the caller wants values rather than a recording, which is how
  // the matrix build reuses this pass.
  std::vector<std::vector<float>>* out_ev = nullptr;
  std::vector<std::vector<float>>* out_compat = nullptr;

  void traverse(NodeId id, std::vector<std::vector<float>>& reach, std::vector<float>& ev,
                int split, int fork_depth) {
    const PublicTree& tree = game.tree();
    const Node& node = tree[id];
    const std::uint32_t my_hands = static_cast<std::uint32_t>(game.num_hands(seat));
    ev.assign(my_hands, 0.0f);

    if (node.kind == NodeKind::Terminal) {
      game.terminal_values(id, seat, reach, ev);
      return;
    }

    const int seats = game.num_seats();
    const int children = node.num_children;
    const bool fork = split > 1 && fork_depth < kMaxSplitLevels && children >= 2;
    const int child_split = fork ? (split / children > 1 ? split / children : 1) : split;
    const int child_fork_depth = fork ? fork_depth + 1 : fork_depth;

    std::vector<std::vector<std::vector<float>>> forked_reach;
    std::vector<std::vector<float>> forked_ev;
    if (fork) {
      forked_reach.assign(static_cast<std::size_t>(children), {});
      forked_ev.assign(static_cast<std::size_t>(children), {});
    }
    const auto run_children = [&](const auto& prepare) {
      pool.parallel_for(children, [&](int c) {
        const std::size_t i = static_cast<std::size_t>(c);
        forked_reach[i] = reach;
        prepare(c, forked_reach[i]);
        traverse(node.first_child + static_cast<NodeId>(c), forked_reach[i], forked_ev[i],
                 child_split, child_fork_depth);
      });
    };

    if (node.kind == NodeKind::Chance) {
      const float w = static_cast<float>(game.chance_weight(id));
      const auto mask_for_card = [&](int card, std::vector<std::vector<float>>& target) {
        for (int s = 0; s < seats; ++s) {
          for (std::uint16_t h : game.hands_blocking_card(s, card)) target[s][h] = 0.0f;
        }
      };
      const auto fold_in = [&](int card, std::vector<float>& cev) {
        for (std::uint16_t h : game.hands_blocking_card(seat, card)) cev[h] = 0.0f;
        for (std::uint32_t h = 0; h < my_hands; ++h) ev[h] += w * cev[h];
      };

      if (fork) {
        run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
          mask_for_card(tree[node.first_child + static_cast<NodeId>(c)].dealt_card, child_reach);
        });
        for (int c = 0; c < children; ++c) {
          fold_in(tree[node.first_child + static_cast<NodeId>(c)].dealt_card,
                  forked_ev[static_cast<std::size_t>(c)]);
        }
      } else {
        std::vector<float> cev;
        std::vector<std::vector<float>> saved(static_cast<std::size_t>(seats));
        for (int c = 0; c < children; ++c) {
          const NodeId child = node.first_child + static_cast<NodeId>(c);
          const int card = tree[child].dealt_card;
          for (int s = 0; s < seats; ++s) saved[static_cast<std::size_t>(s)] = reach[static_cast<std::size_t>(s)];
          mask_for_card(card, reach);
          traverse(child, reach, cev, child_split, child_fork_depth);
          fold_in(card, cev);
          for (int s = 0; s < seats; ++s) reach[static_cast<std::size_t>(s)] = saved[static_cast<std::size_t>(s)];
        }
      }
      record(id, reach, ev);
      return;
    }

    const int actor = node.actor;
    const std::uint32_t actor_hands = static_cast<std::uint32_t>(game.num_hands(actor));
    const std::uint16_t actions = node.num_children;
    std::vector<float> sigma;
    src.average_strategy(id, sigma);

    if (actor == seat) {
      // The hero's own strategy weights the values; the reach vectors are
      // untouched on the way down (counterfactual = excluding own reach).
      const auto fold_in = [&](std::uint16_t k, const std::vector<float>& cev) {
        for (std::uint32_t h = 0; h < my_hands; ++h) {
          ev[h] += sigma[static_cast<std::size_t>(h) * actions + k] * cev[h];
        }
      };
      if (fork) {
        run_children([](int, std::vector<std::vector<float>>&) {});
        for (std::uint16_t k = 0; k < actions; ++k) fold_in(k, forked_ev[k]);
      } else {
        std::vector<float> cev;
        for (std::uint16_t k = 0; k < actions; ++k) {
          traverse(node.first_child + k, reach, cev, child_split, child_fork_depth);
          fold_in(k, cev);
        }
      }
      record(id, reach, ev);
      return;
    }

    // Opponent node: their strategy enters through the reach vector, so the
    // child values add in unweighted.
    const auto weight_reach = [&](std::uint16_t k, std::vector<std::vector<float>>& target) {
      std::vector<float>& r = target[static_cast<std::size_t>(actor)];
      for (std::uint32_t h = 0; h < actor_hands; ++h) {
        r[h] *= sigma[static_cast<std::size_t>(h) * actions + k];
      }
    };
    if (fork) {
      run_children([&](int c, std::vector<std::vector<float>>& child_reach) {
        weight_reach(static_cast<std::uint16_t>(c), child_reach);
      });
      for (std::uint16_t k = 0; k < actions; ++k) {
        const std::vector<float>& cev = forked_ev[k];
        for (std::uint32_t h = 0; h < my_hands; ++h) ev[h] += cev[h];
      }
    } else {
      std::vector<float> cev;
      const std::vector<float> saved = reach[static_cast<std::size_t>(actor)];
      for (std::uint16_t k = 0; k < actions; ++k) {
        weight_reach(k, reach);
        traverse(node.first_child + k, reach, cev, child_split, child_fork_depth);
        for (std::uint32_t h = 0; h < my_hands; ++h) ev[h] += cev[h];
        reach[static_cast<std::size_t>(actor)] = saved;
      }
    }
    record(id, reach, ev);
  }

  // At a boundary node, keep the subtree's counterfactual value and the
  // opponent reach mass it was measured against. The division into a
  // conditional value happens once, in the caller.
  void record(NodeId id, const std::vector<std::vector<float>>& reach,
              const std::vector<float>& ev) {
    if (out_ev == nullptr) return;
    const std::uint32_t b = boundary_index[id];
    if (b == kNoIndex) return;
    (*out_ev)[b] = ev;
    game.compat_weights(seat, reach, (*out_compat)[b]);
  }
};

}  // namespace

TruncationMap map_truncated_tree(const PublicTree& trunc, const PublicTree& full) {
  TruncationMap map;
  map.to_full.assign(trunc.size(), kNoNode);
  map.to_trunc.assign(full.size(), kNoNode);
  descend(trunc, full, trunc.root(), full.root(), map);
  if (map.boundary_full.empty()) {
    throw std::runtime_error("the truncated tree has no depth-limit terminals");
  }
  return map;
}

std::array<std::vector<float>, 2> blueprint_leaf_values(const Game& full_game,
                                                        const StrategySource& blueprint,
                                                        const TruncationMap& map,
                                                        std::uint32_t trunc_terminals,
                                                        const PublicTree& trunc) {
  const std::size_t hands = static_cast<std::size_t>(full_game.num_hands(0));
  const std::size_t boundaries = map.boundary_full.size();

  std::vector<std::uint32_t> boundary_index(full_game.tree().size(), kNoIndex);
  for (std::size_t b = 0; b < boundaries; ++b) {
    boundary_index[map.boundary_full[b]] = static_cast<std::uint32_t>(b);
  }

  std::array<std::vector<float>, 2> table;
  for (int s = 0; s < 2; ++s) {
    table[static_cast<std::size_t>(s)].assign(
        static_cast<std::size_t>(trunc_terminals) * hands, 0.0f);
  }

  for (int seat = 0; seat < 2; ++seat) {
    std::vector<std::vector<float>> ev(boundaries), compat(boundaries);
    ProfileTraverser tr{full_game, blueprint, blueprint.pool(), seat, boundary_index, &ev, &compat};
    std::vector<std::vector<float>> reach(static_cast<std::size_t>(full_game.num_seats()));
    for (int s = 0; s < full_game.num_seats(); ++s) {
      reach[static_cast<std::size_t>(s)] = full_game.initial_range(s);
    }
    std::vector<float> root_ev;
    tr.traverse(full_game.tree().root(), reach, root_ev, blueprint.split_budget(), 0);

    std::vector<float>& out = table[static_cast<std::size_t>(seat)];
    for (std::size_t b = 0; b < boundaries; ++b) {
      const Node& leaf = trunc[map.boundary_trunc[b]];
      float* row = out.data() + static_cast<std::size_t>(leaf.terminal_index) * hands;
      const std::vector<float>& e = ev[b];
      const std::vector<float>& w = compat[b];
      if (e.size() != hands || w.size() != hands) {
        throw std::runtime_error("boundary node was never visited by the blueprint traversal");
      }
      for (std::size_t h = 0; h < hands; ++h) {
        // No compatible opponent hand means the counterfactual value is
        // exactly 0 and the ratio is meaningless rather than large - the same
        // guard the QRE best response uses.
        row[h] = w[h] > 0.0f ? e[h] / w[h] : 0.0f;
      }
    }
  }
  return table;
}

std::vector<std::vector<float>> blueprint_leaf_matrices(const Game& full_game,
                                                        const StrategySource& blueprint,
                                                        const TruncationMap& map,
                                                        std::uint32_t trunc_terminals,
                                                        const PublicTree& trunc) {
  const std::size_t hands = static_cast<std::size_t>(full_game.num_hands(0));
  const int seats = full_game.num_seats();
  const PublicTree& full = full_game.tree();
  // Nothing to record on the way down: these traversals START at the boundary.
  const std::vector<std::uint32_t> no_boundary(full.size(), kNoIndex);

  std::vector<std::vector<float>> out(trunc_terminals);

  for (std::size_t b = 0; b < map.boundary_full.size(); ++b) {
    const NodeId leaf = map.boundary_full[b];
    const std::uint32_t ti = trunc[map.boundary_trunc[b]].terminal_index;
    std::vector<float>& matrix = out[ti];
    matrix.assign(hands * hands, 0.0f);

    // Cards already public at the leaf. A hand containing one of them holds
    // no reach there, and starting a traversal here rather than at the root
    // means applying that masking ourselves.
    const std::uint64_t board = full[leaf].board_mask;
    std::vector<char> blocked(hands, 0);
    for (std::size_t h = 0; h < hands; ++h) {
      for (int card = 0; card < 64; ++card) {
        if ((board & (1ULL << card)) == 0) continue;
        if (full_game.hand_blocks_card(0, static_cast<int>(h), card)) {
          blocked[h] = 1;
          break;
        }
      }
    }

    // One column per opponent hand. The inner traversal runs with split 1:
    // the parallelism is here, over columns, and nesting both would just
    // oversubscribe the pool.
    blueprint.pool().parallel_for(static_cast<int>(hands), [&](int o) {
      const std::size_t oi = static_cast<std::size_t>(o);
      if (blocked[oi]) return;

      std::vector<std::vector<float>> reach(static_cast<std::size_t>(seats));
      for (int s = 0; s < seats; ++s) {
        reach[static_cast<std::size_t>(s)].assign(hands, 0.0f);
      }
      // Seat 0's reach is never read for seat 0's own counterfactual value,
      // but the traversal masks it at chance nodes, so it has to be a real
      // vector rather than empty.
      for (std::size_t h = 0; h < hands; ++h) reach[0][h] = blocked[h] ? 0.0f : 1.0f;
      reach[1][oi] = 1.0f;

      std::vector<float> ev;
      ProfileTraverser tr{full_game, blueprint, blueprint.pool(), 0, no_boundary};
      tr.traverse(leaf, reach, ev, 1, kMaxSplitLevels);

      float* col = matrix.data() + oi * hands;
      for (std::size_t h = 0; h < hands; ++h) col[h] = blocked[h] ? 0.0f : ev[h];
    });
  }
  return out;
}

void HybridStrategySource::average_strategy(NodeId node, std::vector<float>& out) const {
  const NodeId t = map_.to_trunc[node];
  // A boundary node maps to a truncated TERMINAL, which owns no strategy, so
  // only decision nodes strictly above the limit come from the limited solve.
  // Everything at or below the boundary falls through to the blueprint.
  if (t != kNoNode && trunc_[t].kind == NodeKind::Decision) {
    limited_.average_strategy(t, out);
    return;
  }
  blueprint_.average_strategy(node, out);
}

}  // namespace engine
