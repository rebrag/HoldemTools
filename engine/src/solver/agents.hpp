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
  int num_agents = 0;

  static AgentMap identity(int num_seats);

  // Validate the config's agents block against what this pass supports and
  // return the (identity) map. Throws with an actionable message otherwise.
  static AgentMap from_config(const SolveConfig& config, int num_seats);
};

}  // namespace engine
