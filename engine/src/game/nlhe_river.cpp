#include "game/nlhe_river.hpp"

#include <algorithm>
#include <bit>

#include <cstddef>
#include <cstdint>
#include <limits>
#include <map>

#include <memory>
#include <stdexcept>
#include <vector>

#include "game/betting_tree.hpp"
#include "ranges/range.hpp"
#include "solver/deal.hpp"
#include "util/parallel.hpp"


namespace engine {

NlhePostflopGame::NlhePostflopGame(const SolveConfig& config) {
  num_seats_ = static_cast<int>(config.players.size());
  if (num_seats_ < 2 || num_seats_ > kMaxSeats) {
    throw std::runtime_error("NlhePostflopGame needs 2 to " + std::to_string(kMaxSeats) +
                             " players; got " + std::to_string(num_seats_));
  }
  board_ = parse_cards(config.board);
  board_mask_ = cards_mask(board_);
  for (int c = 0; c < kNumCards; ++c) {
    if ((board_mask_ & (1ULL << c)) == 0) live_deck_.push_back(static_cast<std::uint8_t>(c));
  }
  runout_count_ = 5 - static_cast<int>(board_.size());


  // Parse both ranges over the canonical 1326 order, mask them against the
  // root board, and only then derive the universe - so a combo that survives
  // is one some seat can actually hold on this board.
  std::vector<std::vector<float>> canonical(static_cast<std::size_t>(num_seats_));
  for (int s = 0; s < num_seats_; ++s) {
    canonical[s] = parse_range(config.players[s].range);
    mask_range_vs_board(canonical[s], board_mask_);
    float total = 0.0f;
    for (float w : canonical[s]) total += w;
    if (total <= 0.0f) {
      throw std::runtime_error("player " + config.players[s].seat +
                               " has an empty range after board card removal");
    }
  }
  universe_ = HandUniverse::from_ranges(canonical);
  for (int h = 0; h < universe_.size(); ++h) {
    blocking_[universe_.combos[static_cast<std::size_t>(h)].hi].push_back(
        static_cast<std::uint16_t>(h));
    blocking_[universe_.combos[static_cast<std::size_t>(h)].lo].push_back(
        static_cast<std::uint16_t>(h));
  }
  ranges_.resize(static_cast<std::size_t>(num_seats_));
  for (int s = 0; s < num_seats_; ++s) ranges_[s] = universe_.compact(canonical[s]);
  stacks_.resize(static_cast<std::size_t>(num_seats_));
  for (int s = 0; s < num_seats_; ++s) stacks_[s] = config.players[s].stack;

  // Per-seat range totals and per-card masses. Everything below - the profile
  // normalizer and the EV pass's importance weights - is inclusion-exclusion
  // over these, never a rescan of the range.
  {
    const int hands = universe_.size();
    const std::vector<Combo>& combos = universe_.combos;
    range_total_.assign(static_cast<std::size_t>(num_seats_), 0.0);
    range_per_card_.assign(static_cast<std::size_t>(num_seats_), {});
    range_cdf_.assign(static_cast<std::size_t>(num_seats_), {});
    for (int s = 0; s < num_seats_; ++s) {
      const std::size_t si = static_cast<std::size_t>(s);
      std::vector<double>& cdf = range_cdf_[si];
      cdf.resize(static_cast<std::size_t>(hands));
      double acc = 0.0;
      for (int i = 0; i < hands; ++i) {
        const double r = ranges_[si][static_cast<std::size_t>(i)];
        acc += r;
        cdf[static_cast<std::size_t>(i)] = acc;
        range_per_card_[si][combos[static_cast<std::size_t>(i)].hi] += r;
        range_per_card_[si][combos[static_cast<std::size_t>(i)].lo] += r;
      }
      range_total_[si] = acc;
    }
  }

  // Profile normalizer: the mass of mutually card-disjoint tuples, which is
  // what turns counterfactual sums into chip-denominated EVs. Only the
  // vectorized core and the best response read it, and neither runs past
  // three seats, so beyond that it is left unset rather than approximated.
  if (num_seats_ <= 3) {
    const int hands = universe_.size();
    const std::vector<Combo>& combos = universe_.combos;
    if (num_seats_ == 2) {
      const float* r1 = ranges_[1].data();
      double z = 0.0;
      for (int i = 0; i < hands; ++i) {
        const Combo& c = combos[static_cast<std::size_t>(i)];
        z += static_cast<double>(ranges_[0][static_cast<std::size_t>(i)]) *
             (range_total_[1] - range_per_card_[1][c.hi] - range_per_card_[1][c.lo] + r1[i]);
      }
      profile_weight_ = z;
    } else {
      // Three seats: the same S(ALL,ALL) inclusion-exclusion the 3-way
      // showdown uses, evaluated once per seat-0 hand. The two opponents may
      // not share a card either, which is the term a product of two
      // compat weights would miss.
      const float* r1 = ranges_[1].data();
      const float* r2 = ranges_[2].data();
      std::array<double, kNumCards> prod_per_card{};
      double prod_total = 0.0;
      for (int i = 0; i < hands; ++i) {
        const Combo& c = combos[static_cast<std::size_t>(i)];
        const double d = static_cast<double>(r1[i]) * static_cast<double>(r2[i]);
        prod_total += d;
        prod_per_card[c.hi] += d;
        prod_per_card[c.lo] += d;
      }
      double z = 0.0;
      for (int i = 0; i < hands; ++i) {
        const double r0 = ranges_[0][static_cast<std::size_t>(i)];
        if (r0 == 0.0f) continue;
        const Combo& c = combos[static_cast<std::size_t>(i)];
        const double a1 =
            range_total_[1] - range_per_card_[1][c.hi] - range_per_card_[1][c.lo] + r1[i];
        const double a2 =
            range_total_[2] - range_per_card_[2][c.hi] - range_per_card_[2][c.lo] + r2[i];
        const double diag =
            prod_total - prod_per_card[c.hi] - prod_per_card[c.lo] +
            static_cast<double>(r1[i]) * static_cast<double>(r2[i]);
        double cross = 0.0;
        for (int card = 0; card < kNumCards; ++card) {
          if (card == c.hi || card == c.lo) continue;
          const int px = universe_.compact_index(static_cast<Card>(card), c.hi);
          const int py = universe_.compact_index(static_cast<Card>(card), c.lo);
          double x1 = 0.0, x2 = 0.0;
          if (px >= 0) { x1 += r1[px]; x2 += r2[px]; }
          if (py >= 0) { x1 += r1[py]; x2 += r2[py]; }
          cross += (range_per_card_[1][card] - x1) * (range_per_card_[2][card] - x2);
        }
        z += r0 * (a1 * a2 - cross + diag);
      }
      profile_weight_ = z;
    }
    if (profile_weight_ <= 0.0) {
      throw std::runtime_error("the ranges have no card-disjoint combination across all seats");
    }
  }

  PostflopTreeParams params;
  params.pot = config.pot;
  params.num_seats = num_seats_;
  params.effective_stack = config.players[0].stack;
  for (int seat = 0; seat < num_seats_; ++seat) {
    params.stack[static_cast<std::size_t>(seat)] = config.players[seat].stack;
  }
  params.board_mask = board_mask_;
  params.start_street = board_.size() == 3   ? Street::Flop
                        : board_.size() == 4 ? Street::Turn
                                             : Street::River;
  params.preflop_aggressor = config.preflop_aggressor;
  params.depth_limit = config.depth_limit;
  params.flop = config.flop_sizing;
  params.turn = config.turn_sizing;
  params.river = config.river_sizing;
  tree_ = build_postflop_tree(params);
  root_pot_ = tree_[tree_.root()].pot;
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind == TerminalKind::DepthLimit) ++depth_limit_terminals_;
  }
  iso_rep_.resize(tree_.size());
  for (NodeId id = 0; id < tree_.size(); ++id) iso_rep_[id] = id;
  iso_perm_.assign(tree_.size(), 0);
  if (config.isomorphism) build_isomorphism();
  build_evaluators(config.threads);
}

