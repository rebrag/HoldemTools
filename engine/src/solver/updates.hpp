#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

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

// Chance-node sampling. Traverse only `runouts` of a chance node's children
// per iteration and scale what comes back by n/m (Horvitz-Thompson), instead
// of enumerating all 48 or 49.
//
// The one theoretical argument for this over the recalc schedule: freezing a
// subtree is BIASED - it feeds stale values upward, which is why a fixed skip
// threshold was measured to put a floor under exploitability at exactly that
// threshold - whereas importance-weighted sampling is UNBIASED. The error is
// variance, which averages out, rather than bias, which does not.
//
// It is off by default and expected to LOSE on flop and turn trees, and that
// is not a bug in the implementation. This solver is vectorized over all
// hands with an exact gradient, and DCFR converges empirically like 1/T here
// (measured slope 0.99 on turns); sampling moves that into MCCFR's 1/sqrt(T)
// regime, which at a 0.02%-of-pot target loses badly. It exists for PREFLOP,
// where a tree has three chance levels and enumeration is not expensive but
// impossible.
//
// Mutually exclusive with the recalc schedule: the recalc cache stores
// full-enumeration values while a sampled iteration produces n/m-scaled ones,
// and recalc_store's movement metric would be measuring sampling noise, so
// the feedback controller would quarter its aggressiveness on pure noise.
struct SamplingConfig {
  bool enabled = false;
  int runouts = 12;  // m, per chance node, before annealing
  // Anneal m linearly up to full enumeration by this iteration. Annealing all
  // the way to EXACT is what guarantees the accuracy target stays reachable -
  // the same lesson the recalc fixed-threshold result taught, in a different
  // costume. 0 means never anneal (m stays put), which is a research setting
  // rather than a way to run a solve.
  std::uint64_t anneal_full_at = 2000;

  // Children to traverse at a chance node with `units` sampleable children
  // (representatives only - suit-isomorphic members ride on their rep) at
  // iteration t. A pure function of t, so it cannot introduce thread-order
  // dependence. Returns `units` when sampling is off or has annealed out,
  // which is the signal to take the plain enumeration path.
  int runouts_at(std::uint64_t t, int units) const {
    if (!enabled || units <= 0) return units;
    if (anneal_full_at == 0) return runouts < units ? runouts : units;
    if (t >= anneal_full_at) return units;
    const double frac = static_cast<double>(t) / static_cast<double>(anneal_full_at);
    const double m = static_cast<double>(runouts) +
                     (static_cast<double>(units) - static_cast<double>(runouts)) * frac;
    const int mi = static_cast<int>(m);
    if (mi >= units) return units;
    return mi < 1 ? 1 : mi;
  }

  // Has sampling annealed to exact enumeration? The accuracy stop must not
  // fire before this: exploitability is measured honestly (best response
  // always enumerates), but the average strategy being measured is still
  // noisy, so a lucky checkpoint could stop the solve at a strategy that is
  // not actually there.
  bool exact_at(std::uint64_t t) const {
    return !enabled || (anneal_full_at != 0 && t >= anneal_full_at);
  }
};

// Entropy-regularized CFR: the logit quantal response equilibrium (M7).
//
// A QRE is what you get when a player is only boundedly rational: instead of
// always taking the best action, they take action a with probability
// proportional to exp(lambda * Q(a)), where Q is the action's value in CHIPS.
// lambda = 0 is uniform random, lambda -> infinity recovers Nash. Per-seat
// lambda is the point of the feature - solving a good player against a weak
// one is the case Nash cannot express.
//
// It is implemented as a REWARD TRANSFORMATION rather than by replacing regret
// matching. The logit QRE is the saddle point of the entropy-regularized game
//
//     u(s0, s1) + (1/lambda0) H(s0) - (1/lambda1) H(s1)
//
// which is convex-concave over the sequence-form polytopes, so ordinary
// CFR/DCFR machinery applies unchanged and the AVERAGE strategy is still the
// answer. Concretely: each action's counterfactual value gets the regularizer
// added before regrets are accumulated, and nothing else in the solver moves.
// The alternative - deriving the strategy as a softmax over cumulative regrets
// - would have had to change both regret-matching implementations and every
// consumer of average_strategy()/current_strategy(); this does not.
//
// The regularizer is DILATED, i.e. scaled by the actor's compatible opponent
// reach pi(h) (Game::compat_weights). Counterfactual values carry pi(h) and
// softmax is not scale-invariant, so regularizing the raw counterfactual value
// would make effective rationality vary with opponent reach - hands the
// opponent rarely holds would drift toward uniform for no reason. Scaling by
// pi(h) is what makes one lambda mean the same thing at every infoset.
struct QreConfig {
  bool enabled = false;
  // Per-seat rationality in units of 1/chips. Empty when disabled; the parser
  // requires a strictly positive entry per seat when it is not.
  std::vector<double> lambda;

