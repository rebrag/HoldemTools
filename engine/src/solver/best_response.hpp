#pragma once
#include <vector>

#include "game/game.hpp"
#include "solver/cfr.hpp"
#include "solver/strategy_source.hpp"

namespace engine {

// Best response against the solver's average strategy, and the average
// profile's own expected values. All chip-denominated (normalized by the
// game's total profile weight). NashConv = sum over seats of the gain from
// unilaterally best-responding; 2-player exploitability is the special case.
struct BrResult {
  std::vector<double> br_value;  // per seat, chips
  std::vector<double> ev;        // per seat under the average profile, chips

  double nashconv() const {
    double sum = 0.0;
    for (std::size_t p = 0; p < ev.size(); ++p) sum += br_value[p] - ev[p];
    return sum;
  }
};

BrResult compute_best_response(const Game& game, const StrategySource& source);

// The vectorized core's convenience overload: existing call sites keep
// compiling, and the adapter is constructed on this cold path only.
inline BrResult compute_best_response(const Game& game, const CfrSolver& solver) {
  return compute_best_response(game, CfrStrategySource(solver));
}

// The same measurement taken in the ENTROPY-AUGMENTED game a QRE solve is
// actually minimizing: the best response is a smooth (log-sum-exp) maximum and
// the on-profile value is charged the same dilated KL the traversal charges.
//
// The distinction matters because a fixed-lambda QRE is not a Nash
// equilibrium. Its plain exploitability plateaus at roughly
// 2 * D * log(A) / lambda chips (D = the actor's own remaining decision
// points) and never reaches a tight accuracy target, no matter how long it
// runs. `nashconv()` on THIS result does go to zero at the QRE, is chip
// denominated the same way, and is what an accuracy stop should watch.
//
// Falls back to the plain best response when the solver has no QRE configured.
BrResult compute_qre_best_response(const Game& game, const StrategySource& source);

inline BrResult compute_qre_best_response(const Game& game, const CfrSolver& solver) {
  return compute_qre_best_response(game, CfrStrategySource(solver));
}

}  // namespace engine