// Group each live chance node's children into suit-equivalence classes and
// map every member subtree node onto its representative's corresponding
// node. A permutation is usable at a chance node iff it maps that node's
// board to itself AND both ranges are invariant under it - the subtree under
// pi(c) is then the subtree under c with hands relabeled by pi, so only the
// representative is ever solved and members read its data through iso_rep().
//
// Processing nodes in id order matters twice over: a parent chance node has
// a smaller id than any chance node inside its subtrees, so by the time an
// inner chance node is visited we already know whether it lives inside a
// member subtree (and must be skipped - its rep's inner node does the
// grouping for both); and choosing the lowest card as representative makes
// every rep child precede its members in child order, which the solver's
// fold loop relies on.
void NlhePostflopGame::build_isomorphism() {
  const std::vector<SuitPerm> perms = all_suit_perms();
  std::vector<const SuitPerm*> invariant;
  for (const SuitPerm& p : perms) {
    if (ranges_invariant(p, universe_, ranges_)) invariant.push_back(&p);
  }
  if (invariant.empty()) return;  // e.g. an explicit-combo range - correct fallback

  for (NodeId id = 0; id < tree_.size(); ++id) {
    if (tree_[id].kind != NodeKind::Chance) continue;
    if (iso_rep_[id] != id) continue;  // inside a member subtree; rep handles it
    const Node& node = tree_[id];

    std::vector<const SuitPerm*> usable;
    for (const SuitPerm* p : invariant) {
      if (perm_fixes_mask(*p, node.board_mask)) usable.push_back(p);
    }
    if (usable.empty()) continue;

    // Children are in ascending card order; the first unclaimed card of each
    // class is its representative.
    for (std::uint16_t c = 0; c < node.num_children; ++c) {
      const NodeId child = node.first_child + c;
      if (iso_rep_[child] != child) continue;  // already claimed as a member
      const int card = tree_[child].dealt_card;
      for (const SuitPerm* p : usable) {
        const int image = perm_card(*p, static_cast<Card>(card));
        if (image == card) continue;
        // Locate the sibling dealing `image` (contiguous, card-ascending).
        NodeId member = kNoNode;
        for (std::uint16_t m = c + 1; m < node.num_children; ++m) {
          if (tree_[node.first_child + m].dealt_card == image) {
            member = node.first_child + m;
            break;
          }
        }
        if (member == kNoNode || iso_rep_[member] != member) continue;
        // Register (or reuse) the hand gather for this permutation.
        std::uint16_t perm_id = 0xFFFF;
        const std::vector<std::uint16_t> map = perm_hand_map(*p, universe_);
        for (std::size_t i = 0; i < perm_maps_.size(); ++i) {
          if (perm_maps_[i] == map) {
            perm_id = static_cast<std::uint16_t>(i);
            break;
          }
        }
        if (perm_id == 0xFFFF) {
          perm_id = static_cast<std::uint16_t>(perm_maps_.size());
          perm_maps_.push_back(map);
        }
        map_member_subtree(child, member, perm_id, *p);
        ++iso_collapsed_;
      }
    }
  }
}

