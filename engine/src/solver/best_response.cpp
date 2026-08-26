#include <cstdint>

#include "solver/best_response.hpp"

namespace engine {

namespace {

// Recursion helper: returns, for `seat`'s hands, both the best-response
// counterfactual value (seat deviates, everyone else plays the average
// strategy) and the on-profile counterfactual value (seat also plays the
// average strategy). Runs once per solve, so clarity over allocation reuse.
struct BrTraverser {
  const Game& game;
  const CfrSolver& solver;
  int seat;

  void traverse(NodeId id, std::vector<std::vector<float>>& reach,
                std::vector<float>& br, std::vector<float>& ev) {
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

    if (node.kind == NodeKind::Chance) {
      const float w = static_cast<float>(game.chance_weight(id));
      const int seats = game.num_seats();
      std::vector<float> cbr, cev;
      std::vector<std::vector<float>> saved(seats);
      for (std::uint16_t c = 0; c < node.num_children; ++c) {
        const NodeId child = node.first_child + c;
        const int card = tree[child].dealt_card;
        for (int s = 0; s < seats; ++s) {
          saved[s] = reach[s];
          const int hands = game.num_hands(s);
          for (int h = 0; h < hands; ++h) {
            if (game.hand_blocks_card(s, h, card)) reach[s][h] = 0.0f;
          }
        }
        traverse(child, reach, cbr, cev);
        for (std::uint32_t h = 0; h < my_hands; ++h) {
          if (!game.hand_blocks_card(seat, h, card)) {
            br[h] += w * cbr[h];
            ev[h] += w * cev[h];
          }
        }
        for (int s = 0; s < seats; ++s) reach[s] = saved[s];
      }
      return;
    }

    const int actor = node.actor;
    const std::uint32_t hands = static_cast<std::uint32_t>(game.num_hands(actor));
    const std::uint16_t actions = node.num_children;
    std::vector<float> sigma;
    solver.average_strategy(id, sigma);
    std::vector<float> cbr, cev;

    if (actor == seat) {
      bool first = true;
      for (std::uint16_t k = 0; k < actions; ++k) {
        traverse(node.first_child + k, reach, cbr, cev);
        for (std::uint32_t h = 0; h < hands; ++h) {
          ev[h] += sigma[static_cast<std::size_t>(h) * actions + k] * cev[h];
          if (first || cbr[h] > br[h]) br[h] = cbr[h];
        }
        first = false;
      }
    } else {
      std::vector<float> saved = reach[actor];
      for (std::uint16_t k = 0; k < actions; ++k) {
        for (std::uint32_t h = 0; h < hands; ++h) {
          reach[actor][h] = saved[h] * sigma[static_cast<std::size_t>(h) * actions + k];
        }
        traverse(node.first_child + k, reach, cbr, cev);
        for (std::uint32_t h = 0; h < my_hands; ++h) {
          br[h] += cbr[h];
          ev[h] += cev[h];
        }
      }
      reach[actor] = saved;
    }
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
    BrTraverser{game, solver, p}.traverse(game.tree().root(), reach, br, ev);
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
