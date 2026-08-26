#pragma once
#include <cstdint>
#include <vector>

#include "game/public_tree.hpp"

namespace engine {

// Bet sizing for one seat on one street. Sizes are percent of pot; raises
// are percent of the pot after a hypothetical call (Pio's convention).
// donks (OOP only) are the first-in sizes used when the PREVIOUS street's
// aggressor was the opponent - betting into the aggressor. When the previous
// street went check-check (no aggressor), OOP first-in uses `bets`.
struct SeatSizing {
  std::vector<double> bets;
  std::vector<double> raises;
  std::vector<double> donks;  // OOP first-in vs. a prior-street aggressor
};

// One street's sizing for both seats. A computed size at or above
// allin_threshold * effective stack becomes all-in.
struct StreetSizing {
  SeatSizing oop;
  SeatSizing ip;
  double allin_threshold = 0.9;
  int max_raises = 3;
};

enum class Aggressor : std::uint8_t { None, Oop, Ip };

struct PostflopTreeParams {
  Chips pot = 0;              // dead money at the root
  Chips effective_stack = 0;  // chips behind, equal for both seats this pass
  Street start_street = Street::River;  // from the board's card count
  std::uint64_t board_mask = 0;         // root board cards
  // Who was the aggressor on the street before the root (preflop for flop
  // solves). Gates whether OOP's first-in sizes come from donks or bets.
  // Default None: OOP uses `bets` everywhere unless a config opts in.
  Aggressor preflop_aggressor = Aggressor::None;
  StreetSizing flop;
  StreetSizing turn;
  StreetSizing river;
};

// Build the 2-player postflop public tree from start_street to showdown:
// betting rounds joined by chance nodes (one child per card not yet on the
// board; hole-card blocking is handled by reach masking at traversal, like
// Leduc). An all-in call before the river runs out the remaining streets as
// pure chance chains. Seat 0 = OOP acts first on every street.
// action_amount on Bet/CheckCall nodes is the actor's cumulative POSTFLOP
// commitment after the action - the hand-cumulative bNNN convention Pio's
// node ids and the frontend use.
PublicTree build_postflop_tree(const PostflopTreeParams& params);

}  // namespace engine
