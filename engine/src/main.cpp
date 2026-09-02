#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>

#include "cli/args.hpp"
#include "config/schema.hpp"
#include "game/nlhe_preflop.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "game/toy/leduc.hpp"
#include "io/artifact_format.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_writer.hpp"
#include "io/checkpoint.hpp"
#include "io/dump_json.hpp"
#include "solver/agents.hpp"
#include "solver/best_response.hpp"
#include "solver/cfr.hpp"
#include "game/deal_game.hpp"
#include "solver/sampled_cfr.hpp"
#include "solver/memory.hpp"
#include "util/parallel.hpp"
#include "util/stop_signal.hpp"

namespace {

using namespace engine;

// Wall clock from process start. `budget.max_seconds` is a ceiling on the
// WHOLE run, not just the iteration loop, because the thing it exists to
// beat is an external kill: a watcher (or a scheduler) that shoots the
// process at a deadline discards every iteration, since the artifact is
// only written at the end. Stopping ourselves a little early and writing a
// shorter solve turns an hour of thrown-away compute into a usable answer.
// Setup counts against it for the same reason - the caller's deadline does
// not care which phase we were in.
const std::chrono::steady_clock::time_point kProcessStart =
    std::chrono::steady_clock::now();

double elapsed_s() {
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - kProcessStart)
      .count();
}

// How much iterating to do between deadline checks. Small enough that the
// budget is honored closely, large enough that the check costs nothing.
// For the sampled core it is rounded to a whole number of BATCHES: a batch
// boundary is where the discount and the lane fold happen, so slicing on
// one keeps the run bitwise identical to an unsliced solve.
constexpr std::uint64_t kSliceTargetIters = 250000;

std::uint64_t deadline_slice(std::uint64_t remaining, std::uint64_t batch) {
  std::uint64_t slice = kSliceTargetIters;
  if (batch > 0) {
    const std::uint64_t batches = std::max<std::uint64_t>(1, kSliceTargetIters / batch);
    slice = batches * batch;
  }
  return std::min(slice, remaining);
}

std::unique_ptr<Game> make_game(const SolveConfig& config) {
  if (config.game == "kuhn") return std::make_unique<toy::KuhnGame>();
  if (config.game == "leduc") return std::make_unique<toy::LeducGame>();
  if (config.game == "nlhe_preflop") return std::make_unique<NlhePreflopGame>(config);
  return std::make_unique<NlhePostflopGame>(config);
}

int check_memory(const Game& game, const SolveConfig& config, bool print_always) {
  const MemoryEstimate estimate =
      estimate_memory(game, config.threads, config.recalc.enabled, config.update.precision,
                      &config.sampled);
  if (print_always) std::cout << estimate.to_string() << "\n";
  const double limit_bytes = config.memory_limit_gb * 1024.0 * 1024.0 * 1024.0;
  if (static_cast<double>(estimate.total()) > limit_bytes) {
    std::cerr << "FATAL: " << estimate.to_string() << " exceeds memory_limit_gb ("
              << config.memory_limit_gb << " GB). Shrink the tree (fewer sizes, "
              << "fewer raises) or raise the limit.\n";
    return 1;
  }
  return 0;
}

