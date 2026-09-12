#include "solver/infoset_indexer.hpp"

#include <algorithm>
#include <stdexcept>

namespace engine {

namespace {

std::uint64_t fnv1a(std::uint64_t h, const void* data, std::size_t bytes) {
  const auto* p = static_cast<const unsigned char*>(data);
  for (std::size_t i = 0; i < bytes; ++i) {
    h ^= p[i];
    h *= 1099511628211ULL;
  }
  return h;
}

template <typename T>
std::uint64_t fnv1a_vec(std::uint64_t h, const std::vector<T>& v) {
  return fnv1a(h, v.data(), v.size() * sizeof(T));
}

}  // namespace

InfosetIndexer InfosetIndexer::plan(const Game& game, const DealGame& deals,
                                    const SampledConfig& config,
                                    const std::vector<int>& teammate_of, int joint_classes) {
  InfosetIndexer ix;
  int max_hands = 0;
  for (int seat = 0; seat < game.num_seats(); ++seat) {
    max_hands = std::max(max_hands, game.num_hands(seat));
  }
  ix.num_hands = static_cast<std::uint32_t>(max_hands);

  // The suit-symmetry quotient: storage rows are per CLASS when the game
  // reports one and the config keeps it on (the default). Identity
  // otherwise, so that path is bit-for-bit the unquotiented solver.
  std::vector<std::uint16_t> class_of;
  int num_classes = 0;
  deals.hand_classes(class_of, num_classes);
  if (config.symmetry && num_classes > 0) {
    ix.mode = Mode::GlobalClass;
    ix.num_classes = num_classes;
    ix.map_storage = std::move(class_of);
    ix.map_storage.resize(ix.num_hands, 0);
  } else {
    if (config.symmetry && config.symmetry_explicit && num_classes == 0) {
      throw std::runtime_error(
          "algorithm.sampled.symmetry was requested but this game reports no "
          "suit-symmetry quotient");
    }
    ix.mode = Mode::Identity;
    ix.map_storage.resize(ix.num_hands);
    for (std::uint32_t h = 0; h < ix.num_hands; ++h) {
      ix.map_storage[h] = static_cast<std::uint16_t>(h);
    }
  }

  // One group per decision node, in decision-index order - the layout the
  // solver always had. Decision indices are dense in node order.
  const PublicTree& tree = game.tree();
  const std::uint32_t decisions = tree.num_decision_nodes;
  ix.group_of.resize(decisions);
  ix.rows_of.resize(decisions);
  ix.map_of.assign(decisions, 0);
  ix.perm_of.assign(decisions, kIdentityPerm);
  ix.group_offset.resize(decisions);
  ix.store_total = 0;
  for (const Node& node : tree.nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const std::uint32_t d = node.decision_index;
    const bool team_actor =
        !teammate_of.empty() && teammate_of[static_cast<std::size_t>(node.actor)] >= 0;
    const std::uint32_t rows =
        team_actor ? static_cast<std::uint32_t>(joint_classes)
                   : (ix.mode == Mode::GlobalClass ? static_cast<std::uint32_t>(ix.num_classes)
                                                   : static_cast<std::uint32_t>(
                                                         game.num_hands(node.actor)));
    ix.group_of[d] = d;
    ix.rows_of[d] = rows;
    ix.group_offset[d] = ix.store_total;
    ix.store_total += static_cast<std::size_t>(node.num_children) * rows;
  }
  ix.num_groups = decisions;
  return ix;
}

std::uint64_t InfosetIndexer::fingerprint() const {
  std::uint64_t h = 14695981039346656037ULL;
  const std::uint8_t m = static_cast<std::uint8_t>(mode);
  h = fnv1a(h, &m, sizeof(m));
  h = fnv1a(h, &num_hands, sizeof(num_hands));
  h = fnv1a_vec(h, group_of);
  h = fnv1a_vec(h, rows_of);
  h = fnv1a_vec(h, map_of);
  h = fnv1a_vec(h, perm_of);
  h = fnv1a_vec(h, map_storage);
  return h;
}

}  // namespace engine
