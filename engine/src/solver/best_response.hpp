#pragma once
#include <vector>

#include "game/game.hpp"
#include "solver/cfr.hpp"

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

BrResult compute_best_response(const Game& game, const CfrSolver& solver);

}  // namespace engine
