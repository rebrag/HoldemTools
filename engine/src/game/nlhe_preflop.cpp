#include "game/nlhe_preflop.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "eval/hand_eval.hpp"
#include "game/preflop_tree.hpp"
#include "ranges/iso.hpp"
#include "ranges/range.hpp"
#include "solver/sample.hpp"
#include "util/parallel.hpp"

namespace engine {

namespace {

// The i'th board of the sample: five distinct cards, a pure function of
// (seed, i) so the sample never depends on thread order or on how the work
// was chunked. Partial Fisher-Yates over the 52-card deck, which is uniform
// over 5-card boards up to the ~2^-58 modulo bias of a 64-bit draw.
void draw_board(std::uint64_t seed, std::uint64_t index, Card* out) {
  Card deck[kNumCards];
  for (int c = 0; c < kNumCards; ++c) deck[c] = static_cast<Card>(c);
  std::uint64_t state = splitmix64(seed ^ (index * 0x9E3779B97F4A7C15ULL));
  for (int i = 0; i < 5; ++i) {
    state = splitmix64(state);
    const int span = kNumCards - i;
    const int j = i + static_cast<int>(state % static_cast<std::uint64_t>(span));
    const Card tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
    out[i] = deck[i];
  }
}

int popcount16(std::uint16_t x) {
  int n = 0;
  while (x) {
    x = static_cast<std::uint16_t>(x & (x - 1));
    ++n;
  }
  return n;
}

}  // namespace

NlhePreflopGame::NlhePreflopGame(const SolveConfig& config) {
  seats_ = static_cast<int>(config.players.size());
  if (seats_ < 2 || seats_ > kMaxSeats) {
    throw std::runtime_error("NlhePreflopGame takes 2 to " + std::to_string(kMaxSeats) +
                             " seats");
  }
  sample_ = config.preflop.board_sample;

  // No board to mask against preflop, so the universe is whatever the ranges
  // between them can hold - all 1326 combos when every range is 100%.
  std::vector<std::vector<float>> canonical(static_cast<std::size_t>(seats_));
  for (int s = 0; s < seats_; ++s) {
    canonical[static_cast<std::size_t>(s)] = parse_range(config.players[s].range);
    float total = 0.0f;
    for (float w : canonical[static_cast<std::size_t>(s)]) total += w;
    if (total <= 0.0f) {
      throw std::runtime_error("player " + config.players[s].seat + " has an empty range");
    }
  }
  universe_ = HandUniverse::from_ranges(canonical);
  const int hands = universe_.size();
  for (int h = 0; h < hands; ++h) {
    blocking_[universe_.combos[static_cast<std::size_t>(h)].hi].push_back(
        static_cast<std::uint16_t>(h));
    blocking_[universe_.combos[static_cast<std::size_t>(h)].lo].push_back(
        static_cast<std::uint16_t>(h));
  }
  ranges_.resize(static_cast<std::size_t>(seats_));
  for (int s = 0; s < seats_; ++s) {
    ranges_[static_cast<std::size_t>(s)] = universe_.compact(canonical[static_cast<std::size_t>(s)]);
  }

  PreflopTreeParams params;
  params.num_seats = seats_;
  params.small_blind = config.preflop.small_blind;
  params.big_blind = config.preflop.big_blind;
  params.button = config.preflop.button;
  params.dead = config.preflop.dead;
  for (int s = 0; s < seats_; ++s) {
    params.stack[static_cast<std::size_t>(s)] = config.players[s].stack;
    params.ante[static_cast<std::size_t>(s)] =
        s < static_cast<int>(config.preflop.ante.size()) ? config.preflop.ante[s] : 0;
  }
  tree_ = build_preflop_tree(params);

  // Profile normalizer under the hero-only removal rule, from seat 0's view:
  // the mass of opponent profiles compatible with each of its hands. It is
  // the same quantity compat_weights returns, summed against seat 0's range,
  // so the two cannot drift apart.
  //
  // With 3+ seats this number is not seat-symmetric - seat 0's measure admits
  // opponent profiles in which seats 1 and 2 collide, and seat 1's admits a
  // different set. best_response divides every seat's sum by this one Z, so
  // root EVs sum to the pot only up to that difference. Measured rather than
  // assumed: tests/test_preflop_game.cpp reports it.
  {
    std::vector<std::vector<float>> root(static_cast<std::size_t>(seats_));
    for (int s = 0; s < seats_; ++s) root[static_cast<std::size_t>(s)] = ranges_[static_cast<std::size_t>(s)];
    std::vector<float> compat;
    compat_weights(0, root, compat);
    double z = 0.0;
    for (int h = 0; h < hands; ++h) {
      z += static_cast<double>(ranges_[0][static_cast<std::size_t>(h)]) *
           static_cast<double>(compat[static_cast<std::size_t>(h)]);
    }
    profile_weight_ = z;
  }
  if (profile_weight_ <= 0.0) {
    throw std::runtime_error("the configured ranges admit no card-disjoint hand profile");
  }

  // Terminal plans: the side-pot layers are a function of the node's public
  // commit levels alone, so they are resolved once here rather than per visit.
  terminal_plan_.assign(static_cast<std::size_t>(tree_.num_terminal_nodes), TerminalPlan{});
  int widest = 0;
  for (const Node& n : tree_.nodes) {
    if (n.kind != NodeKind::Terminal) continue;
    TerminalPlan plan;
    plan.pot = static_cast<double>(n.pot);
    for (int s = 0; s < seats_; ++s) {
      plan.commit[static_cast<std::size_t>(s)] = static_cast<double>(n.commit[s]);
      if ((n.folded_mask & (1u << s)) == 0) {
        plan.alive_mask = static_cast<std::uint16_t>(plan.alive_mask | (1u << s));
      }
    }
    if (n.terminal_kind == TerminalKind::Fold) {
      plan.fold_winner = n.fold_winner;
    } else {
      plan.showdown = true;
      widest = std::max(widest, popcount16(plan.alive_mask));
      // Layers from the distinct commit levels of the alive seats. Folded
      // seats put no layer boundary in, but their chips fill every layer they
      // reach - dead money in exactly the layers they paid for.
      std::vector<Chips> levels;
      for (int s = 0; s < seats_; ++s) {
        if ((plan.alive_mask & (1u << s)) != 0) levels.push_back(n.commit[s]);
      }
      std::sort(levels.begin(), levels.end());
      levels.erase(std::unique(levels.begin(), levels.end()), levels.end());
      Chips prev = 0;
      bool first = true;
      for (Chips level : levels) {
        Layer layer;
        layer.amount = first ? static_cast<double>(n.pot) : 0.0;
        if (first) {
          // The first layer starts from the dead money, so take the whole pot
          // and remove everything that belongs to higher layers.
          layer.amount = 0.0;
          Chips dead = n.pot;
          for (int s = 0; s < seats_; ++s) dead -= n.commit[s];
          layer.amount = static_cast<double>(dead);
        }
        first = false;
        for (int s = 0; s < seats_; ++s) {
          const Chips lo = std::min<Chips>(n.commit[s], prev);
          const Chips hi = std::min<Chips>(n.commit[s], level);
          if (hi > lo) layer.amount += static_cast<double>(hi - lo);
        }
        for (int s = 0; s < seats_; ++s) {
          if ((plan.alive_mask & (1u << s)) != 0 && n.commit[s] >= level) {
            layer.eligible = static_cast<std::uint16_t>(layer.eligible | (1u << s));
          }
        }
        prev = level;
        plan.layers.push_back(layer);
      }
    }
    terminal_plan_[static_cast<std::size_t>(n.terminal_index)] = std::move(plan);
  }
  if (widest > kMaxShowdownSeats) {
    throw std::runtime_error(
        "this pass caps a showdown at " + std::to_string(kMaxShowdownSeats) +
        " seats: the tie handling is a subset expansion over the eligible opponents, so it "
        "doubles per extra seat. Reduce the player count.");
  }

  const int threads = resolve_thread_count(config.threads);
  build_pair_equity(threads);
  // Only a 3+ way showdown needs the per-iteration board sample; a heads-up
  // tree answers entirely out of e2_, so do not pay for boards nothing reads.
  if (widest >= 3) build_boards(threads);
}

void NlhePreflopGame::build_boards(int threads) {
  const int hands = universe_.size();
  boards_.assign(static_cast<std::size_t>(sample_.iter_count), BoardTable{});
  ThreadPool pool(threads);
  // One slot per board, written by exactly one worker: the tables are
  // immutable for the rest of the solve, which is what lets the multithreaded
  // traversal read them without a lock.
  pool.parallel_for(sample_.iter_count, [&](int b) {
    Card board[5];
    draw_board(sample_.seed, static_cast<std::uint64_t>(b), board);
    std::uint64_t board_mask = 0;
    for (int i = 0; i < 5; ++i) board_mask |= (1ULL << board[i]);

    BoardTable& table = boards_[static_cast<std::size_t>(b)];
    for (int i = 0; i < 5; ++i) table.board[static_cast<std::size_t>(i)] = board[i];
    table.strength.assign(static_cast<std::size_t>(hands), 0);
    table.valid.assign(static_cast<std::size_t>(hands), 0);
    Card cards[7];
    for (int i = 0; i < 5; ++i) cards[i] = board[i];
    for (int h = 0; h < hands; ++h) {
      if (universe_.masks[static_cast<std::size_t>(h)] & board_mask) continue;
      table.valid[static_cast<std::size_t>(h)] = 1;
      cards[5] = universe_.combos[static_cast<std::size_t>(h)].hi;
      cards[6] = universe_.combos[static_cast<std::size_t>(h)].lo;
      table.strength[static_cast<std::size_t>(h)] = evaluate7(cards, 7);
      table.sorted.push_back(h);
    }
    std::sort(table.sorted.begin(), table.sorted.end(), [&table](std::int32_t a, std::int32_t b2) {
      return table.strength[static_cast<std::size_t>(a)] <
             table.strength[static_cast<std::size_t>(b2)];
    });
    for (std::size_t begin = 0; begin < table.sorted.size();) {
      std::size_t end = begin + 1;
      while (end < table.sorted.size() &&
             table.strength[static_cast<std::size_t>(table.sorted[end])] ==
                 table.strength[static_cast<std::size_t>(table.sorted[begin])]) {
        ++end;
      }
      table.groups.emplace_back(static_cast<int>(begin), static_cast<int>(end));
      begin = end;
    }
  });
}

void NlhePreflopGame::build_pair_equity(int threads) {
  const int hands = universe_.size();
  const std::size_t cells = static_cast<std::size_t>(hands) * static_cast<std::size_t>(hands);
  e2_.assign(cells, 0.0f);
  // The realized denominator per pair. Sampling noise on it is the same order
  // as the noise on the numerator, so it is worth the transient 4 bytes a
  // cell rather than dividing by the expected C(48,5)/C(52,5) count.
  std::vector<std::uint32_t> seen(cells, 0);

  // Rows are owned by hero, so a worker writes only its own slice of e2_ and
  // seen, and each row accumulates boards in ascending sample order. No
  // per-thread duplication of a 7 MB accumulator, and the result does not
  // depend on the thread count.
  //
  // Boards are processed in batches so the per-board strength tables stay
  // small and cache-resident; kBatch * hands u32 is ~1.4 MB at 1326 hands.
  constexpr int kBatch = 256;
  ThreadPool pool(threads);
  std::vector<std::uint32_t> strength(static_cast<std::size_t>(kBatch) *
                                      static_cast<std::size_t>(hands));
  std::vector<std::uint8_t> live(static_cast<std::size_t>(kBatch) *
                                 static_cast<std::size_t>(hands));

  for (int base = 0; base < sample_.pair_count; base += kBatch) {
    const int count = std::min(kBatch, sample_.pair_count - base);
    pool.parallel_for(count, [&](int i) {
      Card board[5];
      draw_board(sample_.seed ^ 0xA5A5A5A5A5A5A5A5ULL,
                 static_cast<std::uint64_t>(base + i), board);
      std::uint64_t board_mask = 0;
      for (int k = 0; k < 5; ++k) board_mask |= (1ULL << board[k]);
      std::uint32_t* str = strength.data() + static_cast<std::size_t>(i) * hands;
      std::uint8_t* ok = live.data() + static_cast<std::size_t>(i) * hands;
      Card cards[7];
      for (int k = 0; k < 5; ++k) cards[k] = board[k];
      for (int h = 0; h < hands; ++h) {
        if (universe_.masks[static_cast<std::size_t>(h)] & board_mask) {
          ok[h] = 0;
          str[h] = 0;
          continue;
        }
        ok[h] = 1;
        cards[5] = universe_.combos[static_cast<std::size_t>(h)].hi;
        cards[6] = universe_.combos[static_cast<std::size_t>(h)].lo;
        str[h] = evaluate7(cards, 7);
      }
    });

    pool.parallel_for(hands, [&](int h) {
      const std::uint64_t hero_mask = universe_.masks[static_cast<std::size_t>(h)];
      float* row = e2_.data() + static_cast<std::size_t>(h) * hands;
      std::uint32_t* row_seen = seen.data() + static_cast<std::size_t>(h) * hands;
      for (int i = 0; i < count; ++i) {
        const std::uint32_t* str = strength.data() + static_cast<std::size_t>(i) * hands;
        const std::uint8_t* ok = live.data() + static_cast<std::size_t>(i) * hands;
        if (!ok[h]) continue;
        const std::uint32_t mine = str[h];
        for (int o = 0; o < hands; ++o) {
          if (!ok[o]) continue;
          if (universe_.masks[static_cast<std::size_t>(o)] & hero_mask) continue;
          ++row_seen[o];
          if (str[o] < mine) row[o] += 1.0f;
          else if (str[o] == mine) row[o] += 0.5f;
        }
      }
    });
  }

  for (std::size_t c = 0; c < cells; ++c) {
    e2_[c] = seen[c] != 0 ? e2_[c] / static_cast<float>(seen[c]) : 0.0f;
  }

  // Project onto the suit-symmetric subspace, which is where the answer
  // provably lives: the all-in equity of a pair of hands depends only on the
  // two hands and the (suit-invariant) board distribution, so E2 must satisfy
  // E2[h][o] == E2[pi(h)][pi(o)] for every suit permutation pi. It does NOT
  // depend on the ranges, so this holds whatever they are.
  //
  // The estimator does not satisfy it, because a finite board sample is not
  // suit-symmetric. Averaging the 24 images therefore removes error and adds
  // no bias - and the 24 errors are close to independent (the image of a pair
  // is estimated from the suit-permuted board set), so it is worth about a
  // sqrt(24) ~ 4.9x reduction for one cheap pass.
  //
  // It matters more than it sounds. Without it the four combos of J3s came
  // out with jam EVs spread over 0.11 chips at pair_count 20000 - larger than
  // the entire jam/fold margin of a threshold hand, and visible in the chart
  // as suits disagreeing about a hand class.
  {
    std::vector<std::uint16_t> ident(static_cast<std::size_t>(hands));
    for (int h = 0; h < hands; ++h) ident[static_cast<std::size_t>(h)] = static_cast<std::uint16_t>(h);
    std::vector<std::vector<std::uint16_t>> maps;
    maps.push_back(ident);
    for (const SuitPerm& perm : all_suit_perms()) {
      // perm_hand_map needs the universe closed under the permutation, and
      // signals a combo it could not place with an out-of-range index rather
      // than by throwing. A universe from suit-symmetric ranges is always
      // closed; one from an explicit-combo range ("AdQd") may not be, and
      // then that permutation is skipped rather than relabeling wrongly.
      std::vector<std::uint16_t> map = perm_hand_map(perm, universe_);
      bool closed = map.size() == static_cast<std::size_t>(hands);
      for (std::uint16_t j : map) {
        if (j >= static_cast<std::uint16_t>(hands)) {
          closed = false;
          break;
        }
      }
      if (closed) maps.push_back(std::move(map));
    }
    std::vector<float> sym(cells, 0.0f);
    for (const std::vector<std::uint16_t>& map : maps) {
      for (int h = 0; h < hands; ++h) {
        const float* src = e2_.data() + static_cast<std::size_t>(map[static_cast<std::size_t>(h)]) * hands;
        float* dst = sym.data() + static_cast<std::size_t>(h) * hands;
        for (int o = 0; o < hands; ++o) dst[o] += src[map[static_cast<std::size_t>(o)]];
      }
    }
    const float inv = 1.0f / static_cast<float>(maps.size());
    for (std::size_t c = 0; c < cells; ++c) e2_[c] = sym[c] * inv;
  }
}

void NlhePreflopGame::board_compat(const BoardTable& board, const float* opp_reach,
                                   float* out) const {
  // One seat's compatible mass per hero hand ON THIS BOARD: the same
  // inclusion-exclusion as multiply_compat, restricted to the hands the board
  // has not already used up.
  //
  // Every seat at the table gets one of these, not just the ones contesting
  // the layer. A seat that cannot win a side pot still holds two cards, so it
  // still decides which runouts were possible - leaving it out conditions the
  // layer on a different board distribution than the deal actually allows,
  // and that was measured at 4-5% of the layer's value on a small universe.
  const std::vector<Combo>& combos = universe_.combos;
  for (int h = 0; h < universe_.size(); ++h) out[h] = 0.0f;
  double all = 0.0;
  double per_card[kNumCards] = {};
  for (std::int32_t i : board.sorted) {
    const double r = opp_reach[i];
    all += r;
    per_card[combos[static_cast<std::size_t>(i)].hi] += r;
    per_card[combos[static_cast<std::size_t>(i)].lo] += r;
  }
  for (std::int32_t i : board.sorted) {
    const Card hi = combos[static_cast<std::size_t>(i)].hi;
    const Card lo = combos[static_cast<std::size_t>(i)].lo;
    out[i] = static_cast<float>(all - per_card[hi] - per_card[lo] + opp_reach[i]);
  }
}

void NlhePreflopGame::worse_and_tie(const BoardTable& board, const float* opp_reach, float* worse,
                                    float* tie, float* total) const {
  const int hands = universe_.size();
  const std::vector<Combo>& combos = universe_.combos;
  for (int h = 0; h < hands; ++h) {
    worse[h] = 0.0f;
    tie[h] = 0.0f;
    total[h] = 0.0f;
  }
  board_compat(board, opp_reach, total);
  // Ascending sweep, the same shape as RiverEvaluator::showdown_2p, with the
  // two halves emitted separately because the multiway combine multiplies
  // them per opponent instead of adding them.
  double worse_total = 0.0;
  double worse_per_card[kNumCards] = {};
  for (const auto& [begin, end] : board.groups) {
    double group_total = 0.0;
    double group_per_card[kNumCards] = {};
    for (int s = begin; s < end; ++s) {
      const int i = board.sorted[static_cast<std::size_t>(s)];
      const double r = opp_reach[i];
      group_total += r;
      group_per_card[combos[static_cast<std::size_t>(i)].hi] += r;
      group_per_card[combos[static_cast<std::size_t>(i)].lo] += r;
    }
    for (int s = begin; s < end; ++s) {
      const int i = board.sorted[static_cast<std::size_t>(s)];
      const Card hi = combos[static_cast<std::size_t>(i)].hi;
      const Card lo = combos[static_cast<std::size_t>(i)].lo;
      // Strictly worse: hero's own combo is never in the worse set, so the
      // pairwise inclusion-exclusion term is zero. Ties: hero's combo is in
      // this group and blocked, and the +reach term cancels its double
      // subtraction so it nets out excluded.
      worse[i] = static_cast<float>(worse_total - worse_per_card[hi] - worse_per_card[lo]);
      tie[i] = static_cast<float>(group_total - group_per_card[hi] - group_per_card[lo] +
                                  opp_reach[i]);
    }
    worse_total += group_total;
    for (int s = begin; s < end; ++s) {
      const int i = board.sorted[static_cast<std::size_t>(s)];
      worse_per_card[combos[static_cast<std::size_t>(i)].hi] += opp_reach[i];
      worse_per_card[combos[static_cast<std::size_t>(i)].lo] += opp_reach[i];
    }
  }
}

void NlhePreflopGame::multiply_compat(const float* opp_reach, float* inout) const {
  // One opponent's compatible mass per hero hand, folded into a running
  // product: total minus the two per-card sums, plus the identical combo back
  // (it was subtracted twice). Exact hero-vs-opponent card removal.
  //
  // The single copy of this arithmetic on purpose: compat_weights, the
  // profile normalizer and the per-layer denominators must all use the same
  // removal rule, or the conditional EVs the artifact exports are scaled by a
  // different measure than the values they came from.
  const int hands = universe_.size();
  const std::vector<Combo>& combos = universe_.combos;
  double total = 0.0;
  double per_card[kNumCards] = {};
  for (int i = 0; i < hands; ++i) {
    total += opp_reach[i];
    per_card[combos[static_cast<std::size_t>(i)].hi] += opp_reach[i];
    per_card[combos[static_cast<std::size_t>(i)].lo] += opp_reach[i];
  }
  for (int i = 0; i < hands; ++i) {
    const double c = total - per_card[combos[static_cast<std::size_t>(i)].hi] -
                     per_card[combos[static_cast<std::size_t>(i)].lo] + opp_reach[i];
    inout[i] = static_cast<float>(static_cast<double>(inout[i]) * c);
  }
}

void NlhePreflopGame::compat_weights(int seat, const std::vector<std::vector<float>>& reach,
                                     std::vector<float>& out) const {
  const int hands = universe_.size();
  const std::vector<Combo>& combos = universe_.combos;
  out.assign(static_cast<std::size_t>(hands), 1.0f);

  std::vector<int> others;
  for (int s = 0; s < seats_; ++s) {
    if (s != seat) others.push_back(s);
  }
  const std::size_t m = others.size();

  // Per opponent: total mass and the mass sitting on each card. Both
  // unrestricted here; hero's own two cards come out per hand below.
  std::vector<double> total(m, 0.0);
  std::vector<std::array<double, kNumCards>> per_card(m);
  for (std::size_t k = 0; k < m; ++k) {
    per_card[k].fill(0.0);
    const float* r = reach[static_cast<std::size_t>(others[k])].data();
    for (int i = 0; i < hands; ++i) {
      total[k] += r[i];
      per_card[k][combos[static_cast<std::size_t>(i)].hi] += r[i];
      per_card[k][combos[static_cast<std::size_t>(i)].lo] += r[i];
    }
  }

  std::vector<double> factor(m, 0.0);
  for (int i = 0; i < hands; ++i) {
    const Card hi = combos[static_cast<std::size_t>(i)].hi;
    const Card lo = combos[static_cast<std::size_t>(i)].lo;
    double product = 1.0;
    for (std::size_t k = 0; k < m; ++k) {
      const float* r = reach[static_cast<std::size_t>(others[k])].data();
      product *= total[k] - per_card[k][hi] - per_card[k][lo] + r[i];
    }
    out[static_cast<std::size_t>(i)] = static_cast<float>(product);
  }
  if (m < 2) return;

  // ---- Bunching: opponents cannot hold each other's cards either --------
  //
  // The product above counts profiles in which two opponents hold the same
  // card, which the deck does not allow. Removing them is an
  // inclusion-exclusion over the collision events; this takes its FIRST-ORDER
  // term, correcting every pair and leaving triple-and-higher coincidences
  // in. One pair collides about 8% of the time, so what is dropped is second
  // order (~0.7%) against a first-order term measured at 3.4 bb/100 on the
  // 4-way 10bb spot.
  //
  // For one pair (a, b) restricted to hands disjoint from hero hand h:
  //
  //   collide(h) = sum_c Ca(c|h) * Cb(c|h)  -  sum_o ra(o) rb(o) [o vs h]
  //
  // The first sum counts a colliding pair once per SHARED card, so a pair
  // sharing both cards - the same combo - is counted twice, and the second
  // sum puts one copy back.
  //
  // This is affordable precisely because the profile MASS carries no board
  // and no strength conditioning: Ca(c|h) is the unrestricted per-card mass
  // minus the two specific combos {c,hi} and {c,lo}. The same correction
  // inside the showdown sweep would have to be recomputed at every strength
  // threshold on every sampled board, which is orders of magnitude dearer -
  // see docs/roadmap.md M8a.
  std::vector<std::pair<std::size_t, std::size_t>> pairs;
  for (std::size_t a = 0; a < m; ++a) {
    for (std::size_t b = a + 1; b < m; ++b) pairs.emplace_back(a, b);
  }
  std::vector<double> pair_total(pairs.size(), 0.0);
  std::vector<std::array<double, kNumCards>> pair_card(pairs.size());
  for (std::size_t p = 0; p < pairs.size(); ++p) {
    pair_card[p].fill(0.0);
    const float* ra = reach[static_cast<std::size_t>(others[pairs[p].first])].data();
    const float* rb = reach[static_cast<std::size_t>(others[pairs[p].second])].data();
    for (int i = 0; i < hands; ++i) {
      const double v = static_cast<double>(ra[i]) * static_cast<double>(rb[i]);
      if (v == 0.0) continue;
      pair_total[p] += v;
      pair_card[p][combos[static_cast<std::size_t>(i)].hi] += v;
      pair_card[p][combos[static_cast<std::size_t>(i)].lo] += v;
    }
  }

  // Universe index of the combo {c, x}, or -1 when it is outside the
  // universe. Built once: the loop below asks for it 52 times per hand per
  // pair, and combo_index + a binary search each time would dominate.
  std::vector<std::int32_t> combo_at(static_cast<std::size_t>(kNumCards) * kNumCards, -1);
  for (int i = 0; i < hands; ++i) {
    const std::size_t hi = static_cast<std::size_t>(combos[static_cast<std::size_t>(i)].hi);
    const std::size_t lo = static_cast<std::size_t>(combos[static_cast<std::size_t>(i)].lo);
    combo_at[hi * kNumCards + lo] = i;
    combo_at[lo * kNumCards + hi] = i;
  }

  for (int i = 0; i < hands; ++i) {
    const Card hi = combos[static_cast<std::size_t>(i)].hi;
    const Card lo = combos[static_cast<std::size_t>(i)].lo;
    for (std::size_t k = 0; k < m; ++k) {
      const float* r = reach[static_cast<std::size_t>(others[k])].data();
      factor[k] = total[k] - per_card[k][hi] - per_card[k][lo] + r[i];
    }
    double correction = 0.0;
    for (std::size_t p = 0; p < pairs.size(); ++p) {
      const std::size_t ka = pairs[p].first;
      const std::size_t kb = pairs[p].second;
      const float* ra = reach[static_cast<std::size_t>(others[ka])].data();
      const float* rb = reach[static_cast<std::size_t>(others[kb])].data();
      double shared = 0.0;
      for (int c = 0; c < kNumCards; ++c) {
        if (c == hi || c == lo) continue;  // hero holds it; no opponent can
        const std::int32_t with_hi =
            combo_at[static_cast<std::size_t>(c) * kNumCards + static_cast<std::size_t>(hi)];
        const std::int32_t with_lo =
            combo_at[static_cast<std::size_t>(c) * kNumCards + static_cast<std::size_t>(lo)];
        const double ca = per_card[ka][c] - (with_hi >= 0 ? ra[with_hi] : 0.0) -
                          (with_lo >= 0 ? ra[with_lo] : 0.0);
        const double cb = per_card[kb][c] - (with_hi >= 0 ? rb[with_hi] : 0.0) -
                          (with_lo >= 0 ? rb[with_lo] : 0.0);
        shared += ca * cb;
      }
      const double same = pair_total[p] - pair_card[p][hi] - pair_card[p][lo] +
                          static_cast<double>(ra[i]) * static_cast<double>(rb[i]);
      double term = shared - same;
      for (std::size_t k = 0; k < m; ++k) {
        if (k != ka && k != kb) term *= factor[k];
      }
      correction += term;
    }
    // Clamped rather than asserted: a first-order inclusion-exclusion can in
    // principle overshoot when collisions are dense, and a negative profile
    // mass would poison every conditional EV divided by it. At realistic
    // collision rates it does not happen, so this is a guard, not a
    // mechanism.
    const double corrected = static_cast<double>(out[static_cast<std::size_t>(i)]) - correction;
    out[static_cast<std::size_t>(i)] = static_cast<float>(corrected > 0.0 ? corrected : 0.0);
  }
}

void NlhePreflopGame::terminal_values(NodeId id, int seat,
                                      const std::vector<std::vector<float>>& reach,
                                      std::vector<float>& out) const {
  const Node& node = tree_[id];
  const TerminalPlan& plan = terminal_plan_[static_cast<std::size_t>(node.terminal_index)];
  const int hands = universe_.size();
  const double my_commit = plan.commit[static_cast<std::size_t>(seat)];

  // compat[h] is the mass of opponent profiles compatible with hero's hand h.
  // Every branch below is linear in it: the commitment is paid on every
  // profile, and a seat that cannot win a layer contributes its whole
  // compatible mass to that layer's other factors.
  std::vector<float> compat;
  compat_weights(seat, reach, compat);

  const bool hero_alive = (plan.alive_mask & (1u << seat)) != 0;
  if (!plan.showdown || !hero_alive) {
    const double u = (!plan.showdown && plan.fold_winner == seat) ? plan.pot - my_commit
                                                                 : -my_commit;
    out.assign(static_cast<std::size_t>(hands), 0.0f);
    for (int h = 0; h < hands; ++h) {
      out[static_cast<std::size_t>(h)] = static_cast<float>(compat[static_cast<std::size_t>(h)] * u);
    }
    return;
  }

  out.assign(static_cast<std::size_t>(hands), 0.0f);
  for (int h = 0; h < hands; ++h) {
    out[static_cast<std::size_t>(h)] =
        static_cast<float>(-my_commit * compat[static_cast<std::size_t>(h)]);
  }

  // Every layer contributes `amount * P(hero takes it) * compat[h]`. Keeping
  // the middle factor a pure FRACTION is what makes the two estimators
  // interchangeable and what keeps the win side on the same measure as the
  // commitment term above - the bug this shape replaced averaged the win side
  // over every sampled board (counting hero-blocked ones as zero) while the
  // commitment used the unrestricted opponent mass, quietly shrinking every
  // jam by the ~34% of boards that conflict with four known cards.
  std::vector<float> frac(static_cast<std::size_t>(hands), 0.0f);
  std::vector<float> denom(static_cast<std::size_t>(hands), 0.0f);
  for (const Layer& layer : plan.layers) {
    if (layer.amount <= 0.0) continue;
    if ((layer.eligible & (1u << seat)) == 0) continue;

    std::vector<int> opponents;
    std::vector<int> bystanders;
    for (int s = 0; s < seats_; ++s) {
      if (s == seat) continue;
      if ((layer.eligible & (1u << s)) != 0) opponents.push_back(s);
      else bystanders.push_back(s);
    }
    if (opponents.empty()) {
      // Nobody contests this layer - it is an uncalled bet coming back.
      for (int h = 0; h < hands; ++h) {
        out[static_cast<std::size_t>(h)] += static_cast<float>(
            layer.amount * static_cast<double>(compat[static_cast<std::size_t>(h)]));
      }
      continue;
    }

    const std::size_t m = opponents.size();
    std::fill(frac.begin(), frac.end(), 0.0f);

    if (m == 1) {
      // Heads-up in this layer: the board expectation commutes with the sum
      // over opponent hands, so the pairwise matrix answers it exactly and no
      // per-iteration board loop happens at all.
      const float* opp = reach[static_cast<std::size_t>(opponents[0])].data();
      std::fill(denom.begin(), denom.end(), 1.0f);
      multiply_compat(opp, denom.data());
      for (int h = 0; h < hands; ++h) {
        const float* row = e2_.data() + static_cast<std::size_t>(h) * hands;
        double acc = 0.0;
        for (int o = 0; o < hands; ++o) acc += static_cast<double>(row[o]) * opp[o];
        const double d = denom[static_cast<std::size_t>(h)];
        frac[static_cast<std::size_t>(h)] = d > 0.0 ? static_cast<float>(acc / d) : 0.0f;
      }
    } else {
      // Three or more: the value is a PRODUCT over opponents inside the board
      // expectation, which does not factorize, so it is averaged over the
      // fixed board sample. Numerator and denominator are accumulated over
      // the SAME boards, so hero hands that more boards block do not come out
      // systematically cheaper - the ratio is conditioned on hero being live.
      if (boards_.empty()) throw std::runtime_error("multiway showdown with no board sample");
      std::vector<double> num(static_cast<std::size_t>(hands), 0.0);
      std::vector<double> den(static_cast<std::size_t>(hands), 0.0);
      std::vector<float> worse(m * static_cast<std::size_t>(hands));
      std::vector<float> tie(m * static_cast<std::size_t>(hands));
      std::vector<float> total(m * static_cast<std::size_t>(hands));
      std::vector<float> bystander(static_cast<std::size_t>(hands));
      std::vector<float> scratch(static_cast<std::size_t>(hands));
      const std::size_t subsets = std::size_t{1} << m;
      for (const BoardTable& board : boards_) {
        for (std::size_t k = 0; k < m; ++k) {
          worse_and_tie(board, reach[static_cast<std::size_t>(opponents[k])].data(),
                        worse.data() + k * hands, tie.data() + k * hands,
                        total.data() + k * hands);
        }
        // Seats that cannot win this layer still block runouts, so they
        // weight the board, they just do not enter the win condition. Their
        // factor cancels out of num/den only if it is applied to BOTH, which
        // is exactly why it is per-board rather than folded in afterwards.
        std::fill(bystander.begin(), bystander.end(), 1.0f);
        for (int s : bystanders) {
          board_compat(board, reach[static_cast<std::size_t>(s)].data(), scratch.data());
          for (int h = 0; h < hands; ++h) bystander[static_cast<std::size_t>(h)] *= scratch[static_cast<std::size_t>(h)];
        }
        for (int h = 0; h < hands; ++h) {
          if (!board.valid[static_cast<std::size_t>(h)]) continue;
          const double bys = bystander[static_cast<std::size_t>(h)];
          if (bys == 0.0) continue;
          // Sum over WHICH opponents tie hero: hero takes 1/(1+|A|) of the
          // layer when exactly set A ties and the rest are worse. Exact tie
          // handling, 2^(k-1) terms.
          double acc = 0.0;
          for (std::size_t a = 0; a < subsets; ++a) {
            double term = 1.0;
            int ties = 0;
            for (std::size_t k = 0; k < m; ++k) {
              const float* src = ((a >> k) & 1u) ? tie.data() : worse.data();
              term *= static_cast<double>(src[k * hands + static_cast<std::size_t>(h)]);
              if ((a >> k) & 1u) ++ties;
              if (term == 0.0) break;
            }
            if (term != 0.0) acc += term / static_cast<double>(ties + 1);
          }
          double mass = 1.0;
          for (std::size_t k = 0; k < m; ++k) {
            mass *= static_cast<double>(total[k * hands + static_cast<std::size_t>(h)]);
          }
          num[static_cast<std::size_t>(h)] += acc * bys;
          den[static_cast<std::size_t>(h)] += mass * bys;
        }
      }
      for (int h = 0; h < hands; ++h) {
        const double d = den[static_cast<std::size_t>(h)];
        frac[static_cast<std::size_t>(h)] =
            d > 0.0 ? static_cast<float>(num[static_cast<std::size_t>(h)] / d) : 0.0f;
      }
    }

    for (int h = 0; h < hands; ++h) {
      out[static_cast<std::size_t>(h)] += static_cast<float>(
          layer.amount * static_cast<double>(frac[static_cast<std::size_t>(h)]) *
          static_cast<double>(compat[static_cast<std::size_t>(h)]));
    }
  }
}

std::size_t NlhePreflopGame::auxiliary_bytes() const {
  // What SURVIVES construction. The pair sample's per-board strength tables
  // are consumed into e2_ and freed, so counting them here would describe a
  // transient the estimator is not being asked about.
  std::size_t bytes = e2_.size() * sizeof(float);
  for (const BoardTable& b : boards_) {
    bytes += b.strength.size() * sizeof(std::uint32_t) + b.valid.size() * sizeof(std::uint8_t) +
             b.sorted.size() * sizeof(std::int32_t) +
             b.groups.size() * sizeof(std::pair<int, int>);
  }
  for (const TerminalPlan& p : terminal_plan_) {
    bytes += p.layers.size() * sizeof(Layer) + sizeof(TerminalPlan);
  }
  return bytes;
}

}  // namespace engine
