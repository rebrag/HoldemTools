#pragma once
#include <cmath>
#include <cstdint>
#include <string>

namespace engine {

enum class UpdateRule : std::uint8_t { RegretMatching, CfrPlus, Dcfr };

// The chance-child recalc schedule: stop re-traversing runout subtrees whose
// values have stopped moving, revisiting them on a doubling period instead.
// This is what makes solve cost sublinear in iterations on multistreet trees
// (Pio's set_recalc_accuracy plays the same role). It is an approximation -
// the accuracy stop stays honest because best response always walks the full
// tree - and it is DETERMINISTIC: every trigger is a function of traversal
// values that are themselves bit-identical at any thread count.
//
// The skip threshold is NOT a fixed epsilon. Freezing a subtree biases the
// values it feeds upward by roughly its own residual movement, so a fixed
// tolerance puts a floor under exploitability at that tolerance - measured:
// a loose fixed threshold stalled a 0.02%-target solve at 0.03-0.2% of pot
// and burned the whole iteration cap. Instead the caller feeds the solver
// its measured per-player exploitability at every checkpoint
// (set_recalc_budget), and a subtree may be skipped only while its last
// movement is small against THAT: frozen error stays a fraction of current
// exploitability, so the target is always reachable and skipping tightens
// itself exactly as the solve converges.
struct RecalcConfig {
  bool enabled = true;
  // Maximum aggressiveness of the skip threshold. The effective threshold is
  // aggressiveness * exploitable * Z / num_subtrees, and aggressiveness is
  // CONTROLLED, not fixed: it starts at `margin`, is cut hard whenever a
  // checkpoint shows convergence stalling, and relaxes back toward `margin`
  // while progress is healthy. Stalls therefore self-correct toward plain
  // CFR instead of wasting the iteration cap, which is exactly what a fixed
  // threshold was measured to do.
  float margin = 64.0f;
  float eps_reach = 1e-2f;  // relative opponent-reach drift forcing a revisit
  int max_period = 32;      // revisit at least this often (iterations)
  int warmup = 32;          // full traversals before any skipping
};

struct UpdateConfig {
  UpdateRule rule = UpdateRule::Dcfr;
  // DCFR discount exponents. Defaults: alpha 1.5, beta 0 (negative regrets
  // decay immediately), gamma 1.0 = linear strategy averaging.
  double alpha = 1.5;
  double beta = 0.0;
  double gamma = 1.0;

  // Weight applied to this iteration's strategy-sum contribution.
  // CFR+ uses linear weighting; DCFR handles averaging via discounting.
  double strategy_weight(std::uint64_t t) const {
    return rule == UpdateRule::CfrPlus ? static_cast<double>(t) : 1.0;
  }

  bool clamp_regrets() const { return rule == UpdateRule::CfrPlus; }

  // Post-iteration multiplicative discounts (DCFR only).
  bool discounts(std::uint64_t t, float& pos, float& neg, float& strat) const {
    if (rule != UpdateRule::Dcfr) return false;
    const double td = static_cast<double>(t);
    const double ta = std::pow(td, alpha);
    const double tb = std::pow(td, beta);
    pos = static_cast<float>(ta / (ta + 1.0));
    neg = static_cast<float>(tb / (tb + 1.0));
    strat = static_cast<float>(std::pow(td / (td + 1.0), gamma));
    return true;
  }
};

}  // namespace engine
