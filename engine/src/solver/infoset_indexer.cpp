#include "solver/infoset_indexer.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <numeric>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

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

// Counter-based generator for the k-means seeding: a pure function of its
// state, so a board's clustering is reproducible from (seed, key).
struct SplitMix64 {
  std::uint64_t state;
  std::uint64_t next() {
    std::uint64_t z = (state += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
  }
  // Uniform in [0, 1).
  double unit() { return static_cast<double>(next() >> 11) * (1.0 / 9007199254740992.0); }
};

std::uint32_t buckets_for(const AbstractionConfig& ab, Street street) {
  switch (street) {
    case Street::Flop: return static_cast<std::uint32_t>(ab.flop);
    case Street::Turn: return static_cast<std::uint32_t>(ab.turn);
    case Street::River: return static_cast<std::uint32_t>(ab.river);
    default: return 0;
  }
}

// Second-feature tiers on this street: "moments" on flop and turn only.
std::uint32_t tiers_for(const AbstractionConfig& ab, Street street) {
  if (ab.method != "moments" || street == Street::River) return 1;
  return static_cast<std::uint32_t>(std::max(1, ab.tiers));
}

// The board's pointwise stabilizer applied to every hand: rep[h] is the
// smallest hand index in h's orbit under the root symmetries that fix each
// runout card of `key` (the low 52 bits are the board set; runout cards are
// those not on the root board, which every root symmetry fixes set-wise).
// Identity when there is no such symmetry.
void canonical_hands(const DealGame& deals, std::uint64_t key, std::size_t hands,
                     std::vector<std::uint32_t>& rep) {
  rep.resize(hands);
  for (std::size_t h = 0; h < hands; ++h) rep[h] = static_cast<std::uint32_t>(h);
  const int syms = deals.abstraction_symmetries();
  if (syms <= 0) return;
  const std::uint64_t mask = key & ((std::uint64_t{1} << 52) - 1);
  for (int s = 0; s < syms; ++s) {
    // Fixes the board set-wise AND every card of it individually.
    if (deals.abstraction_symmetric_key(s, mask) != mask) continue;
    bool pointwise = true;
    for (int c = 0; c < 52 && pointwise; ++c) {
      if ((mask & (std::uint64_t{1} << c)) != 0 && deals.abstraction_symmetric_card(s, c) != c) {
        pointwise = false;
      }
    }
    if (!pointwise) continue;
    const std::vector<std::uint16_t>& relabel = deals.abstraction_symmetric_map(s);
    for (std::size_t h = 0; h < hands; ++h) {
      rep[h] = std::min(rep[h], static_cast<std::uint32_t>(relabel[h]));
    }
  }
  // Orbits are closed under the group, so one pass over its elements
  // reaches every member; a second pass through the reps settles chains.
  for (std::size_t h = 0; h < hands; ++h) rep[h] = rep[rep[h]];
}

// Equal-count buckets over the valid hands sorted by `score` (ties by hand
// index), keeping every tie group whole: a group takes the bucket of its
// first member's position. Invalid hands map to row 0. Produces at most
// `buckets` distinct rows; some may stay empty when ties merge, which is
// harmless (no hand reads them).
void bucket_by_score(const std::vector<double>& score, const std::vector<std::uint8_t>& valid,
                     std::uint32_t buckets, std::uint16_t* out) {
  const std::size_t hands = score.size();
  std::vector<std::uint32_t> order;
  order.reserve(hands);
  for (std::size_t h = 0; h < hands; ++h) {
    if (valid[h]) order.push_back(static_cast<std::uint32_t>(h));
  }
  std::stable_sort(order.begin(), order.end(),
                   [&](std::uint32_t a, std::uint32_t b) { return score[a] < score[b]; });
  for (std::size_t h = 0; h < hands; ++h) out[h] = 0;
  const std::size_t n = order.size();
  if (n == 0) return;
  std::size_t group_start = 0;
  for (std::size_t i = 0; i < n; ++i) {
    if (i > 0 && score[order[i]] != score[order[i - 1]]) group_start = i;
    const std::size_t b = group_start * buckets / n;
    out[order[i]] = static_cast<std::uint16_t>(std::min<std::size_t>(b, buckets - 1));
  }
}

// Seeded k-means++ over per-hand histograms (hands x bins, valid hands
// only), Lloyd iterations to a fixed cap, nearest-center ties to the lower
// index, then clusters relabeled in ascending mean-`order_score` so bucket
// ids read as "weaker to stronger". Everything is +, -, * and compares on
// doubles in a fixed order, so it is reproducible across compilers under
// strict FP. Invalid hands map to row 0.
void bucket_kmeans(const std::vector<double>& hist, int bins, const std::vector<double>& order_score,
                   const std::vector<std::uint8_t>& valid, std::uint32_t buckets,
                   std::uint64_t seed, std::uint16_t* out) {
  const std::size_t hands = valid.size();
  std::vector<std::uint32_t> points;
  for (std::size_t h = 0; h < hands; ++h) {
    if (valid[h]) points.push_back(static_cast<std::uint32_t>(h));
  }
  for (std::size_t h = 0; h < hands; ++h) out[h] = 0;
  const std::size_t n = points.size();
  if (n == 0) return;
  const std::size_t k = std::min<std::size_t>(buckets, n);
  const std::size_t dim = static_cast<std::size_t>(bins);
  const auto row = [&](std::uint32_t h) { return hist.data() + static_cast<std::size_t>(h) * dim; };
  const auto dist2 = [&](const double* a, const double* b) {
    double d = 0.0;
    for (std::size_t j = 0; j < dim; ++j) {
      const double t = a[j] - b[j];
      d += t * t;
    }
    return d;
  };

  // k-means++ seeding.
  std::vector<double> centers(k * dim, 0.0);
  SplitMix64 rng{seed};
  std::vector<double> best(n, 0.0);
  {
    const std::size_t first = static_cast<std::size_t>(rng.next() % n);
    std::copy(row(points[first]), row(points[first]) + dim, centers.begin());
    for (std::size_t i = 0; i < n; ++i) best[i] = dist2(row(points[i]), centers.data());
    for (std::size_t c = 1; c < k; ++c) {
      double total = 0.0;
      for (double d : best) total += d;
      std::size_t pick = 0;
      if (total > 0.0) {
        const double r = rng.unit() * total;
        double acc = 0.0;
        pick = n - 1;
        for (std::size_t i = 0; i < n; ++i) {
          acc += best[i];
          if (acc > r) {
            pick = i;
            break;
          }
        }
      } else {
        pick = static_cast<std::size_t>(rng.next() % n);
      }
      double* center = centers.data() + c * dim;
      std::copy(row(points[pick]), row(points[pick]) + dim, center);
      for (std::size_t i = 0; i < n; ++i) {
        best[i] = std::min(best[i], dist2(row(points[i]), center));
      }
    }
  }

  std::vector<std::uint32_t> assign(n, 0);
  std::vector<double> sums(k * dim);
  std::vector<std::uint32_t> counts(k);
  constexpr int kMaxIterations = 30;
  for (int iter = 0; iter < kMaxIterations; ++iter) {
    bool moved = false;
    for (std::size_t i = 0; i < n; ++i) {
      std::size_t arg = 0;
      double bestd = dist2(row(points[i]), centers.data());
      for (std::size_t c = 1; c < k; ++c) {
        const double d = dist2(row(points[i]), centers.data() + c * dim);
        if (d < bestd) {
          bestd = d;
          arg = c;
        }
      }
      if (assign[i] != arg) {
        assign[i] = static_cast<std::uint32_t>(arg);
        moved = true;
      }
    }
    if (!moved && iter > 0) break;
    std::fill(sums.begin(), sums.end(), 0.0);
    std::fill(counts.begin(), counts.end(), 0u);
    for (std::size_t i = 0; i < n; ++i) {
      const double* r = row(points[i]);
      double* s = sums.data() + assign[i] * dim;
      for (std::size_t j = 0; j < dim; ++j) s[j] += r[j];
      ++counts[assign[i]];
    }
    for (std::size_t c = 0; c < k; ++c) {
      if (counts[c] == 0) continue;  // an empty cluster keeps its center
      const double inv = 1.0 / static_cast<double>(counts[c]);
      for (std::size_t j = 0; j < dim; ++j) centers[c * dim + j] = sums[c * dim + j] * inv;
    }
  }

  // Relabel clusters by ascending mean order score; empty clusters last.
  std::vector<double> mean_score(k, 0.0);
  std::vector<std::uint32_t> members(k, 0);
  for (std::size_t i = 0; i < n; ++i) {
    mean_score[assign[i]] += order_score[points[i]];
    ++members[assign[i]];
  }
  std::vector<std::uint32_t> cluster_order(k);
  std::iota(cluster_order.begin(), cluster_order.end(), 0u);
  std::stable_sort(cluster_order.begin(), cluster_order.end(), [&](std::uint32_t a, std::uint32_t b) {
    if ((members[a] == 0) != (members[b] == 0)) return members[b] == 0;
    const double ma = members[a] ? mean_score[a] / members[a] : 0.0;
    const double mb = members[b] ? mean_score[b] / members[b] : 0.0;
    return ma < mb;
  });
  std::vector<std::uint16_t> relabel(k);
  for (std::size_t r = 0; r < k; ++r) relabel[cluster_order[r]] = static_cast<std::uint16_t>(r);
  for (std::size_t i = 0; i < n; ++i) out[points[i]] = relabel[assign[i]];
}

struct LineKey {
  std::uint64_t canonical;
  std::uint64_t line_hash;
  bool operator==(const LineKey& o) const {
    return canonical == o.canonical && line_hash == o.line_hash;
  }
};
struct LineKeyHash {
  std::size_t operator()(const LineKey& k) const {
    return static_cast<std::size_t>(k.canonical * 0x9E3779B97F4A7C15ULL ^ k.line_hash);
  }
};

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
  const PublicTree& tree = game.tree();
  const std::uint32_t decisions = tree.num_decision_nodes;

