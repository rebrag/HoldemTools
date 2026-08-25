#include "solver/agents.hpp"

#include <stdexcept>

namespace engine {

AgentMap AgentMap::identity(int num_seats) {
  AgentMap map;
  map.num_agents = num_seats;
  map.seat_to_agent.resize(num_seats);
  for (int s = 0; s < num_seats; ++s) map.seat_to_agent[s] = static_cast<AgentId>(s);
  return map;
}

AgentMap AgentMap::from_config(const SolveConfig& config, int num_seats) {
  if (!config.partition.empty()) {
    if (static_cast<int>(config.partition.size()) != num_seats) {
      throw std::runtime_error(
          "agents.partition must be the identity partition in this pass "
          "(team solves land in a later pass): expected " +
          std::to_string(num_seats) + " singleton groups");
    }
    std::vector<bool> seen(num_seats, false);
    for (const auto& group : config.partition) {
      if (group.size() != 1) {
        throw std::runtime_error(
            "agents.partition groups with more than one seat (teams) land in a later pass");
      }
      const int seat = group[0];
      if (seat < 0 || seat >= num_seats || seen[seat]) {
        throw std::runtime_error("agents.partition must cover each seat exactly once");
      }
      seen[seat] = true;
    }
  }
  return identity(num_seats);
}

}  // namespace engine
