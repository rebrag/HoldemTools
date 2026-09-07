#pragma once
#include <array>
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
  // PioViewer's "Don't 3-bet": this seat never makes the THIRD aggressive
  // action of a street. It can still open, and it can still raise the
  // opponent's opening bet - it just cannot re-raise a raise. Per seat, so
  // it composes with the street-wide max_raises cap rather than replacing it.
  bool no_3bet = false;
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
  Chips effective_stack = 0;  // shorthand: fills every zero entry of `stack`
  // Seats, in action order: seat 0 acts first on every street. 2 is the
  // Pio-gated heads-up path; 3+ builds the multiway tree (M8b).
  int num_seats = 2;
  // Chips behind at the root, per seat. Any entry left at 0 is filled from
  // `effective_stack`, which is what every heads-up caller relies on.
  // Unequal stacks produce side pots, which the tree records as differing
  // per-seat `commit` and `showdown_share` resolves by layer.
  std::array<Chips, kMaxSeats> stack{};
  Street start_street = Street::River;  // from the board's card count
  std::uint64_t board_mask = 0;         // root board cards
  // Who was the aggressor on the street before the root (preflop for flop
  // solves). Gates whether OOP's first-in sizes come from donks or bets.
  // Default None: OOP uses `bets` everywhere unless a config opts in.
  Aggressor preflop_aggressor = Aggressor::None;
  // Last street to SOLVE. None = solve to showdown, the original behaviour.
  // Set to Flop on a flop tree and every betting line that ends the flop
  // without a fold becomes a DepthLimit terminal instead of a chance node,
  // so the turn and river are never built. That is where the node count
  // lives: a flop tree's river layer is ~2000x its flop layer.
  //
  // The FIRST crossing out of any street funnels through street_end(), the
  // all-in chain included (a flop all-in call is a street end whose chance
  // children happen to have no decisions), so one branch there truncates
  // every line that leaves the limited street. Runouts already inside an
  // all-in chain keep running to showdown, which is deliberate: they carry no
  // strategy, so truncating them would ask for a leaf value where the exact
  // one is already free.
  Street depth_limit = Street::None;
  StreetSizing flop;
  StreetSizing turn;
  StreetSizing river;
};

// Build the postflop public tree from start_street to showdown:
// betting rounds joined by chance nodes (one child per card not yet on the
// board; hole-card blocking is handled by reach masking at traversal, like
// Leduc). A street with fewer than two seats still able to act runs out the
// remaining streets as pure chance chains.
//
// Seat 0 = OOP acts first on every street, and at 3+ seats action proceeds in
// seat order, wrapping, until every alive seat has acted since the last
// aggression and matched the current bet. At 3+ seats a FOLD is not terminal
// until one seat remains, which is the structural difference from the
// heads-up tree and the reason the round bookkeeping lives in a side table
// rather than in Node.
//
// Bet sizing is per seat only at 2 seats (`oop` / `ip`); at 3+ seat 0 reads
// `oop` and every other seat reads `ip`, because the config schema carries no
// per-seat sizing list yet. That is a config-surface limitation, not a tree
// one.
//
// The 2-seat tree is BIT-IDENTICAL to what the heads-up-only builder
// produced - same nodes in the same order - because it is the Pio-gated
// artifact contract. tests/test_tree.cpp pins it.
// action_amount on Bet/CheckCall nodes is the actor's cumulative POSTFLOP
// commitment after the action - the hand-cumulative bNNN convention Pio's
// node ids and the frontend use.
PublicTree build_postflop_tree(const PostflopTreeParams& params);

}  // namespace engine