  // The suit-symmetry quotient: storage rows are per CLASS when the game
  // reports one and the config keeps it on (the default). Identity
  // otherwise, so that path is bit-for-bit the unquotiented solver.
  std::vector<std::uint16_t> class_of;
  int num_classes = 0;
  deals.hand_classes(class_of, num_classes);
  if (config.abstraction.enabled) {
    if (!deals.abstraction_supported()) {
      throw std::runtime_error(
          "algorithm.sampled.abstraction: this game has no per-board hand abstraction");
    }
    if (!teammate_of.empty()) {
      for (int mate : teammate_of) {
        if (mate >= 0) {
          throw std::runtime_error(
              "algorithm.sampled.abstraction is not supported with a hand-sharing team");
        }
      }
    }
    ix.mode = Mode::Abstraction;
  } else if (config.symmetry && num_classes > 0) {
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

  ix.group_of.resize(decisions);
  ix.rows_of.resize(decisions);
  ix.map_of.assign(decisions, 0);
  ix.perm_of.assign(decisions, kIdentityPerm);

  if (ix.mode != Mode::Abstraction) {
    // One group per decision node, in decision-index order - the layout the
    // solver always had. Decision indices are dense in node order.
    ix.group_offset.resize(decisions);
    ix.group_rep.resize(decisions);
    ix.store_total = 0;
    for (const Node& node : tree.nodes) {
      if (node.kind != NodeKind::Decision) continue;
      const std::uint32_t d = node.decision_index;
      const bool team_actor =
          !teammate_of.empty() && teammate_of[static_cast<std::size_t>(node.actor)] >= 0;
      const std::uint32_t rows =
          team_actor ? static_cast<std::uint32_t>(joint_classes)
                     : (ix.mode == Mode::GlobalClass
                            ? static_cast<std::uint32_t>(ix.num_classes)
                            : static_cast<std::uint32_t>(game.num_hands(node.actor)));
      ix.group_of[d] = d;
      ix.rows_of[d] = rows;
      ix.group_offset[d] = ix.store_total;
      ix.group_rep[d] = d;
      ix.store_total += static_cast<std::size_t>(node.num_children) * rows;
    }
    ix.num_groups = decisions;
    ix.num_maps = 1;
    return ix;
  }

  // ---- Abstraction mode ----
  const AbstractionConfig& ab = config.abstraction;
  const int syms = ab.board_isomorphism ? deals.abstraction_symmetries() : 0;
  // Map 0 is the identity, for streets solved per hand.
  ix.map_storage.assign(ix.num_hands, 0);
  ix.valid_storage.assign(ix.num_hands, 1);
  for (std::uint32_t h = 0; h < ix.num_hands; ++h) ix.map_storage[h] = static_cast<std::uint16_t>(h);
  ix.num_maps = 1;

  // A public state's ORDERED key: the board set in the low 52 bits and the
  // runout cards in the order they came, one plus the card code per 6-bit
  // slot above (0 = no card). Two slots cover every tree this engine builds
  // (a flop root deals a turn and a river); anything deeper is refused.
  constexpr int kMaxRunout = 2;
  const auto pack = [](std::uint64_t mask, const std::vector<std::uint8_t>& runout) {
    std::uint64_t key = mask & ((std::uint64_t{1} << 52) - 1);
    for (std::size_t i = 0; i < runout.size(); ++i) {
      key |= static_cast<std::uint64_t>(runout[i] + 1) << (52 + 6 * i);
    }
    return key;
  };
  const auto mask_of = [](std::uint64_t key) { return key & ((std::uint64_t{1} << 52) - 1); };
  const auto image = [&](int s, std::uint64_t key) {
    std::uint64_t out = deals.abstraction_symmetric_key(s, mask_of(key));
    for (int i = 0; i < kMaxRunout; ++i) {
      const std::uint64_t slot = (key >> (52 + 6 * i)) & 63u;
      if (slot == 0) continue;
      const int card = deals.abstraction_symmetric_card(s, static_cast<int>(slot) - 1);
      out |= static_cast<std::uint64_t>(card + 1) << (52 + 6 * i);
    }
    return out;
  };
  // Per distinct ordered key: its canonical form and the symmetry taking the
  // canonical form to it (identity when the key is its own canonical form).
  struct KeyInfo {
    std::uint64_t canonical;
    int symmetry;  // -1 = identity
  };
  std::unordered_map<std::uint64_t, KeyInfo> key_info;
  const auto canonicalize = [&](std::uint64_t key) -> const KeyInfo& {
    auto it = key_info.find(key);
    if (it != key_info.end()) return it->second;
    std::uint64_t canonical = key;
    for (int s = 0; s < syms; ++s) canonical = std::min(canonical, image(s, key));
    int symmetry = -1;
    if (canonical != key) {
      for (int s = 0; s < syms; ++s) {
        if (image(s, canonical) == key) {
          symmetry = s;
          break;
        }
      }
      if (symmetry < 0) {
        throw std::runtime_error("hand abstraction: symmetries do not form a group");
      }
    }
    return key_info.emplace(key, KeyInfo{canonical, symmetry}).first->second;
  };

  // Map registry: canonical (key) -> map index; composed (key, symmetry) ->
  // map index. Maps are per BOARD, shared by every node on that board.
  std::unordered_map<std::uint64_t, std::uint32_t> canonical_map;
  std::map<std::pair<std::uint64_t, int>, std::uint32_t> composed_map;
  const auto canonical_map_index = [&](std::uint64_t key, Street street, std::uint32_t buckets,
                                       std::uint32_t tiers) {
    auto it = canonical_map.find(key);
    if (it != canonical_map.end()) return it->second;
    const std::uint32_t index = ix.num_maps++;
    ix.board_maps.push_back(BoardMap{key, street, buckets, tiers, index});
    canonical_map.emplace(key, index);
    return index;
  };
  const auto composed_map_index = [&](std::uint64_t canonical, int symmetry, std::uint32_t cmap) {
    const auto k = std::make_pair(canonical, symmetry);
    auto it = composed_map.find(k);
    if (it != composed_map.end()) return it->second;
    const std::uint32_t index = ix.num_maps++;
    ix.composed_maps.push_back(ComposedMap{cmap, symmetry, index});
    composed_map.emplace(k, index);
    return index;
  };

  // Group registry: (canonical key, line hash) -> group, with the line kept
  // per group in one arena so a hash collision is caught rather than
  // silently sharing rows between different public states.
  std::unordered_map<LineKey, std::uint32_t, LineKeyHash> groups;
  std::vector<std::uint16_t> line_arena;
  std::vector<std::pair<std::uint32_t, std::uint32_t>> group_line;  // offset, length
  std::vector<std::uint32_t> group_cells;
  std::vector<std::uint16_t> line;
  std::vector<std::uint8_t> runout;

  const auto walk = [&](auto& self, NodeId id) -> void {
    const Node& node = tree[id];
    if (node.kind == NodeKind::Terminal) return;
    if (node.kind == NodeKind::Chance) {
      if (runout.size() >= static_cast<std::size_t>(kMaxRunout)) {
        throw std::runtime_error("hand abstraction: more than two runout cards below the root");
      }
      for (std::uint16_t c = 0; c < node.num_children; ++c) {
        const NodeId child = node.first_child + c;
        runout.push_back(static_cast<std::uint8_t>(tree[child].dealt_card));
        self(self, child);
        runout.pop_back();
      }
      return;
    }
    const std::uint32_t d = node.decision_index;
    const std::uint32_t hands = static_cast<std::uint32_t>(game.num_hands(node.actor));
    const std::uint32_t tiers = tiers_for(ab, node.street);
    // Strength buckets, capped so buckets x tiers never exceeds the hands.
    std::uint32_t buckets = std::min(buckets_for(ab, node.street), hands);
    if (buckets > 0 && tiers > 1) buckets = std::max<std::uint32_t>(1, std::min(buckets, hands / tiers));
    const std::uint32_t rows = buckets * tiers;
    if (buckets == 0) {
      // Per-hand rows on this street: a group of its own, the identity map.
      const std::uint32_t g = ix.num_groups++;
      ix.group_of[d] = g;
      ix.rows_of[d] = hands;
      ix.map_of[d] = 0;
      ix.group_rep.push_back(d);
      group_cells.push_back(static_cast<std::uint32_t>(node.num_children) * hands);
      group_line.push_back({0, 0});
    } else {
      const std::uint64_t key = pack(deals.abstraction_key(id), runout);
      const KeyInfo& info = canonicalize(key);
      const std::uint64_t canonical_mask = mask_of(info.canonical);
      std::uint64_t line_hash = 14695981039346656037ULL;
      line_hash = fnv1a(line_hash, line.data(), line.size() * sizeof(std::uint16_t));
      const LineKey lk{info.canonical, line_hash};
      auto it = groups.find(lk);
      std::uint32_t g;
      if (it == groups.end()) {
        g = ix.num_groups++;
        groups.emplace(lk, g);
        ix.group_rep.push_back(d);
        group_cells.push_back(static_cast<std::uint32_t>(node.num_children) * rows);
        group_line.push_back({static_cast<std::uint32_t>(line_arena.size()),
                              static_cast<std::uint32_t>(line.size())});
        line_arena.insert(line_arena.end(), line.begin(), line.end());
      } else {
        g = it->second;
        const auto [off, len] = group_line[g];
        const bool same_line =
            len == line.size() &&
            std::equal(line.begin(), line.end(), line_arena.begin() + off);
        if (!same_line) {
          throw std::runtime_error("hand abstraction: betting-line hash collision");
        }
        if (group_cells[g] != static_cast<std::uint32_t>(node.num_children) * rows) {
          throw std::runtime_error(
              "hand abstraction: symmetric public states differ in shape - tree builder bug");
        }
      }
      ix.group_of[d] = g;
      ix.rows_of[d] = rows;
      // The MAP is a property of the board set alone (strengths and
      // equities do not depend on the order), keyed by the canonical
      // runout's set; the relabeling is the one that identifies the two
      // ordered public states, so a member's rows read consistently.
      const std::uint32_t cmap = canonical_map_index(canonical_mask, node.street, buckets, tiers);
      if (info.symmetry < 0) {
        ix.map_of[d] = cmap;
      } else {
        ix.map_of[d] = composed_map_index(canonical_mask, info.symmetry, cmap);
        ix.perm_of[d] = static_cast<std::uint16_t>(info.symmetry);
      }
    }
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      line.push_back(c);
      self(self, node.first_child + c);
      line.pop_back();
    }
  };
  walk(walk, tree.root());

