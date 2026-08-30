#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "game/public_tree.hpp"
#include "game/types.hpp"

namespace engine {

// Parameters for the N-seat PREFLOP public tree.
//
// Deliberately a separate builder from build_postflop_tree(): that one is
// 2-player in every line of its recursion (`1 - actor`, `commit[0]+commit[1]`,
// "the street ends when seat 1 checks back"), it produces the Pio-gated tree
// and the committed tiny_river fixture, and generalizing it in place would
// rewrite all of that. The two share the Node/PublicTree vocabulary and
// nothing else.
//
// Seats are indexed clockwise: seat i acts after seat i-1. The blinds are
// derived from `button`: SB = (button+1)%n, BB = (button+2)%n, and heads-up
// follows the usual exception where the button IS the small blind. First to
// act preflop is (BB+1)%n, which heads-up is the button/SB.
struct PreflopTreeParams {
  int num_seats = 2;
  std::array<Chips, kMaxSeats> stack{};  // chips behind BEFORE posting
  std::array<Chips, kMaxSeats> ante{};   // posted by each seat at the root
  Chips small_blind = 0;
  Chips big_blind = 0;
  int button = 0;
  Chips dead = 0;  // straddle / dead money already in the middle

  // v1 builds exactly {Fold, AllIn}. These fields exist so real preflop
  // sizings drop into the same recursion later without reshaping it; the
  // builder refuses a non-empty sizing list while `jam_only` is true.
  std::vector<double> open_bb;    // open sizes, big blinds (unused in v1)
  std::vector<double> raise_pct;  // raise sizes, % of pot after call (unused)
  int max_raises = 0;
  bool jam_only = true;
};

// Build the preflop public tree. Every node carries per-seat `commit` and
// `folded_mask`, so the side-pot layers at a showdown terminal are public
// information derivable from the node alone.
//
// A FOLD IS NOT TERMINAL here - that is the structural difference from the
// heads-up builder. A fold child becomes TerminalKind::Fold only once one
// seat remains; otherwise action continues to the next live seat.
PublicTree build_preflop_tree(const PreflopTreeParams& params);

}  // namespace engine
