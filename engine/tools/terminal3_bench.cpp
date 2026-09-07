// Does the showdown sweep generalize to three seats at O(H), or is exact
// multiway terminal evaluation stuck at O(H^2) per hero hand?
//
// This is the measurement that decides whether exact multiway POSTFLOP is
// reachable on the vectorized core (M8b). The 2-player sweep is O(H) for
// every hero hand against the whole opponent range, which is what makes exact
// heads-up postflop affordable; if three seats cost O(H^2) per hand instead,
// multiway has to come from depth-limiting plus a value function rather than
// from an exact terminal.
//
// Reports three things:
//   1. scaling      - time per hero hand against H. Flat means O(H).
//   2. constant     - the 3-way sweep against the 2-player one at equal H.
//   3. vs reference - against the O(H^2)-per-hand showdown_share walk.
//
// Correctness is gated separately, in tests/test_terminal3.cpp.

#include <chrono>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <random>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "eval/terminal.hpp"
#include "eval/terminal3.hpp"

using namespace engine;

namespace {

std::vector<Combo> strided_universe(int stride) {
  std::vector<Combo> out;
  const std::vector<Combo>& all = canonical_combos();
  for (std::size_t i = 0; i < all.size(); i += static_cast<std::size_t>(stride)) {
    out.push_back(all[i]);
  }
  return out;
}

std::vector<float> random_reach(std::size_t n, std::uint64_t seed) {
  std::mt19937_64 rng(seed);
  std::uniform_real_distribution<double> u(0.05, 1.0);
  std::vector<float> r(n);
  for (std::size_t i = 0; i < n; ++i) r[i] = static_cast<float>(u(rng));
  return r;
}

template <typename F>
double time_calls(int reps, const F& f) {
  const auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < reps; ++i) f();
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() /
         static_cast<double>(reps);
}

}  // namespace

int main() {
  const std::vector<Card> board = parse_cards("Qs Jh 2h 8d 6c");
  double sink = 0.0;

  std::cout << "3-way showdown sweep, board Qs Jh 2h 8d 6c\n\n"
            << "     H   3-way (us)   ns/hand   2-way (us)   ns/hand   ratio\n";

  for (int stride : {12, 6, 3, 2, 1}) {
    const std::vector<Combo> universe = strided_universe(stride);
    const Showdown3 sd3(board, universe);
    const RiverEvaluator sd2(board, universe);
    const std::size_t n = universe.size();
    const std::vector<float> r1 = random_reach(n, 1);
    const std::vector<float> r2 = random_reach(n, 2);
    std::vector<float> out(n);

    // Only hands not blocked by the board do any work, and that is the H the
    // complexity is in.
    std::size_t live = 0;
    for (std::size_t i = 0; i < n; ++i) {
      if (sd3.valid(static_cast<int>(i))) ++live;
    }

    const int reps = n > 800 ? 20 : 200;
    const double t3 = time_calls(reps, [&] {
      sd3.showdown(r1.data(), r2.data(), 300.0, 40.0, out.data());
      sink += out[0];
    });
    const double t2 = time_calls(reps * 20, [&] {
      sd2.showdown_2p(r1.data(), 300.0, 40.0, out.data());
      sink += out[0];
    });

    std::cout << std::setw(6) << live << std::setw(13) << std::fixed << std::setprecision(1)
              << (t3 * 1e6) << std::setw(10) << std::setprecision(1)
              << (t3 * 1e9 / static_cast<double>(live)) << std::setw(13) << std::setprecision(2)
              << (t2 * 1e6) << std::setw(10) << std::setprecision(2)
              << (t2 * 1e9 / static_cast<double>(live)) << std::setw(8) << std::setprecision(1)
              << (t3 / t2) << "x\n";
  }

  // Against the reference, on a universe small enough for it to finish.
  {
    const std::vector<Combo> universe = strided_universe(17);
    const Showdown3 sd3(board, universe);
    const std::size_t n = universe.size();
    const std::vector<float> r1 = random_reach(n, 1);
    const std::vector<float> r2 = random_reach(n, 2);
    std::vector<float> out(n);
    std::size_t live = 0;
    for (std::size_t i = 0; i < n; ++i) {
      if (sd3.valid(static_cast<int>(i))) ++live;
    }
    const double fast = time_calls(200, [&] {
      sd3.showdown(r1.data(), r2.data(), 300.0, 40.0, out.data());
      sink += out[0];
    });
    const double slow = time_calls(1, [&] {
      sd3.showdown_slow(r1.data(), r2.data(), 300.0, 40.0, out.data());
      sink += out[0];
    });
    std::cout << "\nagainst the O(H^2)-per-hand reference at H = " << live << ":\n"
              << "  sweep     " << std::setprecision(1) << (fast * 1e6) << " us\n"
              << "  reference " << (slow * 1e6) << " us  (" << std::setprecision(0)
              << (slow / fast) << "x slower)\n"
              << "  the reference grows as H^3, the sweep as H, so this gap widens by ~H^2\n";
  }

  if (sink == 12345.678) std::cout << "";  // keep the calls
  return 0;
}
