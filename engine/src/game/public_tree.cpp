#include "game/public_tree.hpp"

namespace engine {

void PublicTree::finalize() {
  num_decision_nodes = 0;
  num_terminal_nodes = 0;
  for (Node& n : nodes) {
    if (n.kind == NodeKind::Decision) {
      n.decision_index = num_decision_nodes++;
    } else if (n.kind == NodeKind::Terminal) {
      n.terminal_index = num_terminal_nodes++;
    }
  }
}

}  // namespace engine