  // Shape check across a group's members: actor, street, pot and actions
  // must agree with the representative (cells already agreed above).
  std::vector<NodeId> node_of_decision(decisions);
  for (NodeId id = 0; id < tree.size(); ++id) {
    if (tree[id].kind == NodeKind::Decision) node_of_decision[tree[id].decision_index] = id;
  }
  for (const Node& node : tree.nodes) {
    if (node.kind != NodeKind::Decision) continue;
    const Node& rep = tree[node_of_decision[ix.group_rep[ix.group_of[node.decision_index]]]];
    if (rep.actor != node.actor || rep.street != node.street || rep.pot != node.pot ||
        rep.num_children != node.num_children) {
      throw std::runtime_error(
          "hand abstraction: symmetric public states differ in shape - tree builder bug");
    }
  }

  ix.group_offset.resize(ix.num_groups);
  ix.store_total = 0;
  for (std::uint32_t g = 0; g < ix.num_groups; ++g) {
    ix.group_offset[g] = ix.store_total;
    ix.store_total += group_cells[g];
  }
  ix.map_storage.resize(static_cast<std::size_t>(ix.num_maps) * ix.num_hands, 0);
  ix.valid_storage.resize(static_cast<std::size_t>(ix.num_maps) * ix.num_hands, 1);
  return ix;
}