// Walk the representative and member subtrees in lockstep, recording the
// correspondence. The betting structure is card-independent, so the shapes
// match exactly; the one wrinkle is INNER chance nodes, whose children are
// card-indexed and therefore correspond through pi, not through position.
void NlhePostflopGame::map_member_subtree(NodeId rep, NodeId member, std::uint16_t perm_id,
                                          const SuitPerm& perm) {
  const Node& rn = tree_[rep];
  const Node& mn = tree_[member];
  if (rn.kind != mn.kind || rn.num_children != mn.num_children || rn.actor != mn.actor) {
    throw std::runtime_error("suit-isomorphic subtrees differ in shape - tree builder bug");
  }
  iso_rep_[member] = rep;
  iso_perm_[member] = perm_id;

  if (rn.kind == NodeKind::Chance) {
    for (std::uint16_t c = 0; c < rn.num_children; ++c) {
      const NodeId rep_child = rn.first_child + c;
      const int image = perm_card(perm, static_cast<Card>(tree_[rep_child].dealt_card));
      NodeId member_child = kNoNode;
      for (std::uint16_t m = 0; m < mn.num_children; ++m) {
        if (tree_[mn.first_child + m].dealt_card == image) {
          member_child = mn.first_child + m;
          break;
        }
      }
      if (member_child == kNoNode) {
        throw std::runtime_error("suit-isomorphic chance children do not correspond");
      }
      map_member_subtree(rep_child, member_child, perm_id, perm);
    }
    return;
  }
  for (std::uint16_t c = 0; c < rn.num_children; ++c) {
    map_member_subtree(rn.first_child + c, mn.first_child + c, perm_id, perm);
  }
}

