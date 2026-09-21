#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "solver/updates.hpp"
#include "util/parallel.hpp"

namespace engine {

// The sampled core's storage quotient: which storage ROW hand h reads and
// writes at decision node d, and which storage GROUP node d's rows live in.
//
// This is the InfosetIndexer seam engine/CLAUDE.md names as where hand
// abstraction lands for the sampled core and nowhere else. Three modes:
//
//   Identity     every node maps hand -> hand; rows == num_hands.
//   GlobalClass  the game's lossless suit quotient (DealGame::hand_classes,
//                169 preflop); one shared map, rows == num_classes.
//   Abstraction  (config algorithm.sampled.abstraction) per-board BUCKETS:
//                strength buckets on the river, equity buckets on earlier
//                streets, with suit-isomorphic runouts sharing one group.
//
// Identity and GlobalClass are the two modes the solver had before this
// struct existed, and they must stay BIT-FOR-BIT that solver: one group per
// decision node in decision-index order, so store offsets and store_total
// are unchanged and existing checkpoint lineages still resume; and the row
// rule is literally `team ? joint : (classes > 0 ? classes : hands)`. A
// team actor's map is never consulted - those paths index the joint
// quotient directly.
//
// Abstraction mode groups decision nodes by (canonical runout, betting line):
// the board AND the order its cards came in, canonicalized under the game's
// root symmetries, and the sequence of action indices at DECISION nodes from
// the root. The order matters even though the bucket map does not depend on
// it: turn X then river Y and turn Y then river X hold the same five cards
// but the turn was played on different boards, so the ranges arriving at the
// river differ and the two are different public states.
// Two nodes with equal canonical board and equal line are the same public
// state up to a suit relabeling, so sharing their rows merges only what the
// game makes identical. The k-th decision node under one runout is NOT in
// general the k-th under another once a nested chance node is crossed
// (inner chance children are card-indexed), which is why the line is the
// key rather than the position. A member reads the canonical board's map
// composed with the symmetry's hand relabeling; maps are built once per
// canonical board and permuted, never re-clustered.
//
// Hands are CANONICALIZED per board before they are featurized, under the
// board's pointwise stabilizer: the root symmetries (suit relabelings that
// fix the root board set-wise and every seat's range) that also fix every
// runout card of this board. Two hands that are images of each other under
// such a relabeling are strategically identical at every node on the board
// - same history, same future - so giving them identical features (and
// hence one row, since every method keeps tie groups whole) is a lossless
// relabeling, not an approximation. It composes with the runout sharing
// above and makes the equal-feature case exact rather than up to a rounding
// that could straddle a quantile boundary. MonkerSolver canonicalizes more
// broadly (relative to the board alone, 78-643 keys per board), which
// merges hands whose FLOP histories differ; that is lossy and is not copied.
//
// Plain data, no virtuals. `plan` sizes everything without clustering (the
// memory estimator and the solver constructor both call it, so they cannot
// drift); `fit` fills the abstraction maps.
struct InfosetIndexer {
  enum class Mode : std::uint8_t { Identity, GlobalClass, Abstraction };

  static constexpr std::uint16_t kIdentityPerm = std::numeric_limits<std::uint16_t>::max();

  Mode mode = Mode::Identity;
  std::uint32_t num_hands = 0;  // map length: the widest seat universe
  int num_classes = 0;          // GlobalClass only

  // Per decision index.
  std::vector<std::uint32_t> group_of;  // storage group
  std::vector<std::uint32_t> rows_of;   // storage rows (== the group's rows)
  std::vector<std::uint32_t> map_of;    // index into map_storage, in units of num_hands
  std::vector<std::uint16_t> perm_of;   // symmetry composing a member's map; kIdentityPerm otherwise
  // Per group.
  std::vector<std::size_t> group_offset;
  std::vector<std::uint32_t> group_rep;  // the decision index the group was formed from
  std::size_t store_total = 0;
  std::uint32_t num_groups = 0;
  // Concatenated hand -> row maps, each num_hands long, and (Abstraction
  // only) a parallel validity byte per hand: 0 where the map's board blocks
  // the hand, whose row is then a harmless 0 - its reach is zero everywhere.
  std::vector<std::uint16_t> map_storage;
  std::vector<std::uint8_t> valid_storage;

  // Abstraction bookkeeping the fit pass consumes. One entry per canonical
  // board map to build; composed maps derive from these.
  struct BoardMap {
    std::uint64_t key = 0;
    Street street = Street::River;
    std::uint32_t buckets = 0;  // strength buckets
    std::uint32_t tiers = 1;    // second-feature tiers ("moments" on flop/turn); rows = buckets x tiers
    std::uint32_t map_index = 0;
  };
  struct ComposedMap {
    std::uint32_t canonical_map = 0;  // map index of the canonical board
    int symmetry = 0;                 // image key = symmetric_key(symmetry, canonical)
    std::uint32_t map_index = 0;
  };
  std::vector<BoardMap> board_maps;
  std::vector<ComposedMap> composed_maps;
  std::uint32_t num_maps = 0;
  bool fitted = false;

  // Size the store. `teammate_of` (per seat, -1 = none) and `joint_classes`
  // come from the caller because the joint quotient is the team's business,
  // not the indexer's. Throws when the config asks for a symmetry the game
  // does not report, or for abstraction on a game without boards.
  static InfosetIndexer plan(const Game& game, const DealGame& deals, const SampledConfig& config,
                             const std::vector<int>& teammate_of, int joint_classes);

  // Fill the abstraction maps: strengths and equities from the game,
  // clustered per canonical board (parallel over boards, serial and seeded
  // within one), then the composed maps. No-op outside Abstraction mode.
  void fit(const DealGame& deals, const SampledConfig& config, ThreadPool& pool);

  std::uint32_t rows(std::uint32_t d) const { return rows_of[d]; }
  std::uint32_t group(std::uint32_t d) const { return group_of[d]; }
  std::size_t offset(std::uint32_t d) const { return group_offset[group_of[d]]; }
  const std::uint16_t* map(std::uint32_t d) const {
    return map_storage.data() + static_cast<std::size_t>(map_of[d]) * num_hands;
  }
  // Null outside Abstraction mode (every hand is valid at every node).
  const std::uint8_t* valid(std::uint32_t d) const {
    if (valid_storage.empty()) return nullptr;
    return valid_storage.data() + static_cast<std::size_t>(map_of[d]) * num_hands;
  }
  std::uint16_t perm(std::uint32_t d) const { return perm_of[d]; }
  bool identity() const { return mode == Mode::Identity; }

  // FNV-1a over every array above: the layout AND the assignment, so two
  // bucketings with the same counts but different members differ. Only
  // meaningful after fit() in Abstraction mode.
  std::uint64_t fingerprint() const;
};

}  // namespace engine
