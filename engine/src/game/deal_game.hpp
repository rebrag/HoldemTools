#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "game/types.hpp"

namespace engine {

// One concrete deal: every seat's private hand plus the public runout, drawn
// WITHOUT REPLACEMENT from one deck. This is the object that makes bunching
// free: two seats cannot hold the same card because the card was physically
// handed to one of them, and every terminal's payoffs on a concrete deal sum
// to the pot exactly - so chip conservation is a property of each sample
// rather than a correction to fight for.
struct Deal {
  std::array<std::uint16_t, kMaxSeats> hand{};     // compact hand index per seat
  std::array<std::uint8_t, 2 * kMaxSeats> hole{};  // raw private cards, seat-major
  std::array<std::uint8_t, 5> board{};             // public cards, in chance-deal order
  int hole_per_seat = 0;
  int board_count = 0;
};

// The deal-facing counterpart of Game, implemented alongside it by games the
// sampled solver core can run (the vectorized Game::terminal_values contract
// is meaningless for a concrete deal, and vice versa). The solver holds both
// interfaces to the same object.
//
// During seat p's traversal, p's own dealt cards are IGNORED - p stays
// vectorized over every hand compatible with the other seats' cards and the
// board. That the others' cards were drawn avoiding p's dealt two is not a
// bias: every opponent profile uses the same number of cards, so the count
// of hero holdings each profile excludes is constant, and marginalizing over
// p's dealt cards leaves the opponent-profile distribution exactly uniform.
// Exchangeability is what makes sharing one deal across all of an
// iteration's traversals sound, and sharing it is required anyway - the
// sample.hpp doctrine that every seat must see the SAME sampled game.
class DealGame {
 public:
  virtual ~DealGame() = default;

  // The deal for iteration `iter`: a pure function of (seed, iter), never of
  // a thread or a call site, so any assignment of iterations to lanes and
  // lanes to threads replays identically.
  virtual void sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const = 0;

  // Per-iteration scratch: hand strengths for the WHOLE compact universe on
  // this deal's board, shared by all of the iteration's seat traversals.
  // Games whose showdowns need no board table leave it empty.
  virtual void deal_strengths(const Deal&, std::vector<std::uint32_t>& out) const {
    out.clear();
  }

  // Suit-symmetry quotient: hand -> class for games whose infosets are
  // invariant under suit permutations (a preflop-only tree qualifies; any
  // tree with a board in an infoset does not). Empty = no symmetry. This is
  // a LOSSLESS relabeling, not abstraction: members of a class face
  // identical deal distributions, so constraining them to one strategy
  // loses nothing and pools their samples - which is the variance
  // reduction. The sampled solver stores one row per class when this is
  // non-empty and expands to per-hand rows at the StrategySource boundary.
  virtual void hand_classes(std::vector<std::uint16_t>& class_of, int& num_classes) const {
    class_of.clear();
    num_classes = 0;
  }

  // Per-hero-hand chips at a SHOWDOWN terminal on this concrete deal:
  // out[h] = share(h against the other seats' dealt hands) - commit[seat],
  // side pots and ties exact. Entries for hands colliding with the deal are
  // unspecified - the caller's reach there is zero. Fold terminals never
  // come here; the solver resolves them from the node's public fields alone.
  virtual void deal_showdown_values(NodeId node, int seat, const Deal& deal,
                                    const std::vector<std::uint32_t>& strengths,
                                    std::vector<float>& out) const = 0;
};

}  // namespace engine