void NlhePostflopGame::build_evaluators(int threads) {
  // Two passes on purpose. The keys go in serially so the map's structure is
  // frozen before any thread touches it; the values are then filled in
  // parallel, each thread writing one slot nobody else looks at.
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    evaluators_.emplace(n.board_mask, nullptr);
  }
  std::vector<std::map<std::uint64_t, std::unique_ptr<RiverEvaluator>>::iterator> slots;
  slots.reserve(evaluators_.size());
  for (auto it = evaluators_.begin(); it != evaluators_.end(); ++it) slots.push_back(it);

  ThreadPool pool(resolve_thread_count(threads));
  pool.parallel_for(static_cast<int>(slots.size()), [&](int i) {
    auto& slot = *slots[static_cast<std::size_t>(i)];
    std::vector<Card> cards;
    for (int c = 0; c < kNumCards; ++c) {
      if (slot.first & (1ULL << c)) cards.push_back(static_cast<Card>(c));
    }
    slot.second = std::make_unique<RiverEvaluator>(cards, universe_.combos);
  });

  // Flatten the lookup: showdown terminals resolve by dense terminal_index
  // from here on, never by map descent.
  terminal_eval_.assign(tree_.num_terminal_nodes, nullptr);
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    terminal_eval_[n.terminal_index] = evaluators_.find(n.board_mask)->second.get();
  }

  // The 3-seat sweep needs its own per-board tables. Built only at three
  // seats: at two the pairwise path is faster and Pio-gated, and past three
  // there is no vectorized showdown to build.
  if (num_seats_ != 3) return;
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    evaluators3_.emplace(n.board_mask, nullptr);
  }
  std::vector<std::map<std::uint64_t, std::unique_ptr<Showdown3>>::iterator> slots3;
  slots3.reserve(evaluators3_.size());
  for (auto it = evaluators3_.begin(); it != evaluators3_.end(); ++it) slots3.push_back(it);
  pool.parallel_for(static_cast<int>(slots3.size()), [&](int i) {
    auto& slot = *slots3[static_cast<std::size_t>(i)];
    std::vector<Card> cards;
    for (int c = 0; c < kNumCards; ++c) {
      if (slot.first & (1ULL << c)) cards.push_back(static_cast<Card>(c));
    }
    slot.second = std::make_unique<Showdown3>(cards, universe_.combos);
  });
  terminal_eval3_.assign(tree_.num_terminal_nodes, nullptr);
  for (const Node& n : tree_.nodes) {
    if (n.terminal_kind != TerminalKind::Showdown) continue;
    terminal_eval3_[n.terminal_index] = evaluators3_.find(n.board_mask)->second.get();
  }
}

double NlhePostflopGame::total_profile_weight() const {
  if (!vectorized_terminals()) {
    throw std::runtime_error(
        "total_profile_weight is only defined for 2-3 seats: past that the disjoint-tuple mass "
        "has no cheap closed form, and nothing that consumes it (the vectorized core, the best "
        "response) runs there anyway");
  }
  return profile_weight_;
}

std::size_t NlhePostflopGame::auxiliary_bytes() const {
  // Per board: strengths (u32) + validity (u8) + the sorted index (int) +
  // tie groups (two ints), all over the valid slice of the 1326 combos.
  constexpr std::size_t kPerCombo = sizeof(std::uint32_t) + sizeof(std::uint8_t) +
                                    sizeof(std::uint64_t) + sizeof(Combo) + sizeof(int) +
                                    2 * sizeof(int);
  std::size_t bytes =
      evaluators_.size() * static_cast<std::size_t>(universe_.size()) * kPerCombo +
      live_deck_.size() + universe_.compact_of_canonical.size() * sizeof(std::int32_t);
  // The 3-seat tables carry the same per-combo arrays plus a 52x52 card-pair
  // index each, which is the price of asking "is {c, x} in the worse set" by
  // lookup instead of by a running array.
  bytes += evaluators3_.size() *
           (static_cast<std::size_t>(universe_.size()) * kPerCombo +
            static_cast<std::size_t>(kNumCards) * kNumCards * sizeof(std::int32_t));
  return bytes;
}

// ---- DealGame ----

void NlhePostflopGame::sample_deal(std::uint64_t seed, std::uint64_t iter, Deal& out) const {
  // Seats' holes first, then the runout - the order is part of the deal's
  // definition (deal.hpp), and deal_cards is a pure function of (seed, iter).
  const int hole = 2 * num_seats_;
  std::uint8_t drawn[2 * kMaxSeats + 5];
  deal_cards(seed, iter, static_cast<int>(live_deck_.size()), hole + runout_count_, drawn);
  out.hole_per_seat = 2;
  out.board_count = runout_count_;
  for (int s = 0; s < num_seats_; ++s) {
    const Card a = live_deck_[drawn[2 * s]];
    const Card b = live_deck_[drawn[2 * s + 1]];
    out.hole[static_cast<std::size_t>(2 * s)] = a;
    out.hole[static_cast<std::size_t>(2 * s) + 1] = b;
    const int idx = universe_.compact_index(a, b);
    out.hand[static_cast<std::size_t>(s)] =
        idx < 0 ? std::numeric_limits<std::uint16_t>::max() : static_cast<std::uint16_t>(idx);
  }
  for (int b = 0; b < runout_count_; ++b) {
    out.board[static_cast<std::size_t>(b)] = live_deck_[drawn[hole + b]];
  }
}

