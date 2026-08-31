#include "config/schema.hpp"

#include <bit>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "config/sha256.hpp"

namespace engine {

namespace {

using nlohmann::json;

[[noreturn]] void fail(const std::string& message) {
  throw std::runtime_error("config: " + message);
}

std::string read_file(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) fail("cannot open '" + path.string() + "'");
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

std::vector<double> parse_pcts(const json& j, const char* key, const char* what) {
  if (!j.contains(key)) return {};
  auto pcts = j.at(key).get<std::vector<double>>();
  for (double pct : pcts) {
    if (pct <= 0) fail(std::string(what) + " percentages must be positive");
  }
  return pcts;
}

// One street's sizing. Two accepted shapes:
//   legacy: { "bets": [...], "raises": [...] }          - applied to both seats
//   split:  { "ip": {"bets","raises"}, "oop": {"bets","donks","raises"} }
// plus allin_threshold / max_raises at the street level in either shape.
StreetSizing parse_sizing(const json& j) {
  StreetSizing sizing;
  if (j.contains("ip") || j.contains("oop")) {
    if (j.contains("ip")) {
      const json& ip = j.at("ip");
      sizing.ip.bets = parse_pcts(ip, "bets", "bet size");
      sizing.ip.raises = parse_pcts(ip, "raises", "raise size");
      sizing.ip.no_3bet = ip.value("no_3bet", false);
    }
    if (j.contains("oop")) {
      const json& oop = j.at("oop");
      sizing.oop.bets = parse_pcts(oop, "bets", "bet size");
      sizing.oop.donks = parse_pcts(oop, "donks", "donk size");
      sizing.oop.raises = parse_pcts(oop, "raises", "raise size");
      sizing.oop.no_3bet = oop.value("no_3bet", false);
    }
  } else {
    sizing.oop.bets = sizing.ip.bets = parse_pcts(j, "bets", "bet size");
    sizing.oop.raises = sizing.ip.raises = parse_pcts(j, "raises", "raise size");
    // Legacy shape has no donk concept: donking uses the same sizes.
    sizing.oop.donks = sizing.oop.bets;
  }
  if (j.contains("allin_threshold")) sizing.allin_threshold = j.at("allin_threshold").get<double>();
  if (j.contains("max_raises")) sizing.max_raises = j.at("max_raises").get<int>();
  if (sizing.allin_threshold <= 0 || sizing.allin_threshold > 1.5) {
    fail("allin_threshold must be in (0, 1.5]");
  }
  if (sizing.max_raises < 0 || sizing.max_raises > 20) fail("max_raises must be in [0, 20]");
  return sizing;
}

UpdateConfig parse_algorithm(const json& j) {
  UpdateConfig update;
  const std::string rule = j.value("update", "dcfr");
  if (rule == "rm") update.rule = UpdateRule::RegretMatching;
  else if (rule == "cfr_plus") update.rule = UpdateRule::CfrPlus;
  else if (rule == "dcfr") update.rule = UpdateRule::Dcfr;
  else fail("algorithm.update must be rm | cfr_plus | dcfr, got '" + rule + "'");
  if (j.contains("dcfr")) {
    const json& d = j.at("dcfr");
    update.alpha = d.value("alpha", update.alpha);
    update.beta = d.value("beta", update.beta);
    update.gamma = d.value("gamma", update.gamma);
  }
  const std::string precision = j.value("precision", "f32");
  if (precision == "f32") update.precision = Precision::F32;
  else if (precision == "i16") update.precision = Precision::I16;
  else fail("algorithm.precision must be f32 | i16, got '" + precision + "'");
  return update;
}

}  // namespace

SolveConfig load_config(const std::string& path_text) {
  const std::filesystem::path path(path_text);
  json j;
  try {
    j = json::parse(read_file(path), /*cb=*/nullptr, /*allow_exceptions=*/true,
                    /*ignore_comments=*/true);
  } catch (const json::parse_error& e) {
    fail(std::string("JSON parse error in '") + path_text + "': " + e.what());
  }

  SolveConfig config;
  config.raw = j;
  config.schema = j.value("schema", 1);
  if (config.schema != 1) fail("unsupported config schema " + std::to_string(config.schema));

  config.game = j.value("game", "nlhe");
  if (config.game != "nlhe" && config.game != "nlhe_preflop" && config.game != "kuhn" &&
      config.game != "leduc") {
    fail("game must be nlhe | nlhe_preflop | kuhn | leduc, got '" + config.game + "'");
  }
  // Both NLHE variants share the players array, the chip scale and the range
  // grammar; only the tree above them differs.
  const bool nlhe = config.game == "nlhe" || config.game == "nlhe_preflop";
  const bool preflop = config.game == "nlhe_preflop";

  if (nlhe) {
    config.chip_scale = j.value("chip_scale", 100.0);
    if (config.chip_scale <= 0) fail("chip_scale must be positive");

    if (!j.contains("players")) fail("nlhe solves need a players array");
    for (const json& p : j.at("players")) {
      PlayerConfig player;
      player.seat = p.value("seat", "");
      if (player.seat.empty()) fail("every player needs a seat label");
      player.stack = p.at("stack").get<Chips>();
      if (player.stack < 0) fail("player stacks cannot be negative");
      player.range = p.at("range").get<std::string>();
      if (player.range.rfind("@file:", 0) == 0) {
        const std::filesystem::path range_path = path.parent_path() / player.range.substr(6);
        player.range = read_file(range_path);
      }
      config.players.push_back(std::move(player));
    }
  }

  if (config.game == "nlhe") {
    if (!j.contains("board")) fail("nlhe solves need a board");
    config.board = j.at("board").get<std::string>();
    const auto board_cards = parse_cards(config.board);
    if (board_cards.size() < 3 || board_cards.size() > 5) {
      fail("the board must have 3 (flop solve), 4 (turn), or 5 (river) cards");
    }
    if (static_cast<std::size_t>(std::popcount(cards_mask(board_cards))) != board_cards.size()) {
      fail("board has duplicate cards");
    }

    if (!j.contains("pot")) fail("nlhe solves need a root pot");
    config.pot = j.at("pot").get<Chips>();
    if (config.pot <= 0) fail("pot must be positive");

    if (config.players.size() != 2) {
      fail("postflop solves are 2-player (3+ players preflop is game \"nlhe_preflop\"; "
           "multiway POSTFLOP is a later pass); got " +
           std::to_string(config.players.size()) + " players");
    }
    if (config.players[0].stack != config.players[1].stack) {
      fail("postflop solves require equal stacks (the terminal evaluator is side-pot "
           "capable, but the 2p betting tree does not generate all-in-for-less lines yet)");
    }

    if (!j.contains("bet_sizing")) fail("nlhe solves need bet_sizing");
    const json& bs = j.at("bet_sizing");
    // Sizing is required for the root street and every street after it.
    const std::size_t cards = board_cards.size();
    if (cards <= 3) {
      if (!bs.contains("flop")) fail("a flop solve needs bet_sizing.flop");
      config.flop_sizing = parse_sizing(bs.at("flop"));
    }
    if (cards <= 4) {
      if (!bs.contains("turn")) fail("this solve needs bet_sizing.turn");
      config.turn_sizing = parse_sizing(bs.at("turn"));
    }
    if (!bs.contains("river")) fail("nlhe solves need bet_sizing.river");
    config.river_sizing = parse_sizing(bs.at("river"));

    const std::string aggressor = j.value("preflop_aggressor", "none");
    if (aggressor == "ip") config.preflop_aggressor = Aggressor::Ip;
    else if (aggressor == "oop") config.preflop_aggressor = Aggressor::Oop;
    else if (aggressor == "none") config.preflop_aggressor = Aggressor::None;
    else fail("preflop_aggressor must be ip | oop | none");
  }

  if (preflop) {
    if (j.contains("board")) {
      fail("game \"nlhe_preflop\" has no board: the runout is averaged inside the "
           "all-in showdown, never dealt into the tree");
    }
    if (j.contains("bet_sizing")) {
      fail("game \"nlhe_preflop\" takes preflop.action_set, not bet_sizing");
    }
    if (config.players.size() < 2 || config.players.size() > static_cast<std::size_t>(kMaxSeats)) {
      fail("preflop solves take 2 to " + std::to_string(kMaxSeats) + " players, got " +
           std::to_string(config.players.size()));
    }
    // No equal-stack requirement, unlike the postflop branch: the showdown
    // terminal is layered by commit level, so all-in-for-less is exact.
    for (const PlayerConfig& player : config.players) {
      if (player.stack <= 0) fail("every preflop stack must be positive");
    }

    if (!j.contains("preflop")) fail("game \"nlhe_preflop\" needs a preflop block");
    const json& pf = j.at("preflop");
    PreflopConfig& cfg = config.preflop;
    cfg.small_blind = pf.value("small_blind", Chips{0});
    cfg.big_blind = pf.value("big_blind", Chips{0});
    cfg.dead = pf.value("dead", Chips{0});
    cfg.button = pf.value("button", 0);
    if (cfg.big_blind <= 0) fail("preflop.big_blind must be positive");
    if (cfg.small_blind < 0) fail("preflop.small_blind cannot be negative");
    if (cfg.dead < 0) fail("preflop.dead cannot be negative");
    if (cfg.button < 0 || cfg.button >= static_cast<int>(config.players.size())) {
      fail("preflop.button must index the players array");
    }

    const std::size_t seats = config.players.size();
    cfg.ante.assign(seats, 0);
    if (pf.contains("ante") && !pf.at("ante").is_null()) {
      const json& ante = pf.at("ante");
      if (ante.is_array()) {
        if (ante.size() != seats) {
          fail("preflop.ante must have one entry per player (" + std::to_string(seats) +
               "), got " + std::to_string(ante.size()));
        }
        cfg.ante = ante.get<std::vector<Chips>>();
      } else if (ante.is_number()) {
        cfg.ante.assign(seats, ante.get<Chips>());
      } else {
        fail("preflop.ante must be a number or an array of numbers");
      }
      for (Chips a : cfg.ante) {
        if (a < 0) fail("preflop.ante cannot be negative");
      }
    }

    cfg.action_set = pf.value("action_set", std::string("jam_fold"));
    if (cfg.action_set != "jam_fold") {
      fail("preflop.action_set must be \"jam_fold\"; real preflop sizings land later");
    }

    if (pf.contains("board_sample")) {
      const json& bsm = pf.at("board_sample");
      BoardSampleConfig& sample = cfg.board_sample;
      sample.iter_count = bsm.value("iter_count", sample.iter_count);
      sample.pair_count = bsm.value("pair_count", sample.pair_count);
      sample.seed = bsm.value("seed", sample.seed);
      if (sample.iter_count < 1) fail("preflop.board_sample.iter_count must be positive");
      if (sample.pair_count < 1000) {
        fail("preflop.board_sample.pair_count must be at least 1000; below that the "
             "pairwise equity matrix is too noisy to be worth building");
      }
    }

    // The root pot is derived, not configured, so budget.target_exploitable_pct
    // keeps a pot to be a percent of. It is a tiny number preflop, which is
    // why budget.target_nashconv (chips) is the knob that means something.
    config.pot = cfg.dead + cfg.small_blind + cfg.big_blind;
    for (Chips a : cfg.ante) config.pot += a;
  }

  if (j.contains("algorithm")) {
    config.update = parse_algorithm(j.at("algorithm"));
    if (j.at("algorithm").contains("recalc")) {
      const json& r = j.at("algorithm").at("recalc");
      config.recalc.enabled = r.value("enabled", config.recalc.enabled);
      config.recalc.margin = r.value("margin", config.recalc.margin);
      config.recalc.eps_reach = r.value("eps_reach", config.recalc.eps_reach);
      config.recalc.max_period = r.value("max_period", config.recalc.max_period);
      config.recalc.warmup = r.value("warmup", config.recalc.warmup);
      if (config.recalc.margin < 0.0f || config.recalc.margin > 10000.0f) {
        fail("algorithm.recalc.margin must be in [0, 10000]");
      }
      if (config.recalc.eps_reach < 0.0f || config.recalc.eps_reach > 1.0f) {
        fail("algorithm.recalc.eps_reach is a relative L1 threshold in [0, 1]");
      }
      if (config.recalc.max_period < 1 || config.recalc.max_period > 4096) {
        fail("algorithm.recalc.max_period must be in [1, 4096]");
      }
      if (config.recalc.warmup < 0) fail("algorithm.recalc.warmup cannot be negative");
    }
  }

  if (j.contains("algorithm") && j.at("algorithm").contains("sampling")) {
    const json& s = j.at("algorithm").at("sampling");
    const std::string mode = s.value("mode", "off");
    if (mode == "off") config.sampling.enabled = false;
    else if (mode == "chance") config.sampling.enabled = true;
    else fail("algorithm.sampling.mode must be off | chance, got '" + mode + "'");
    if (config.sampling.enabled && preflop) {
      // There are no chance nodes in a preflop tree to subsample, so this
      // would do exactly nothing while looking like it controlled the board
      // approximation. That knob is preflop.board_sample.
      fail("algorithm.sampling has nothing to do in game \"nlhe_preflop\" - the tree has "
           "no chance nodes. The board approximation is preflop.board_sample.");
    }
    config.sampling.runouts = s.value("runouts", config.sampling.runouts);
    config.sampling.anneal_full_at =
        s.value("anneal_full_at", config.sampling.anneal_full_at);
    if (config.sampling.runouts < 1) fail("algorithm.sampling.runouts must be at least 1");
    if (config.sampling.enabled && config.recalc.enabled &&
        j.at("algorithm").contains("recalc") &&
        j.at("algorithm").at("recalc").value("enabled", true)) {
      // Both skip chance children, and they skip them for incompatible
      // reasons: recalc folds in a cached full-enumeration value while a
      // sampled iteration produces n/m-scaled ones. Refuse rather than
      // silently picking a winner.
      fail("algorithm.sampling and algorithm.recalc cannot both be enabled: the recalc "
           "cache holds full-enumeration values, which a sampled iteration does not "
           "produce. Disable one.");
    }
    // Sampling wins over the recalc DEFAULT (which is on).
    if (config.sampling.enabled) config.recalc.enabled = false;
  }

  if (j.contains("algorithm") && j.at("algorithm").contains("family")) {
    const std::string family = j.at("algorithm").value("family", "vectorized");
    if (family == "vectorized") {
      config.sampled.enabled = false;
    } else if (family == "sampled") {
      config.sampled.enabled = true;
    } else {
      fail("algorithm.family must be vectorized | sampled, got '" + family + "'");
    }
  }
  if (j.contains("algorithm") && j.at("algorithm").contains("sampled")) {
    if (!config.sampled.enabled) {
      // Parameters for a core the config did not select would be dead knobs
      // that look load-bearing.
      fail("algorithm.sampled is set but algorithm.family is not \"sampled\"");
    }
    const json& s = j.at("algorithm").at("sampled");
    config.sampled.seed = s.value("seed", config.sampled.seed);
    config.sampled.batch = s.value("batch", config.sampled.batch);
    config.sampled.lanes = s.value("lanes", config.sampled.lanes);
    if (s.contains("symmetry")) {
      config.sampled.symmetry = s.at("symmetry").get<bool>();
      // Recorded so the solver can refuse an EXPLICIT request on a game
      // with no quotient, while the default silently no-ops there.
      config.sampled.symmetry_explicit = true;
    }
    if (config.sampled.batch < 1 || config.sampled.batch > 1u << 20) {
      fail("algorithm.sampled.batch must be in [1, 1048576]");
    }
    if (config.sampled.lanes < 1 || config.sampled.lanes > 256) {
      fail("algorithm.sampled.lanes must be in [1, 256]");
    }
  }
  if (config.sampled.enabled) {
    // The sampled core deals concrete cards, so it needs a DealGame; today
    // that is the preflop game and the toys. It has no chance-node
    // subsampling, no recalc schedule (nothing is re-enumerated), and QRE
    // has not been ported to it yet - refuse combinations rather than
    // silently ignoring the knobs.
    if (config.game == "nlhe") {
      fail("algorithm.family \"sampled\" does not run postflop nlhe yet - the postflop "
           "game has no deal interface. Use the vectorized family there.");
    }
    if (config.sampling.enabled) {
      fail("algorithm.sampling subsamples chance children inside the VECTORIZED core; "
           "the sampled family deals its own cards. Remove algorithm.sampling.");
    }
    if (j.contains("qre") && j.at("qre").value("mode", "nash") == "qre") {
      fail("qre has not been ported to the sampled family yet; use the vectorized "
           "family for QRE solves.");
    }
    if (j.contains("algorithm") && j.at("algorithm").contains("recalc") &&
        j.at("algorithm").at("recalc").value("enabled", true)) {
      fail("algorithm.recalc is a vectorized-core schedule; the sampled family "
           "re-walks the tree every iteration by design. Remove algorithm.recalc.");
    }
    config.recalc.enabled = false;
  }

  if (j.contains("qre")) {
    const json& q = j.at("qre");
    config.qre_mode = q.value("mode", "nash");
    if (config.qre_mode != "nash" && config.qre_mode != "qre") {
      fail("qre.mode must be nash | qre, got '" + config.qre_mode + "'");
    }
    if (config.qre_mode == "nash" && (q.contains("lambda") || q.contains("anneal"))) {
      // Refuse rather than solve a Nash equilibrium under a config that looks
      // like it asked for a QRE. Silently ignoring lambda would produce a
      // perfectly plausible artifact answering the wrong question.
      fail("qre.lambda / qre.anneal are set but qre.mode is \"nash\", so they would be "
           "silently ignored. Set qre.mode to \"qre\", or remove them.");
    }
    if (config.qre_mode == "qre") {
      config.qre.enabled = true;
      // One lambda per seat. `players` is parsed above for both NLHE variants
      // and before this block runs, which is what makes reading its size here
      // safe - keep that ordering.
      const std::size_t seats = config.players.empty() ? 2 : config.players.size();
      if (!q.contains("lambda") || q.at("lambda").is_null()) {
        fail("qre.mode \"qre\" needs qre.lambda: the per-seat rationality, in units of "
             "1/chips. A scalar applies to both seats; an array gives one per seat.");
      }
      const json& lam = q.at("lambda");
      if (lam.is_array()) {
        if (lam.size() != seats) {
          fail("qre.lambda must have one entry per seat (" + std::to_string(seats) +
               "), got " + std::to_string(lam.size()));
        }
        config.qre.lambda = lam.get<std::vector<double>>();
      } else if (lam.is_number()) {
        config.qre.lambda.assign(seats, lam.get<double>());
      } else {
        fail("qre.lambda must be a number or an array of numbers");
      }
      for (double l : config.qre.lambda) {
        // Not >= 0: the regularizer is (1/lambda) * KL, so 0 is a division by
        // zero rather than the uniform-random limit it looks like. Ask for a
        // small lambda instead.
        if (!(l > 0.0)) {
          fail("every qre.lambda must be strictly positive (lambda -> 0 is the "
               "uniform-random limit; use a small value, not 0)");
        }
      }
      if (q.contains("anneal")) {
        const json& a = q.at("anneal");
        config.qre.anneal_factor = a.value("factor", config.qre.anneal_factor);
        config.qre.anneal_full_at = a.value("full_at", config.qre.anneal_full_at);
        if (config.qre.anneal_factor < 1.0) {
          fail("qre.anneal.factor must be at least 1 (lambda anneals upward, toward Nash)");
        }
        if (config.qre.anneal_factor > 1.0 && config.qre.anneal_full_at == 0) {
          fail("qre.anneal.factor without qre.anneal.full_at would never finish annealing; "
               "set full_at to the iteration lambda should reach its final value");
        }
      }
      config.qre.min_prob = q.value("min_prob", config.qre.min_prob);
      if (!(config.qre.min_prob > 0.0f) || config.qre.min_prob > 0.1f) {
        fail("qre.min_prob is the probability floor applied before log(); it must be in "
             "(0, 0.1]");
      }
    }
  }

  if (j.contains("agents")) {
    const json& agents = j.at("agents");
    if (agents.contains("partition") && !agents.at("partition").is_null()) {
      config.partition = agents.at("partition").get<std::vector<std::vector<int>>>();
    }
    if (agents.contains("partition") && !agents.at("partition").is_null()) {
      for (const auto& group : config.partition) {
        if (group.size() == 2) config.sampled.partition_team = group;
      }
    }
    if (agents.contains("awareness")) {
      config.awareness = agents.at("awareness").get<std::string>();
      if (config.awareness != "aware" && config.awareness != "unaware") {
        fail("agents.awareness must be aware | unaware, got '" + config.awareness + "'");
      }
    }
    config.baseline_iterations = agents.value("baseline_iterations", config.baseline_iterations);
    if (agents.contains("payoff_weights") && !agents.at("payoff_weights").is_null()) {
      fail("agents.payoff_weights is not available yet (collusion lands in a later pass); "
           "use null");
    }
    if (agents.contains("collusion")) {
      config.collusion_mode = agents.at("collusion").value("mode", "none");
      if (config.collusion_mode != "none") {
        fail("agents.collusion.mode '" + config.collusion_mode +
             "' is not available yet (collusion lands in a later pass). Use \"none\".");
      }
    }
  }

  if (j.contains("budget")) {
    const json& budget = j.at("budget");
    config.iterations = budget.value("iterations", config.iterations);
    config.target_nashconv = budget.value("target_nashconv", config.target_nashconv);
    config.target_exploitable_pct =
        budget.value("target_exploitable_pct", config.target_exploitable_pct);
    config.checkpoint_every = budget.value("checkpoint_every", config.checkpoint_every);
    if (config.iterations == 0) fail("budget.iterations must be positive");
    if (config.target_exploitable_pct < 0) fail("budget.target_exploitable_pct cannot be negative");
    if (config.target_exploitable_pct > 0 && !nlhe) {
      fail("budget.target_exploitable_pct needs a pot to be a percent of; toy games "
           "use budget.target_nashconv (chips)");
    }
    if (config.checkpoint_every == 0) config.checkpoint_every = 1000;
  }

  config.isomorphism = j.value("isomorphism", config.isomorphism);
  config.memory_limit_gb = j.value("memory_limit_gb", config.memory_limit_gb);
  if (config.memory_limit_gb <= 0) fail("memory_limit_gb must be positive");

  if (j.contains("output")) {
    const json& output = j.at("output");
    config.output_path = output.value("path", config.output_path);
    config.strategy_quantize_u8 = output.value("strategy_quantize_u8", true);
    config.ev_float32 = output.value("ev_float32", true);
    config.rollups_169 = output.value("rollups_169", true);
  }
  config.threads = j.value("threads", 0);

  return config;
}

std::string config_hash(const SolveConfig& config) {
  // nlohmann::json::dump on an object emits keys in sorted order, which is
  // exactly the canonical form we want to hash.
  return sha256::hex_digest(config.raw.dump());
}

}  // namespace engine
