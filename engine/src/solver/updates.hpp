#pragma once
#include <cmath>
#include <cstdint>
#include <string>

namespace engine {

enum class UpdateRule : std::uint8_t { RegretMatching, CfrPlus, Dcfr };

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