bool NlhePostflopGame::sample_ev_deal(std::uint64_t seed, std::uint64_t iter, Deal& out,
                                      double& weight) const {
  // One draw per selection step, counter-based like every draw in the
  // engine: (seed, iter, k) -> a unit in [0, 1), never a stateful RNG.
  const auto unit = [seed, iter](std::uint32_t k) {
    return static_cast<double>(deal_draw(seed, iter, k) >> 11) * 0x1.0p-53;
  };
  const auto pick = [](const std::vector<double>& cdf, double u) {
    const double target = u * cdf.back();
    const auto it = std::upper_bound(cdf.begin(), cdf.end(), target);
    return static_cast<int>(std::min<std::ptrdiff_t>(it - cdf.begin(),
                                                     static_cast<std::ptrdiff_t>(cdf.size()) - 1));
  };

  out.hole_per_seat = 2;
  out.board_count = runout_count_;
  for (int s = 0; s < num_seats_; ++s) {
    out.hand[static_cast<std::size_t>(s)] = std::numeric_limits<std::uint16_t>::max();
  }

  // Seats are dealt in order, each in proportion to its own range and
  // conditioned on the cards already gone. The importance weight that makes
  // this exact for the product measure is the product of the masses the
  // conditioning divided out - which is also each step's rejection acceptance
  // rate, so rejection sampling and the weight come from the same number.
  std::uint8_t used_cards[2 * kMaxSeats + 5];
  int used_n = 0;
  std::uint64_t used = board_mask_;
  for (int c = 0; c < kNumCards; ++c) {
    if (board_mask_ & (1ULL << c)) used_cards[used_n++] = static_cast<std::uint8_t>(c);
  }

  double w = 1.0;
  std::uint32_t k = 0;
  for (int seat = 0; seat < num_seats_; ++seat) {
    const std::size_t si = static_cast<std::size_t>(seat);
    // Mass of this seat's range disjoint from `used`, by inclusion-exclusion
    // over the dealt cards. A 2-card combo can hold at most two of them, so
    // the series stops at pairs instead of running to 52.
    double mass = range_total_[si];
    for (int i = 0; i < used_n; ++i) mass -= range_per_card_[si][used_cards[i]];
    for (int i = 0; i < used_n; ++i) {
      for (int j = i + 1; j < used_n; ++j) {
        const int idx = universe_.compact_index(static_cast<Card>(used_cards[i]),
                                                static_cast<Card>(used_cards[j]));
        if (idx >= 0) mass += ranges_[si][static_cast<std::size_t>(idx)];
      }
    }
    int hand = -1;
    if (mass > 0.0) {
      for (std::uint32_t t = 0; t < 128; ++t) {
        const int cand = pick(range_cdf_[si], unit(k++));
        if ((universe_.masks[static_cast<std::size_t>(cand)] & used) == 0) {
          hand = cand;
          break;
        }
      }
    }
    if (hand < 0) {
      // This seat's whole range collides with what is already dealt (mass 0
      // says so), or an absurd rejection streak. Weigh the deal nothing
      // rather than bias the estimator with a fallback draw.
      weight = 0.0;
      return true;
    }
    w *= mass;
    const Combo& c = universe_.combos[static_cast<std::size_t>(hand)];
    out.hand[si] = static_cast<std::uint16_t>(hand);
    out.hole[2 * si] = c.hi;
    out.hole[2 * si + 1] = c.lo;
    used |= universe_.masks[static_cast<std::size_t>(hand)];
    used_cards[used_n++] = c.hi;
    used_cards[used_n++] = c.lo;
  }
  weight = w;

  // The runout: uniform over what is left of the deck. A distinct seed
  // stream from the hand draws (deal_cards keys on k from 0 too).
  if (runout_count_ > 0) {
    std::uint8_t remaining[kNumCards];
    int n = 0;
    for (int c = 0; c < kNumCards; ++c) {
      if ((used & (1ULL << c)) == 0) remaining[n++] = static_cast<std::uint8_t>(c);
    }
    std::uint8_t drawn[5];
    deal_cards(seed ^ 0xC2B2AE3D27D4EB4FULL, iter, n, runout_count_, drawn);
    for (int b = 0; b < runout_count_; ++b) {
      out.board[static_cast<std::size_t>(b)] = remaining[drawn[b]];
    }
  }
  return true;
}

void NlhePostflopGame::deal_strengths(const Deal& deal, std::vector<std::uint32_t>& out) const {

  std::uint64_t mask = board_mask_;
  for (int b = 0; b < deal.board_count; ++b) mask |= 1ULL << deal.board[static_cast<std::size_t>(b)];
  const auto it = evaluators_.find(mask);
  if (it == evaluators_.end()) {
    // Every runout reaches a showdown terminal by construction, so a miss
    // means the deal and the tree disagree - say so rather than evaluate a
    // board the tree cannot reach.
    throw std::runtime_error("no showdown evaluator for the dealt runout - tree and deal disagree");
  }
  out = it->second->strengths();
}