  // Annealing turns QRE into a candidate Nash accelerator: lambda grows
  // geometrically from its configured value to lambda * anneal_factor by
  // iteration anneal_full_at, then holds. 0 = never anneal (the fixed-lambda
  // bounded-rationality product), which is the default.
  //
  // Same shape, and the same reason, as SamplingConfig::runouts_at: a pure
  // function of t, so it cannot introduce thread-order dependence.
  double anneal_factor = 1.0;
  std::uint64_t anneal_full_at = 0;

  // Floor applied to a strategy probability before log(). The regularizer's
  // gradient is -(1/lambda) log s, which diverges at the simplex boundary;
  // the convergence argument needs it finite. The consequence, stated rather
  // than hidden: the solve targets the QRE of a problem truncated at this
  // probability. At 1e-6 that is far below anything the artifact can even
  // represent (strategies quantize to u8), but it is an approximation.
  float min_prob = 1e-6f;

  double lambda_at(std::uint64_t t, int seat) const {
    const double base = lambda[static_cast<std::size_t>(seat)];
    if (anneal_full_at == 0 || anneal_factor <= 1.0) return base;
    if (t >= anneal_full_at) return base * anneal_factor;
    const double frac = static_cast<double>(t) / static_cast<double>(anneal_full_at);
    return base * std::pow(anneal_factor, frac);
  }

  // Has lambda stopped moving? The caller's NASH accuracy stop must not fire
  // while this is false - the same guarantee SamplingConfig::exact_at gives,
  // for the same reason: the strategy being rated is still on its way
  // somewhere else.
  bool annealed(std::uint64_t t) const {
    return !enabled || anneal_full_at == 0 || anneal_factor <= 1.0 || t >= anneal_full_at;
  }
};

struct UpdateConfig {
  UpdateRule rule = UpdateRule::Dcfr;
  // DCFR discount exponents. alpha 1.5 / beta 0 (negative regrets decay
  // immediately) are the paper's values.
  //
  // gamma is the exponent on the STRATEGY-sum discount (t/(t+1))^gamma, and 3
  // is measured rather than inherited. It used to be 1.0 - plain linear
  // averaging - which was costing roughly HALF of every solve: the running
  // average kept early, badly-wrong iterations at a weight the equilibrium
  // never justifies, so exploitability spent hundreds of iterations grinding
  // them back out. Iterations to the same accuracy target, medians over the
  // standard board sets at tight ranges (`bench_boards.py --dcfr-gamma`):
  //
  //   family              gamma 1   gamma 3   gamma 4
  //   river,    0.02%         675       425       425
  //   turn,     0.02%        1225       585       590
  //   flop SPR 4, 0.3%        260       135       125
  //   flop SPR 7, 0.3%        565       255       235
  //   flop SPR 10, 0.3%       900       405       395
  //
  // Two properties decided the value. The saving does NOT decay with stack
  // depth the way the QRE homotopy's did - it is 2.1x at SPR 4 and 2.2x at
  // SPR 10 - and the curve is flat from 3 to 5 before degrading by 8, so 3
  // sits at the knee with margin on both sides. 4 is a few checkpoints better
  // on flop trees and slightly worse on rivers; 3 is also the value
  // postflop-solver independently ships, which is the tie-breaker.
  //
  // gamma is a pure iteration-count lever: the discount is one multiply per
  // cell either way, so per-iteration cost does not move and the wall-clock
  // win is exactly the iteration win. That is why the numbers above are
  // quoted as iterations - they are deterministic, and no A/B noise argument
  // applies to them.
  double alpha = 1.5;
  double beta = 0.0;
  double gamma = 3.0;

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
