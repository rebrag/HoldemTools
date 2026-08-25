#pragma once
#include <array>
#include <cstdint>
#include <limits>

namespace engine {

using Chips = std::int64_t;
using SeatId = std::uint16_t;
using AgentId = std::uint16_t;
using NodeId = std::uint32_t;

inline constexpr int kMaxSeats = 9;
inline constexpr NodeId kNoNode = std::numeric_limits<NodeId>::max();
inline constexpr std::uint16_t kNoSeat = std::numeric_limits<std::uint16_t>::max();
inline constexpr std::uint32_t kNoIndex = std::numeric_limits<std::uint32_t>::max();

enum class Street : std::uint8_t { Preflop = 0, Flop = 1, Turn = 2, River = 3, None = 255 };

enum class NodeKind : std::uint8_t { Decision, Chance, Terminal };

// The action on the edge from parent to this node.
enum class ActionKind : std::uint8_t { Root, Fold, CheckCall, Bet, Deal };

enum class TerminalKind : std::uint8_t { None, Fold, Showdown };

}  // namespace engine