void NlhePostflopGame::deal_showdown_values(NodeId id, int seat, const Deal& deal,
                                            const std::vector<std::uint32_t>& strengths,
                                            std::vector<float>& out) const {
  const Node& node = tree_[id];
  const int hands = universe_.size();
  const float base = -static_cast<float>(node.commit[static_cast<std::size_t>(seat)]);
  out.assign(static_cast<std::size_t>(hands), base);

  std::array<std::uint32_t, kMaxSeats> str{};
  for (int s = 0; s < num_seats_; ++s) {
    if (s == seat) continue;
    const std::uint16_t h = deal.hand[static_cast<std::size_t>(s)];
    // A pinned seat outside its range: the caller multiplies this row by its
    // zero reach, so the values never surface; return the commitment row
    // rather than index the sentinel.
    if (h == std::numeric_limits<std::uint16_t>::max()) return;
    str[static_cast<std::size_t>(s)] = strengths[h];
  }

  if (num_seats_ == 2) {
    // The heads-up fast path stays: no layers, no side pots, no per-hand
    // showdown_share call.
    const std::uint32_t s_opp = str[static_cast<std::size_t>(1 - seat)];
    const float pot = static_cast<float>(node.pot);
    const float half = pot * 0.5f;
    for (int h = 0; h < hands; ++h) {
      // Hands colliding with the deal (board or the opponent's cards) carry
      // garbage here; the caller's reach is zero there, same as preflop.
      const std::uint32_t sh = strengths[static_cast<std::size_t>(h)];
      out[static_cast<std::size_t>(h)] += sh > s_opp ? pot : (sh == s_opp ? half : 0.0f);
    }
    return;
  }

  // Multiway: every opponent is pinned, so the whole side-pot rule is a
  // scalar evaluation per hero hand. This is exactly why the sampled core
  // reaches seat counts the vectorized terminal cannot.
  for (int h = 0; h < hands; ++h) {
    str[static_cast<std::size_t>(seat)] = strengths[static_cast<std::size_t>(h)];
    out[static_cast<std::size_t>(h)] =
        base + static_cast<float>(showdown_share(seat, num_seats_, node.commit, root_pot_,
                                                 node.folded_mask, str.data()));
  }
}

void NlhePostflopGame::deal_showdown_pinned(NodeId id, const Deal& deal,
                                            const std::vector<std::uint32_t>& strengths,
                                            int num_seats, std::vector<double>& out) const {
  const Node& node = tree_[id];
  out.assign(static_cast<std::size_t>(num_seats), 0.0);
  std::array<std::uint32_t, kMaxSeats> str{};
  for (int s = 0; s < num_seats; ++s) {
    str[static_cast<std::size_t>(s)] = strengths[deal.hand[static_cast<std::size_t>(s)]];
  }
  for (int s = 0; s < num_seats; ++s) {
    out[static_cast<std::size_t>(s)] =
        -static_cast<double>(node.commit[static_cast<std::size_t>(s)]) +
        showdown_share(s, num_seats, node.commit, root_pot_, node.folded_mask, str.data());
  }
}

