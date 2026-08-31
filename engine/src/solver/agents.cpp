#include "solver/agents.hpp"

#include <stdexcept>

namespace engine {

AgentMap AgentMap::identity(int num_seats) {
  AgentMap map;
  map.num_agents = num_seats;
  map.seat_to_agent.resize(num_seats);
  map.teammate_of.assign(static_cast<std::size_t>(num_seats), -1);
  for (int s = 0; s < num_seats; ++s) map.seat_to_agent[s] = static_cast<AgentId>(s);
  return map;
}

AgentMap AgentMap::from_config(const SolveConfig& config, int num_seats) {
  AgentMap map = identity(num_seats);
  if (config.partition.empty()) return map;

  std::vector<bool> seen(static_cast<std::size_t>(num_seats), false);
  int teams = 0;
  for (const auto& group : config.partition) {
    if (group.empty() || group.size() > 2) {
      throw std::runtime_error(
          "agents.partition groups must have one seat, or exactly two for the single "
          "hand-sharing team this pass supports");
    }
    for (int seat : group) {
      if (seat < 0 || seat >= num_seats ||
          seen[static_cast<std::size_t>(seat)]) {
        throw std::runtime_error("agents.partition must cover each seat exactly once");
      }
      seen[static_cast<std::size_t>(seat)] = true;
    }
    if (group.size() == 2) {
      ++teams;
      map.teammate_of[static_cast<std::size_t>(group[0])] = group[1];
      map.teammate_of[static_cast<std::size_t>(group[1])] = group[0];
      // Both seats become one agent; agent ids stay dense enough for the
      // observability they serve (num_agents below).
      map.seat_to_agent[static_cast<std::size_t>(group[1])] =
          map.seat_to_agent[static_cast<std::size_t>(group[0])];
    }
  }
  for (int s = 0; s < num_seats; ++s) {
    if (!seen[static_cast<std::size_t>(s)]) {
      throw std::runtime_error("agents.partition must cover each seat exactly once");
    }
  }
  if (teams > 1) {
    throw std::runtime_error("only ONE hand-sharing team is supported in this pass");
  }
  if (teams == 1) {
    if (num_seats <= 2) {
      // The whole table on one team: total EV is the constant pot, so the
      // objective is vacuous - refuse rather than solve nothing.
      throw std::runtime_error(
          "a hand-sharing team needs at least one opponent: with every seat on the team "
          "the summed EV is the constant pot");
    }
    if (!config.sampled.enabled) {
      throw std::runtime_error(
          "hand-sharing teams run on the sampled core: set algorithm.family \"sampled\"");
    }
    if (config.game != "nlhe_preflop") {
      throw std::runtime_error("hand-sharing teams support game \"nlhe_preflop\" only");
    }
    if (config.awareness != "aware" && config.awareness != "unaware") {
      throw std::runtime_error(
          "a team solve must state agents.awareness: \"aware\" (opponents adapt to the "
          "team) or \"unaware\" (opponents play the frozen no-team baseline)");
    }
  } else if (!config.awareness.empty()) {
    throw std::runtime_error("agents.awareness is set but agents.partition has no team");
  }
  map.num_agents = num_seats - teams;
  return map;
}

}  // namespace engine
