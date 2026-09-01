#pragma once
#include <vector>

#include "config/schema.hpp"
#include "game/types.hpp"

namespace engine {

// Seat -> agent mapping. The number of players and the seat-to-agent
// partition are never hardcoded anywhere in the solver: this struct is the
// single source of truth. In this pass only the identity partition (every
// seat its own agent, identity payoff weights, no collusion) is accepted;
// the config schema already carries partition / payoff_weights / collusion
// so team solves plug in here without re-plumbing.
struct AgentMap {
  std::vector<AgentId> seat_to_agent;  // size = num seats
  // Hand-sharing partner, or -1. Exactly one 2-seat team is supported: the
  // pair shares hole cards and maximizes SUMMED chips. Coordination without
  // card visibility (TMECor) stays permanently out of scope - this is the
  // with-visibility variant.
  std::vector<int> teammate_of;
  int num_agents = 0;

  bool has_team() const {
    for (int m : teammate_of) {
      if (m >= 0) return true;
    }
    return false;
  }

  static AgentMap identity(int num_seats);

  // Validate the config's agents block against what this pass supports:
  // singleton groups, plus at most ONE group of exactly two seats (the
  // team), which requires the sampled family and a preflop game. Throws
  // with an actionable message otherwise.
  static AgentMap from_config(const SolveConfig& config, int num_seats);
};

}  // namespace engine