// The sampled-deal core's solve loop. Deliberately smaller than the
// vectorized one below: no recalc budget to feed, no chance-sampling or
// annealing guards, no QRE - config validation refused all of those.
int run_sampled_solve(const SolveConfig& config, const Game& game, int threads,
                      double setup_s) {
  const DealGame* deals = dynamic_cast<const DealGame*>(&game);
  if (deals == nullptr) {
    std::cerr << "FATAL: game \"" << config.game
              << "\" has no deal interface for algorithm.family \"sampled\"\n";
    return 1;
  }
  const AgentMap agents = AgentMap::from_config(config, game.num_seats());
  const bool team = agents.has_team();
  // The EV stream is independent of the training stream by construction.
  constexpr std::uint64_t kEvDeals = 200000;
  const std::uint64_t ev_seed = config.sampled.seed ^ 0x9E3779B97F4A7C15ULL;

  std::cout << "sampled core: seed " << config.sampled.seed << ", batch "
            << config.sampled.batch << ", lanes " << config.sampled.lanes << "\n";

  SolveStats stats;
  if (team) {
    for (int q = 0; q < game.num_seats(); ++q) {
      if (agents.teammate_of[static_cast<std::size_t>(q)] >= 0) stats.team_seats.push_back(q);
    }
    stats.awareness = config.awareness;
    std::cout << "hand-sharing team: seats " << stats.team_seats[0] << "+"
              << stats.team_seats[1] << ", opponents " << config.awareness
              << ". Research/analysis tooling - using this on live tables is cheating.\n";
  }
  SampledCfrSolver solver(game, *deals, config.sampled, config.threads, agents);
  stats.solve_id = config.solve_id;
  const bool unaware_team = team && config.awareness == "unaware";
  if (unaware_team) stats.baseline_solve_id = config.baseline_solve_id;
  std::cout << "solve id " << config.solve_id;
  if (unaware_team) std::cout << ", baseline " << config.baseline_solve_id;
  if (!config.checkpoint_path.empty()) std::cout << " (checkpoints on)";
  std::cout << "\n";
  const bool resume_allowed = config.resume_mode != "never";
  // Phase 1 keeps its OWN checkpoint, named by the SPOT rather than by this
  // lineage: the baseline is the spot's no-team solve, so every team
  // partition of the spot shares it, and a no-team solve of the spot resumes
  // the very same file (same key, same derived id) - which is how a baseline
  // gets exported and looked at.
  const std::string base_ck = config.baseline_checkpoint_path;

  // PHASE 2's checkpoint is read FIRST, before phase 1 does any work. It
  // records which baseline the team trained against, and that is what decides
  // whether extending phase 1 is allowed at all - discovering the conflict
  // after phase 1 had already advanced and saved would strand the solve:
  // the baseline would be past the value the error message tells you to
  // restore.
  bool resumed = false;
  // A cancel in phase 1 also ends phase 2 before it starts. Stopping the
  // baseline and then training a full team phase against it would ignore the
  // thing the user actually asked for, and the checkpoints below keep both
  // phases exactly where they stopped.
  bool cancelled = false;
  CheckpointExtras extras;
  if (!config.checkpoint_path.empty() && resume_allowed) {
    std::string err;
    if (read_checkpoint(config.checkpoint_path, solver, config, extras, err)) {
      resumed = true;
      std::cout << "resumed solve " << config.solve_id << " at iteration "
                << solver.iteration() << " of " << config.iterations << "\n";
      if (solver.iteration() >= config.iterations) {
        std::cout << "note: budget.iterations is a TOTAL and this solve already reaches "
                     "it - nothing to iterate. Raise it to continue.\n";
      }
    } else if (config.resume_mode == "require") {
      std::cerr << "FATAL: solve.resume is \"require\" but there is nothing to resume: " << err
                << "\n";
      return 1;
    } else if (checkpoint_exists(config.checkpoint_path)) {
      // A file is there and it is not ours to continue. Starting fresh would
      // overwrite it at the end of this run - silently destroying another
      // spot's iterations, hours of them possibly, because an id was reused.
      std::cerr << "FATAL: " << config.checkpoint_path
                << " holds a solve this config cannot continue (" << err << ").\n"
                << "       Solve under a different solve.id, or set solve.resume to "
                   "\"never\" to start over and overwrite it.\n";
      return 1;
    } else {
      std::cout << "checkpoint: starting fresh (" << err << ")\n";
    }
  }

  // PHASE 1 (unaware teams only): the no-team baseline everyone believes they
  // are playing. It runs on every invocation - resuming its own checkpoint
  // and iterating only the shortfall - which is what makes a baseline
  // extendable rather than frozen forever at whatever the first run reached.
  std::unique_ptr<SampledCfrSolver> baseline;
  if (unaware_team) {
    baseline = std::make_unique<SampledCfrSolver>(game, *deals, config.sampled,
                                                  config.threads);
    CheckpointExtras base_extras;
    // Keyed by the spot alone (baseline_solve_key): the partition is not part
    // of a no-team solve, so it must not be part of what identifies one.
    const std::string base_key = baseline_solve_key(config);
    if (!base_ck.empty() && resume_allowed) {
      std::string err;
      if (read_checkpoint(base_ck, *baseline, base_key, base_extras, err)) {
        std::cout << "phase 1: resumed baseline " << config.baseline_solve_id
                  << " at iteration " << baseline->iteration() << "\n";
      } else if (config.resume_mode == "require") {
        std::cerr << "FATAL: solve.resume is \"require\" but the baseline checkpoint could "
                     "not be used: " << err << "\n";
        return 1;
      } else if (checkpoint_exists(base_ck)) {
        std::cerr << "FATAL: " << base_ck << " holds a solve this spot's baseline cannot "
                     "continue (" << err << ").\n"
                  << "       Move it aside, or set solve.resume to \"never\" to start the "
                     "baseline over and overwrite it.\n";
        return 1;
      }
    }
    const std::uint64_t base_target =
        config.baseline_iterations > 0 ? config.baseline_iterations : config.iterations;
    // Where phase 1 will END this run. A target below what it has already
    // reached is not a rewind - it simply does nothing.
    const std::uint64_t base_end = std::max(baseline->iteration(), base_target);
    // `solver.iteration() > 0` is what makes this a real conflict. Phase 2
    // having done NO work - a fresh solve, or one stopped during phase 1 -
    // means there are no regrets to invalidate, so refusing there would
    // strand a solve to protect nothing: the baseline moved, phase 2 is
    // empty, and the user is simply continuing what they stopped.
    if (resumed && solver.iteration() > 0 && extras.baseline_iterations != base_end) {
      // A team's regrets are a best response to ONE baseline. Moving the
      // baseline makes them stale: continuing would blend a best response to
      // the old baseline with one to the new. Refuse BEFORE phase 1 runs, so
      // nothing is spent and the suggested fix actually works.
      if (!config.rebase) {
        if (baseline->iteration() != extras.baseline_iterations) {
          // The baseline is shared by every solve of the spot, so another
          // lineage (or a no-team solve) may already have lengthened it. The
          // "restore the old count" fix does not exist then: a baseline never
          // rewinds. Only a rebase, or a fresh id, can continue.
          std::cerr << "FATAL: baseline " << config.baseline_solve_id
                    << " has been extended to " << baseline->iteration()
                    << " iterations by another solve of this spot, but phase 2 was trained "
                       "against it at "
                    << extras.baseline_iterations
                    << ". Phase 2's regrets are a best response to the OLD baseline, so "
                       "continuing would mix two different games.\n"
                       "       Set solve.rebase true to restart phase 2 against the longer "
                       "baseline, or solve under a new solve.id.\n";
          return 1;
        }
        std::cerr << "FATAL: this would move the baseline out from under phase 2, which was "
                     "trained against "
                  << extras.baseline_iterations << " baseline iterations (this run would end "
                  << "with " << base_end
                  << "). Phase 2's regrets are a best response to the OLD baseline, so "
                     "continuing would mix two different games.\n"
                     "       Either set agents.baseline_iterations to "
                  << extras.baseline_iterations
                  << " to keep extending phase 2, or set solve.rebase true to restart phase 2 "
                     "against the longer baseline.\n";
        return 1;
      }
      std::cout << "rebasing: the baseline moves from " << extras.baseline_iterations << " to "
                << base_end << " iterations, so phase 2 restarts against it\n";
      solver.reset();
      resumed = false;
    }
    std::cout << "phase 1: no-team baseline, " << base_target << " iterations total\n";
    // Phase 1 gets at most half the time budget. The budget exists so the run
    // always reaches the artifact, and an artifact whose team phase never ran
    // would be a no-team solve wearing a team's metadata.
    const double base_deadline = config.max_seconds > 0.0 ? config.max_seconds * 0.5 : 0.0;
    // Slicing is what makes phase 1 interruptible at all: an unsliced run()
    // is one call that returns when the whole baseline is done, and neither
    // the clock nor a cancel can be looked at from inside it.
    const bool base_sliced = base_deadline > 0.0 || !config.stop_file.empty();
    const std::uint64_t base_before = baseline->iteration();
    while (baseline->iteration() < base_target) {
      const std::uint64_t remaining = base_target - baseline->iteration();
      const std::uint64_t slice = base_sliced
                                      ? deadline_slice(remaining, config.sampled.batch)
                                      : remaining;
      baseline->run(slice);
      if (stop_requested(config.stop_file)) {
        std::cout << "phase 1 cancelled after " << baseline->iteration() << " iterations\n";
        stats.stopped_reason = "cancelled";
        cancelled = true;
        break;
      }
      if (base_deadline > 0.0 && elapsed_s() >= base_deadline) {
        std::cout << "phase 1 stopped at its " << base_deadline << " s share of the "
                  << "time budget after " << baseline->iteration() << " iterations\n";
        stats.stopped_reason = "time_budget";
        break;
      }
    }
    stats.baseline_iterations = baseline->iteration();
    stats.baseline_ev_chips = baseline->sampled_ev(kEvDeals, ev_seed);
    std::cout << "baseline ev";
    for (double ev : stats.baseline_ev_chips) std::cout << " " << ev;
    std::cout << "\n";
    // Only a baseline that moved is written back: the file is shared by every
    // solve of the spot, and a run that merely read it has nothing to add.
    if (!base_ck.empty() && baseline->iteration() != base_before) {
      CheckpointExtras out_extras;
      write_checkpoint(base_ck, *baseline, base_key, out_extras);
      std::cout << "baseline checkpoint " << base_ck << " at iteration "
                << baseline->iteration() << "\n";
    }
  } else if (resumed) {
    // No phase 1 to re-derive them from (aware team, or no team at all).
    stats.baseline_iterations = extras.baseline_iterations;
    stats.baseline_ev_chips = extras.baseline_ev_chips;
  }

  if (baseline) {
    std::vector<bool> frozen(static_cast<std::size_t>(game.num_seats()), false);
    for (int q = 0; q < game.num_seats(); ++q) {
      frozen[static_cast<std::size_t>(q)] = agents.teammate_of[static_cast<std::size_t>(q)] < 0;
    }
    // Always re-freeze from the live baseline solver rather than trusting the
    // rows inside phase 2's checkpoint: the two are equal by the check above,
    // and taking them from the baseline keeps ONE source of truth.
    solver.freeze_seats_from(*baseline, frozen);
    std::cout << "phase 2: joint team best response against the frozen baseline\n";
  }
  // The preflop evaluator best response runs against is exact at 2-3 seats
  // and first-order at 4+, where its residual would let a target fire on a
  // number that is not really exploitability. A TEAM plays a correlated
  // joint strategy that per-seat marginals cannot reproduce, so best
  // response is not a meaningful measure there at all - EVs come from the
  // sampled pass instead, and nashconv is stamped invalid.
  const bool br_exact = !team && game.num_seats() <= 3;
  if (!br_exact) {
    std::cout << "note: best response rides a first-order evaluator at "
              << game.num_seats()
              << " seats, so accuracy targets will NOT stop this solve - it runs to "
                 "budget.iterations. The reported nashconv is a diagnostic.\n";
  }
  const auto start = std::chrono::steady_clock::now();
  double nashconv = 0.0;
  // budget.iterations is the TOTAL for the solve, not this run's share, so
  // re-running a config with a larger budget walks toward the target rather
  // than redoing what the checkpoint already holds.
  std::uint64_t done = solver.iteration();
  const std::uint64_t started_at = done;
  const double pot = static_cast<double>(config.pot);
  const bool timed = config.max_seconds > 0.0;
  // Same reason as phase 1: a slice is the only place a cancel can be seen.
  const bool sliced = timed || !config.stop_file.empty();
  bool out_of_time = false;
  while (!cancelled && done < config.iterations) {
    const std::uint64_t step =
        std::min<std::uint64_t>(config.checkpoint_every, config.iterations - done);
    // A team solve takes ONE checkpoint for the whole budget (there is no
    // best response to measure), so the deadline has to be checked inside
    // the step or a 60M-iteration solve would never look at the clock.
    std::uint64_t ran = 0;
    while (ran < step) {
      const std::uint64_t slice =
          sliced ? deadline_slice(step - ran, config.sampled.batch) : step - ran;
      solver.run(slice);
      ran += slice;
      if (stop_requested(config.stop_file)) {
        cancelled = true;
        break;
      }
      if (timed && elapsed_s() >= config.max_seconds) {
        out_of_time = true;
        break;
      }
    }
    done += ran;
    if (cancelled) {
      std::cout << "iter " << done << "\ncancelled: writing the artifact for the " << done
                << " iterations completed\n";
      break;
    }
    if (out_of_time) {
      std::cout << "iter " << done << "\nstopping at the " << config.max_seconds
                << " s budget: writing the artifact for the " << done
                << " iterations completed\n";
      break;
    }
    if (team) {
      std::cout << "iter " << done << "\n";
      continue;
    }
    const BrResult br = compute_best_response(game, solver);
    nashconv = br.nashconv();
    const double exploitable = nashconv / game.num_seats();
    std::cout << "iter " << done << "  nashconv " << nashconv << "  exploitable "
              << exploitable;
    if (pot > 0.0) std::cout << " (" << 100.0 * exploitable / pot << "% of pot)";
    std::cout << "  ev";
    for (double ev : br.ev) std::cout << " " << ev;
    std::cout << "\n";
    if (br_exact && config.target_nashconv > 0.0 && nashconv <= config.target_nashconv) {
      std::cout << "target_nashconv reached\n";
      break;
    }
    if (br_exact && config.target_exploitable_pct > 0.0 && pot > 0.0 &&
        exploitable <= config.target_exploitable_pct / 100.0 * pot) {
      std::cout << "target_exploitable_pct reached\n";
      break;
    }
  }
  if (done == started_at && !cancelled && !team) {
    // A run with nothing left to iterate - re-exporting a finished solve, which
    // is how a baseline gets looked at - never enters the loop, so it never
    // measures anything, and a stamped nashconv of 0.0 would read as "exact".
    // Measure once so the artifact says what the strategy is actually worth.
    const BrResult br = compute_best_response(game, solver);
    nashconv = br.nashconv();
    std::cout << "iter " << done << "  nashconv " << nashconv << "  exploitable "
              << nashconv / game.num_seats() << " (measured on re-export; nothing iterated)\n";
  }
  const double wall_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();

  if (cancelled && team && solver.iteration() == 0) {
    // Worth saying out loud: the team phase never ran, so the team seats have
    // no strategy sums and export as a uniform mix. The artifact is still
    // written (and the baseline checkpoint is still good), but the charts in
    // it are not a team solve yet.
    std::cout << "warning: stopped before the team phase ran a single iteration, so the "
                 "team seats export as an unsolved uniform mix. The baseline is saved - "
                 "solve again with the same id to continue.\n";
  }
  stats.iterations = solver.iteration();
  stats.nashconv = nashconv;
  stats.nashconv_valid = !team;
  if (out_of_time) stats.stopped_reason = "time_budget";
  // A cancel outranks the time budget in the label: both stopped the solve
  // early, but only one of them is something the user did.
  if (cancelled) stats.stopped_reason = "cancelled";
  // Root EVs from the sampled pass for EVERY sampled solve: each deal's
  // payoffs sum to the pot, so these conserve exactly at any seat count -
  // and they are the only honest EVs for a team, whose correlated play no
  // per-seat marginal can reproduce.
  stats.ev_chips = solver.sampled_ev(kEvDeals, ev_seed);
  stats.wall_time_s = wall_s;
  stats.setup_time_s = setup_s;
  stats.threads = threads;
  stats.peak_rss_bytes = peak_rss_bytes();
  std::cout << "sampled ev (" << kEvDeals << " deals)";
  for (double ev : stats.ev_chips) std::cout << " " << ev;
  std::cout << "\n";
  if (team) {
    stats.team_rollup = solver.team_rollup_json();
    double team_ev = 0.0;
    for (int q : stats.team_seats) team_ev += stats.ev_chips[static_cast<std::size_t>(q)];
    std::cout << "team ev " << team_ev;
    if (!stats.baseline_ev_chips.empty()) {
      double base_team = 0.0;
      for (int q : stats.team_seats) {
        base_team += stats.baseline_ev_chips[static_cast<std::size_t>(q)];
      }
      std::cout << " (baseline " << base_team << ", uplift " << team_ev - base_team << ")";
    }
    std::cout << " chips\n";
  }

  // The checkpoint goes out before the artifact: the artifact is for
  // viewers, the checkpoint is the only thing that lets this solve continue.
  if (!config.checkpoint_path.empty() && solver.iteration() == 0) {
    // Nothing to save: a phase 2 that never ran has zero regrets, and writing
    // it would only record which baseline it did not train against - the
    // value the interlock above then reads back.
    std::cout << (baseline
                      ? "no team iterations to checkpoint; the baseline is saved, so solving "
                        "again with this id continues from there\n"
                      : "no iterations to checkpoint; nothing was solved\n");
  } else if (!config.checkpoint_path.empty()) {
    extras.baseline_iterations = stats.baseline_iterations;
    extras.baseline_ev_chips = stats.baseline_ev_chips;
    const double ck_s = write_checkpoint(config.checkpoint_path, solver, config, extras);
    std::cout << "checkpoint " << config.checkpoint_path << " at iteration "
              << solver.iteration() << " (" << ck_s << " s)";
    if (solver.iteration() < config.iterations) {
      std::cout << " - run again to continue toward " << config.iterations;
    }
    std::cout << "\n";
    // Resuming is bit-for-bit only from a BATCH boundary, because a batch is
    // where the discount and the lane fold happen; stopping inside one splits
    // a fold and the continuation differs in the last bits. Time-budget stops
    // always land on a boundary (deadline_slice rounds to whole batches), so
    // this only fires on a hand-picked budget.iterations - and only when this
    // run actually stopped somewhere: a run that merely re-exported a finished
    // solve (0 iterations) did not stop inside anything.
    if (config.sampled.batch > 0 && solver.iteration() != started_at &&
        solver.iteration() % config.sampled.batch != 0) {
      std::cout << "note: stopped mid-batch (iteration is not a multiple of "
                << config.sampled.batch
                << "), so continuing from here will differ from an uninterrupted run in "
                   "the last bits. Use a multiple of the batch size for an exact resume.\n";
    }
  }

  LocalStore store;
  const double export_s =
      write_artifact(store, config.output_path, game, solver, config, stats);
  const PeakMemory peak = peak_memory();
  const std::uint64_t ran_now = done - started_at;
  std::cout << "solve time " << wall_s << " s (" << ran_now << " iters this run on "
            << threads << " thread" << (threads == 1 ? "" : "s") << ", "
            << (wall_s > 0.0 ? static_cast<double>(ran_now) / wall_s : 0.0)
            << " iters/s, " << done << " total)\n";
  std::cout << "wrote " << config.output_path << "  (wall " << wall_s + setup_s
            << " s including setup, peak RSS " << peak.working_set / (1024.0 * 1024.0)
            << " MB";
  if (peak.commit > 0) std::cout << ", commit " << peak.commit / (1024.0 * 1024.0) << " MB";
  std::cout << ")\n";
  std::cout << "total " << wall_s + setup_s + export_s << " s (setup " << setup_s
            << " + solve " << wall_s << " + artifact export " << export_s << " s)\n";
  return 0;
}

