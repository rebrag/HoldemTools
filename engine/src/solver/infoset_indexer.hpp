#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

#include "game/deal_game.hpp"
#include "game/game.hpp"
#include "solver/updates.hpp"

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
//   Abstraction  (config algorithm.sampled.abstraction) per-board buckets:
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
// Plain data, no virtuals. `plan` sizes everything without clustering (the
// memory estimator and the solver constructor both call it, so they cannot
// drift); the abstraction maps are filled by `fit` in a later pass.
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
  std::vector<std::uint16_t> perm_of;   // suit perm composing a member's map; kIdentityPerm otherwise
  // Per group.
  std::vector<std::size_t> group_offset;
  std::vector<std::uint32_t> group_rep;  // the decision index the group was formed from
  std::size_t store_total = 0;
  std::uint32_t num_groups = 0;
  // Concatenated hand -> row maps, each num_hands long.
  std::vector<std::uint16_t> map_storage;

  // Size the store. `teammate_of` (per seat, -1 = none) and `joint_classes`
  // come from the caller because the joint quotient is the team's business,
  // not the indexer's. Throws when the config asks for a symmetry the game
  // does not report.
  static InfosetIndexer plan(const Game& game, const DealGame& deals, const SampledConfig& config,
                             const std::vector<int>& teammate_of, int joint_classes);

  std::uint32_t rows(std::uint32_t d) const { return rows_of[d]; }
  std::uint32_t group(std::uint32_t d) const { return group_of[d]; }
  std::size_t offset(std::uint32_t d) const { return group_offset[group_of[d]]; }
  const std::uint16_t* map(std::uint32_t d) const {
    return map_storage.data() + static_cast<std::size_t>(map_of[d]) * num_hands;
  }
  std::uint16_t perm(std::uint32_t d) const { return perm_of[d]; }
  bool identity() const { return mode == Mode::Identity; }

  // FNV-1a over every array above: the layout AND the assignment, so two
  // bucketings with the same counts but different members differ.
  std::uint64_t fingerprint() const;
};

}  // namespace engine