void NlhePostflopGame::terminal_values(NodeId id, int seat,
                                       const std::vector<std::vector<float>>& reach,
                                       std::vector<float>& out) const {
  const Node& node = tree_[id];
  const double my_delta = static_cast<double>(node.commit[static_cast<std::size_t>(seat)]);
  const double pot = static_cast<double>(node.pot);
  if (node.terminal_kind == TerminalKind::DepthLimit) {
    const int hands = universe_.size();
    if (!leaf_matrix_.empty() &&
        !leaf_matrix_[static_cast<std::size_t>(node.terminal_index)].empty()) {
      const std::vector<float>& m = leaf_matrix_[static_cast<std::size_t>(node.terminal_index)];
      const std::size_t h_count = static_cast<std::size_t>(hands);
      out.assign(h_count, 0.0f);
      if (seat == 0) {
        // out[h] = sum_o r1[o] * u0(h, o). One axpy per opponent hand, and
        // real ranges leave most of them at zero.
        const float* r1 = reach[1].data();
        for (std::size_t o = 0; o < h_count; ++o) {
          const float w = r1[o];
          if (w == 0.0f) continue;
          const float* col = m.data() + o * h_count;
          for (std::size_t h = 0; h < h_count; ++h) out[h] += w * col[h];
        }
      } else {
        // out[o] = sum_h r0[h] * u1(o, h) = root_pot * compat[o] - sum_h r0[h] * u0(h, o).
        // The subtraction is what makes the two seats one game: seat 1's
        // values are derived from seat 0's, never stored independently.
        compat_weights(1, reach, out);
        const float* r0 = reach[0].data();
        const float pot_root = static_cast<float>(root_pot_);
        for (std::size_t o = 0; o < h_count; ++o) {
          const float* col = m.data() + o * h_count;
          double acc = 0.0;
          for (std::size_t h = 0; h < h_count; ++h) {
            acc += static_cast<double>(r0[h]) * static_cast<double>(col[h]);
          }
          out[o] = out[o] * pot_root - static_cast<float>(acc);
        }
      }
      return;
    }

    const std::vector<float>& table = leaf_ev_[static_cast<std::size_t>(seat)];
    if (table.empty()) {
      throw std::runtime_error("depth-limited tree evaluated with no leaf table - call "
                               "set_leaf_values() or set_leaf_matrices() before solving");
    }
    // Counterfactual value = conditional continuation value x the opponent
    // reach mass compatible with this hand. compat_weights already handles
    // runout blocking (blocked combos carry zero reach).
    compat_weights(seat, reach, out);
    const float* e = table.data() + static_cast<std::size_t>(node.terminal_index) *
                                        static_cast<std::size_t>(hands);
    for (int i = 0; i < hands; ++i) out[i] *= e[i];
  } else if (node.terminal_kind == TerminalKind::Fold) {
    // Fold utility depends only on compatibility: hands blocked by dealt
    // runout cards already carry zero reach on both sides.
    compat_weights(seat, reach, out);
    const double u = node.fold_winner == seat ? pot - my_delta : -my_delta;
    const int hands = universe_.size();
    for (int i = 0; i < hands; ++i) out[i] = static_cast<float>(out[i] * u);
  } else if (num_seats_ == 2) {
    const RiverEvaluator* eval = terminal_eval_[node.terminal_index];
    if (eval == nullptr) {
      // Only reachable if a showdown terminal appeared after construction.
      throw std::runtime_error("no showdown evaluator for this terminal - tree changed after build");
    }
    eval->showdown_2p(reach[1 - seat].data(), pot, my_delta, out.data());
  } else if (num_seats_ == 3) {
    const Showdown3* eval = terminal_eval3_[node.terminal_index];
    if (eval == nullptr) {
      throw std::runtime_error("no 3-way showdown evaluator for this terminal - tree changed "
                               "after build");
    }
    // The sweep is written hero-first, so the two opponents are re-indexed in
    // ascending seat order and the layer masks follow that ordering. Folded
    // seats keep their reach - they hold cards and still block - but win
    // nothing, which is what the eligibility mask says.
    int o1 = -1, o2 = -1;
    for (int t = 0; t < 3; ++t) {
      if (t == seat) continue;
      (o1 < 0 ? o1 : o2) = t;
    }
    const std::array<int, 3> order{seat, o1, o2};
    std::array<Chips, 3> commit{};
    std::uint8_t folded = 0;
    for (int t = 0; t < 3; ++t) {
      commit[static_cast<std::size_t>(t)] =
          node.commit[static_cast<std::size_t>(order[static_cast<std::size_t>(t)])];
      if (node.folded_mask & (1u << order[static_cast<std::size_t>(t)])) {
        folded |= static_cast<std::uint8_t>(1u << t);
      }
    }
    eval->showdown(reach[static_cast<std::size_t>(o1)].data(),
                   reach[static_cast<std::size_t>(o2)].data(),
                   Showdown3::layers_from_commits(commit, root_pot_, folded), my_delta,
                   out.data());
  } else {
    throw std::runtime_error(
        "no vectorized showdown past three seats: the sweep's inclusion-exclusion grows as "
        "52^(N-2). Solve this with algorithm.family \"sampled\", where opponents are pinned "
        "and the terminal is O(1) per hero hand at any seat count.");
  }
}