int run_solve(const SolveConfig& config, bool dry_run) {
  const int threads = resolve_thread_count(config.threads);
  const auto setup_start = std::chrono::steady_clock::now();
  const auto game = make_game(config);
  AgentMap::from_config(config, game->num_seats());  // validates identity/no-collusion
  const double setup_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - setup_start).count();

  if (dry_run) {
    const MemoryEstimate estimate =
        estimate_memory(*game, config.threads, config.recalc.enabled,
                        config.update.precision, &config.sampled);
    std::cout << estimate.to_string() << "\n";
    std::cout << "tree: " << game->tree().size() << " nodes ("
              << game->tree().num_decision_nodes << " decision, "
              << game->tree().num_terminal_nodes << " terminal)\n";
    std::cout << "threads: " << threads << " (setup took " << setup_s << " s)\n";
    // The identities a solve would checkpoint under, so a caller can find
    // (or migrate) files without running anything.
    std::cout << "solve id: " << config.solve_id << "\n";
    if (config.sampled.enabled) {
      std::cout << "baseline id (the spot's no-team solve): " << config.baseline_solve_id
                << "\n";
    }
    return check_memory(*game, config, false);
  }
  if (int rc = check_memory(*game, config, true); rc != 0) return rc;
  if (config.sampled.enabled) return run_sampled_solve(config, *game, threads, setup_s);

  std::cout << "setup " << setup_s << " s (tree + showdown tables) on " << threads
            << " thread" << (threads == 1 ? "" : "s") << "\n";
  CfrSolver solver(*game, config.update, config.threads, config.recalc, config.sampling,
                   config.qre);
  const auto start = std::chrono::steady_clock::now();
  double nashconv = 0.0;
  double qre_gap = 0.0;
  BrResult br;
  std::uint64_t done = 0;
  bool out_of_time = false;
  bool cancelled = false;
  const double pot = static_cast<double>(config.pot);

  // A fixed-lambda QRE is not a Nash equilibrium, and its PLAIN exploitability
  // floors out at roughly 2 * D * log(A) / lambda chips (D = a player's own
  // remaining decision points, A = actions per node). Someone who sets a tight
  // accuracy target on a soft lambda is asking for something arithmetically
  // unreachable, so say so up front rather than after they have waited out the
  // iteration cap. The stop itself uses the QRE gap, which does converge.
  if (config.qre.enabled) {
    std::cout << "QRE mode: lambda";
    for (double l : config.qre.lambda) std::cout << " " << l;
    if (config.qre.anneal_full_at != 0 && config.qre.anneal_factor > 1.0) {
      std::cout << ", annealing x" << config.qre.anneal_factor << " by iteration "
                << config.qre.anneal_full_at;
    }
    std::cout << "\n";
    if (config.target_exploitable_pct > 0.0 && pot > 0.0 && !config.qre.lambda.empty()) {
      // DECISION nodes only. A chance node's 48 runouts are not actions
      // anybody chooses between, and counting them inflates the bound wildly.
      int max_actions = 0;
      for (const Node& n : game->tree().nodes) {
        if (n.kind != NodeKind::Decision) continue;
        max_actions = std::max(max_actions, static_cast<int>(n.num_children));
      }
      // The lambda actually in force when the accuracy stop is allowed to
      // fire. Under annealing that is the FINAL lambda, not the starting one -
      // warning off the starting value would claim a floor 'factor' times too
      // high for a run that is explicitly climbing away from it.
      const bool annealing =
          config.qre.anneal_full_at != 0 && config.qre.anneal_factor > 1.0;
      const double effective =
          *std::min_element(config.qre.lambda.begin(), config.qre.lambda.end()) *
          (annealing ? config.qre.anneal_factor : 1.0);
      // 2 * D * log(A) / lambda, with D = a player's own remaining decision
      // points. A LOOSE UPPER BOUND on the floor, not the floor itself - the
      // realized plateau is typically well under it. It is here to answer one
      // question only: can this lambda reach this target at all?
      const double d = 3.0;
      const double bound =
          2.0 * d * std::log(static_cast<double>(std::max(2, max_actions))) / effective;
      const double target_chips = config.target_exploitable_pct / 100.0 * pot;
      if (bound > target_chips && !annealing) {
        std::cout << "  note: at this lambda the strategy is deliberately not Nash, so "
                     "plain exploitability will PLATEAU rather than reach the "
                  << config.target_exploitable_pct << "%-of-pot target ("
                  << target_chips << " chips). The solve stops on the QRE gap instead, "
                     "which does converge. Raise lambda if you wanted a near-Nash "
                     "strategy - the plateau is bounded above by roughly "
                  << bound << " chips.\n";
      } else if (bound > target_chips) {
        // Annealing targets plain Nash exploitability, so an unreachable
        // target here is a genuine dead end rather than a change of metric.
        std::cout << "  note: even the annealed lambda (" << effective
                  << ") may not reach the " << config.target_exploitable_pct
                  << "%-of-pot target (" << target_chips
                  << " chips): the floor is bounded above by roughly " << bound
                  << " chips. Raise qre.anneal.factor if the run stalls.\n";
      }
    }
  }
  while (done < config.iterations) {
    const std::uint64_t step =
        std::min<std::uint64_t>(config.checkpoint_every, config.iterations - done);
    solver.run(step);
    done += step;
    br = compute_best_response(*game, solver);
    nashconv = br.nashconv();
    // Under QRE this is the number the solve is actually minimizing; the plain
    // one above is kept as the diagnostic that shows the lambda-dependent
    // plateau. Best-response checkpoints were measured at 0.06% of solve time,
    // so running both costs nothing worth optimizing.
    const bool qre_on = config.qre.enabled;
    if (qre_on) qre_gap = compute_qre_best_response(*game, solver).nashconv();
    const double driving = qre_on ? qre_gap : nashconv;
    // "exploitable" follows Pio's convention: the per-player average gain
    // from best-responding = NashConv / num_seats for 2 players.
    const double exploitable = nashconv / game->num_seats();
    const double qre_exploitable = driving / game->num_seats();
    // Feed the recalc schedule its annealing budget: subtrees may be frozen
    // only while their movement is small against CURRENT exploitability. Under
    // QRE that has to be the REGULARIZED number - the plain one plateaus, and
    // the schedule's feedback controller reads a plateau as "frozen subtrees
    // are stalling the solve" and quarters its aggressiveness on nothing.
    solver.set_recalc_budget(qre_exploitable);
    std::cout << "iter " << done << "  nashconv " << nashconv
              << "  exploitable " << exploitable;
    if (pot > 0.0) std::cout << " (" << 100.0 * exploitable / pot << "% of pot)";
    if (qre_on) {
      std::cout << "  qre_gap " << qre_gap << " (" << qre_exploitable;
      if (pot > 0.0) std::cout << ", " << 100.0 * qre_exploitable / pot << "% of pot";
      std::cout << " per player)";
    }
    std::cout << "  ev";
    for (double ev : br.ev) std::cout << " " << ev;
    std::cout << "\n";
    // The accuracy stop must not fire while the solver is still subsampling
    // runouts. Exploitability itself is honest (best response always
    // enumerates), but the average strategy it is rating is still noisy, so a
    // lucky checkpoint could stop the solve at a strategy that is not there.
    //
    // Lambda annealing gets the same guard for the same reason: while lambda
    // is still moving the strategy is on its way to a different game, so a
    // Nash target must not be allowed to fire early on the way past.
    const bool may_stop = solver.sampling_exact() && solver.qre_annealed();
    // Which number the target refers to. Plain Nash for a nash solve; the QRE
    // gap for a fixed-lambda QRE solve, whose plain exploitability cannot
    // reach a tight target at all; and back to plain Nash once lambda has
    // annealed, because that is the point of annealing.
    const bool annealing = qre_on && config.qre.anneal_full_at != 0 &&
                           config.qre.anneal_factor > 1.0;
    const double target_metric = (qre_on && !annealing) ? qre_exploitable : exploitable;
    const double target_conv = (qre_on && !annealing) ? qre_gap : nashconv;
    const char* metric_name = (qre_on && !annealing) ? "qre gap" : "exploitability";
    if (may_stop && config.target_nashconv > 0.0 && target_conv <= config.target_nashconv) {
      std::cout << "target_nashconv reached (" << metric_name << ")\n";
      break;
    }
    if (may_stop && config.target_exploitable_pct > 0.0 && pot > 0.0 &&
        target_metric <= config.target_exploitable_pct / 100.0 * pot) {
      std::cout << "target_exploitable_pct reached (" << metric_name << ")\n";
      break;
    }
    // Checkpoint granularity is the natural deadline unit here: this loop
    // measures a best response every checkpoint anyway, so it is already
    // stopping at a point where the solve is worth writing out. A cancel
    // rides the same granularity. This core has no checkpoint file, so
    // stopping here yields a shorter solve that cannot be continued - still
    // an artifact, where a kill would have left nothing.
    if (stop_requested(config.stop_file)) {
      cancelled = true;
      std::cout << "cancelled: writing the artifact for the " << done
                << " iterations completed\n";
      break;
    }
    if (config.max_seconds > 0.0 && elapsed_s() >= config.max_seconds) {
      out_of_time = true;
      std::cout << "stopping at the " << config.max_seconds
                << " s budget: writing the artifact for the " << done
                << " iterations completed\n";
      break;
    }
  }
  const double wall_s =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();

  SolveStats stats;
  stats.iterations = solver.iteration();
  stats.nashconv = nashconv;
  if (out_of_time) stats.stopped_reason = "time_budget";
  if (cancelled) stats.stopped_reason = "cancelled";
  stats.ev_chips = br.ev;
  stats.wall_time_s = wall_s;
  stats.setup_time_s = setup_s;
  stats.threads = threads;
  stats.recalc_skips = solver.recalc_skips();
  // Solve-phase peak only. The artifact export pass that write_artifact runs
  // next allocates one record per decision node and is the real high-water
  // mark; write_artifact samples that itself, after the pass. Both numbers go
  // into the metadata.
  stats.peak_rss_bytes = peak_rss_bytes();
  stats.qre_gap = qre_gap;

  LocalStore store;
  const double export_s =
      write_artifact(store, config.output_path, *game, solver, config, stats);
  const PeakMemory peak = peak_memory();
  std::cout << "solve time " << wall_s << " s (" << done << " iters on " << threads
            << " thread" << (threads == 1 ? "" : "s") << ", "
            << (wall_s > 0.0 ? static_cast<double>(done) / wall_s : 0.0) << " iters/s)\n";
  std::cout << "wrote " << config.output_path << "  (wall " << wall_s + setup_s
            << " s including setup, peak RSS "
            << peak.working_set / (1024.0 * 1024.0) << " MB";
  // Commit is what the process asked for; the working set is what the OS kept
  // resident, and it is trimmed under memory pressure. They usually agree
  // closely, and when they do not the commit figure is the honest one.
  if (peak.commit > 0) std::cout << ", commit " << peak.commit / (1024.0 * 1024.0) << " MB";
  std::cout << "; solve phase " << stats.peak_rss_bytes / (1024.0 * 1024.0) << " MB)\n";
  // The export pass used to be invisible: `wall` above stops before it, so a
  // flop solve reporting 56 s was really 74 s, and the missing quarter ran on
  // ONE core. Print the total the process actually took, and the split.
  std::cout << "total " << wall_s + setup_s + export_s << " s (setup " << setup_s
            << " + solve " << wall_s << " + artifact export " << export_s
            << " s)\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const CliArgs args = parse_args(argc, argv);
  if (!args.valid) {
    std::cerr << args.error << "\n" << usage();
    return 2;
  }
  try {
    if (args.subcommand == "version") {
      std::cout << "htsolver 0.1.0 (artifact format v" << artifact::kFormatVersion << ")\n";
      return 0;
    }
    if (args.subcommand == "dump-json") {
      LocalStore store;
      if (args.meta_only) {
        ArtifactReader reader(store, args.input_path);
        std::cout << reader.metadata().dump(2) << "\n";
        return 0;
      }
      const nlohmann::json dump = dump_artifact_json(store, args.input_path, args.node,
                                                     args.runouts, args.fields);
      const std::string text = args.compact ? dump.dump() : dump.dump(2);
      if (args.out_path) {
        std::ofstream out(*args.out_path, std::ios::binary);
        if (!out) throw std::runtime_error("cannot open --out path: " + *args.out_path);
        out << text << "\n";
        out.close();
        if (!out) throw std::runtime_error("failed writing --out path: " + *args.out_path);
        std::cerr << "wrote " << *args.out_path << " (" << text.size() << " bytes)\n";
      } else {
        std::cout << text << "\n";
      }
      return 0;
    }
    const SolveConfig config = load_config(args.input_path);
    return run_solve(config, args.subcommand == "dry-run");
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