void InfosetIndexer::fit(const DealGame& deals, const SampledConfig& config, ThreadPool& pool) {
  if (mode != Mode::Abstraction) {
    fitted = true;
    return;
  }
  const AbstractionConfig& ab = config.abstraction;
  const std::size_t H = num_hands;
  pool.parallel_for(static_cast<int>(board_maps.size()), [&](int i) {
    const BoardMap& bm = board_maps[static_cast<std::size_t>(i)];
    std::uint16_t* out = map_storage.data() + static_cast<std::size_t>(bm.map_index) * H;
    std::uint8_t* valid_out = valid_storage.data() + static_cast<std::size_t>(bm.map_index) * H;
    std::vector<std::uint8_t> valid(H, 1);
    // Hands that are images of each other under the board's pointwise
    // stabilizer read the representative's features, so they cannot land
    // on different sides of a quantile boundary through rounding.
    std::vector<std::uint32_t> rep;
    canonical_hands(deals, bm.key, H, rep);
    if (bm.street == Street::River) {
      std::vector<std::uint32_t> strength;
      deals.abstraction_strengths(bm.key, strength);
      std::vector<double> score(H, 0.0);
      for (std::size_t h = 0; h < H; ++h) {
        valid[h] = strength[rep[h]] != 0 ? 1 : 0;
        score[h] = static_cast<double>(strength[rep[h]]);
      }
      bucket_by_score(score, valid, bm.buckets, out);
    } else {
      std::vector<float> equity;
      int per_hand = 0;
      deals.abstraction_equities(bm.key, equity, per_hand, valid);
      for (std::size_t h = 0; h < H; ++h) valid[h] = valid[rep[h]];
      std::vector<double> mean(H, 0.0);
      std::vector<double> second(H, 0.0);
      for (std::size_t h = 0; h < H; ++h) {
        if (!valid[h] || rep[h] != h) continue;
        double sum = 0.0;
        double sum2 = 0.0;
        const float* row = equity.data() + h * static_cast<std::size_t>(per_hand);
        for (int j = 0; j < per_hand; ++j) {
          const double e = static_cast<double>(row[j]);
          sum += e;
          sum2 += e * e;
        }
        mean[h] = sum / static_cast<double>(per_hand);
        second[h] = sum2 / static_cast<double>(per_hand);
      }
      for (std::size_t h = 0; h < H; ++h) {
        if (rep[h] == h) continue;
        mean[h] = mean[rep[h]];
        second[h] = second[rep[h]];
      }
      if (ab.method == "moments") {
        // Strength quantiles of E[HS], crossed with GLOBAL quantiles of the
        // spread E[HS^2] - E[HS]^2 over the board's hands: bucket =
        // tiers * strength + tier. Global rather than conditional tiers is
        // what the decoded Monker tables show (69-117 of 120 flop buckets
        // occupied on a board, never all of them).
        std::vector<double> spread(H, 0.0);
        for (std::size_t h = 0; h < H; ++h) {
          if (valid[h]) spread[h] = second[h] - mean[h] * mean[h];
        }
        std::vector<std::uint16_t> strength_bucket(H, 0);
        std::vector<std::uint16_t> tier(H, 0);
        bucket_by_score(mean, valid, bm.buckets, strength_bucket.data());
        bucket_by_score(spread, valid, bm.tiers, tier.data());
        for (std::size_t h = 0; h < H; ++h) {
          out[h] = valid[h] ? static_cast<std::uint16_t>(strength_bucket[h] * bm.tiers + tier[h])
                            : 0;
        }
      } else if (ab.method == "histogram") {
        const std::size_t bins = static_cast<std::size_t>(ab.bins);
        std::vector<double> hist(H * bins, 0.0);
        const double inv = 1.0 / static_cast<double>(per_hand);
        for (std::size_t h = 0; h < H; ++h) {
          if (!valid[h] || rep[h] != h) continue;
          const float* row = equity.data() + h * static_cast<std::size_t>(per_hand);
          for (int j = 0; j < per_hand; ++j) {
            std::size_t b = static_cast<std::size_t>(static_cast<double>(row[j]) * static_cast<double>(bins));
            if (b >= bins) b = bins - 1;
            hist[h * bins + b] += inv;
          }
        }
        for (std::size_t h = 0; h < H; ++h) {
          if (rep[h] == h) continue;
          std::copy(hist.begin() + static_cast<std::ptrdiff_t>(rep[h] * bins),
                    hist.begin() + static_cast<std::ptrdiff_t>((rep[h] + 1) * bins),
                    hist.begin() + static_cast<std::ptrdiff_t>(h * bins));
        }
        bucket_kmeans(hist, ab.bins, mean, valid, bm.buckets, ab.seed ^ bm.key, out);
      } else {
        bucket_by_score(mean, valid, bm.buckets, out);
      }
    }
    for (std::size_t h = 0; h < H; ++h) valid_out[h] = valid[h];
  });
  // Composed maps: the image board reads the canonical board's rows through
  // the symmetry's hand relabeling, image[h] = canonical[map[h]].
  for (const ComposedMap& cm : composed_maps) {
    const std::vector<std::uint16_t>& relabel = deals.abstraction_symmetric_map(cm.symmetry);
    const std::uint16_t* src = map_storage.data() + static_cast<std::size_t>(cm.canonical_map) * H;
    const std::uint8_t* src_valid =
        valid_storage.data() + static_cast<std::size_t>(cm.canonical_map) * H;
    std::uint16_t* out = map_storage.data() + static_cast<std::size_t>(cm.map_index) * H;
    std::uint8_t* valid_out = valid_storage.data() + static_cast<std::size_t>(cm.map_index) * H;
    for (std::size_t h = 0; h < H; ++h) {
      out[h] = src[relabel[h]];
      valid_out[h] = src_valid[relabel[h]];
    }
  }
  fitted = true;
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