void NlhePostflopGame::compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                                      std::vector<float>& out) const {
  // Inclusion-exclusion over the universe. Runout blocking needs no special
  // handling: blocked combos have zero reach.
  const int hands = universe_.size();
  out.assign(static_cast<std::size_t>(hands), 0.0f);
  const std::vector<Combo>& combos = universe_.combos;

  if (num_seats_ == 2) {
    const float* opp = reach[1 - seat].data();
    double total = 0.0;
    double per_card[kNumCards] = {};
    for (int i = 0; i < hands; ++i) {
      total += opp[i];
      per_card[combos[i].hi] += opp[i];
      per_card[combos[i].lo] += opp[i];
    }
    for (int i = 0; i < hands; ++i) {
      out[i] = static_cast<float>(total - per_card[combos[i].hi] - per_card[combos[i].lo] + opp[i]);
    }
    return;
  }
  if (num_seats_ != 3) {
    throw std::runtime_error(
        "no vectorized compat weight past three seats: the disjoint-tuple mass has the same "
        "52^(N-2) inclusion-exclusion the showdown does. Use the sampled family.");
  }

  // Three seats: the mass of DISJOINT opponent PAIRS compatible with each
  // hero hand - not the product of two compat weights, which would let the
  // two opponents hold the same card. Same S(ALL,ALL) identity the 3-way
  // showdown uses, so the two agree by construction.
  int o1 = -1, o2 = -1;
  for (int t = 0; t < 3; ++t) {
    if (t == seat) continue;
    (o1 < 0 ? o1 : o2) = t;
  }
  const float* r1 = reach[static_cast<std::size_t>(o1)].data();
  const float* r2 = reach[static_cast<std::size_t>(o2)].data();

  double t1 = 0.0, t2 = 0.0, td = 0.0;
  std::array<double, kNumCards> c1{}, c2{}, cd{};
  for (int i = 0; i < hands; ++i) {
    const Combo& c = combos[static_cast<std::size_t>(i)];
    const double a = r1[i], b = r2[i], d = a * b;
    t1 += a;
    t2 += b;
    td += d;
    c1[c.hi] += a; c1[c.lo] += a;
    c2[c.hi] += b; c2[c.lo] += b;
    cd[c.hi] += d; cd[c.lo] += d;
  }
  for (int i = 0; i < hands; ++i) {
    const Combo& c = combos[static_cast<std::size_t>(i)];
    const double a1 = t1 - c1[c.hi] - c1[c.lo] + r1[i];
    const double a2 = t2 - c2[c.hi] - c2[c.lo] + r2[i];
    const double diag = td - cd[c.hi] - cd[c.lo] + static_cast<double>(r1[i]) * r2[i];
    double cross = 0.0;
    for (int card = 0; card < kNumCards; ++card) {
      if (card == c.hi || card == c.lo) continue;
      const int px = universe_.compact_index(static_cast<Card>(card), c.hi);
      const int py = universe_.compact_index(static_cast<Card>(card), c.lo);
      double x1 = 0.0, x2 = 0.0;
      if (px >= 0) { x1 += r1[px]; x2 += r2[px]; }
      if (py >= 0) { x1 += r1[py]; x2 += r2[py]; }
      cross += (c1[card] - x1) * (c2[card] - x2);
    }
    out[static_cast<std::size_t>(i)] = static_cast<float>(a1 * a2 - cross + diag);
  }
}

void NlhePostflopGame::set_leaf_values(std::array<std::vector<float>, 2> per_seat) {
  if (depth_limit_terminals_ == 0) {
    throw std::runtime_error("set_leaf_values on a tree with no depth-limit terminals");
  }
  // Sized by ALL terminals rather than only the truncated ones: terminal_index
  // is dense over every terminal in the tree, and paying a few unused rows
  // buys a direct index on the hot path instead of a second indirection.
  const std::size_t want = static_cast<std::size_t>(tree_.num_terminal_nodes) *
                           static_cast<std::size_t>(universe_.size());
  for (int s = 0; s < 2; ++s) {
    if (per_seat[static_cast<std::size_t>(s)].size() != want) {
      throw std::runtime_error("depth-limit leaf table is the wrong size for this tree");
    }
  }
  leaf_ev_ = std::move(per_seat);
}

void NlhePostflopGame::set_leaf_matrices(std::vector<std::vector<float>> per_terminal) {
  if (depth_limit_terminals_ == 0) {
    throw std::runtime_error("set_leaf_matrices on a tree with no depth-limit terminals");
  }
  if (per_terminal.size() != tree_.num_terminal_nodes) {
    throw std::runtime_error("depth-limit leaf matrices: wrong number of terminals");
  }
  const std::size_t want = static_cast<std::size_t>(universe_.size()) *
                           static_cast<std::size_t>(universe_.size());
  for (const Node& n : tree_.nodes) {
    if (n.kind != NodeKind::Terminal) continue;
    const std::vector<float>& m = per_terminal[static_cast<std::size_t>(n.terminal_index)];
    if (n.terminal_kind == TerminalKind::DepthLimit) {
      if (m.size() != want) {
        throw std::runtime_error("depth-limit leaf matrix is the wrong size for this tree");
      }
    } else if (!m.empty()) {
      throw std::runtime_error("leaf matrix supplied for a terminal that is not depth-limited");
    }
  }
  leaf_matrix_ = std::move(per_terminal);
}

std::vector<std::uint16_t> NlhePostflopGame::hand_dictionary(int) const {
  return universe_.ids;
}

}  // namespace engine
