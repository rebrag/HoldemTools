#pragma once
#include <string>
#include <vector>

#include "game/types.hpp"

namespace engine {

// One node of the public tree. Nodes are public states: board, betting
// sequence, pot, stacks. Private hands never appear here - an infoset is a
// (public state, private hand) pair, and the solver carries per-hand vectors
// alongside this topology. Nodes live in one contiguous vector; children of
// a node are contiguous (first_child .. first_child + num_children).
struct Node {
  NodeKind kind = NodeKind::Decision;
  Street street = Street::River;
  ActionKind action_kind = ActionKind::Root;  // edge from parent
  TerminalKind terminal_kind = TerminalKind::None;
  std::uint16_t actor = kNoSeat;      // decision nodes: seat to act
  std::int16_t dealt_card = -1;       // edge from parent was Deal of this card
  Chips action_amount = 0;            // Bet/CheckCall: actor's cumulative street commitment after the action
  NodeId parent = kNoNode;
  NodeId first_child = kNoNode;
  std::uint16_t num_children = 0;
  std::uint32_t decision_index = kNoIndex;  // dense index over decision nodes
  std::uint32_t terminal_index = kNoIndex;  // dense index over terminal nodes
  Chips pot = 0;                      // total chips in the middle (incl. dead money)
  std::array<Chips, kMaxSeats> commit{};  // per-seat chips committed after the root (side-pot input)
  std::uint16_t folded_mask = 0;      // bit s set = seat s has folded
  std::uint16_t fold_winner = kNoSeat;  // Fold terminals: seat that takes the pot (2p); multiway uses folded_mask
};

struct PublicTree {
  std::vector<Node> nodes;
  std::uint32_t num_decision_nodes = 0;
  std::uint32_t num_terminal_nodes = 0;

  const Node& operator[](NodeId id) const { return nodes[id]; }
  Node& operator[](NodeId id) { return nodes[id]; }
  NodeId root() const { return 0; }
  std::size_t size() const { return nodes.size(); }

  // Assign decision_index / terminal_index densely. Call once after building.
  void finalize();
};

}  // namespace engine
