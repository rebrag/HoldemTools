#include "config/schema.hpp"

#include <bit>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>

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

StreetSizing parse_sizing(const json& j) {
  StreetSizing sizing;
  if (j.contains("bets")) sizing.bets = j.at("bets").get<std::vector<double>>();
  if (j.contains("raises")) sizing.raises = j.at("raises").get<std::vector<double>>();
  if (j.contains("allin_threshold")) sizing.allin_threshold = j.at("allin_threshold").get<double>();
  if (j.contains("max_raises")) sizing.max_raises = j.at("max_raises").get<int>();
  for (double pct : sizing.bets) {
    if (pct <= 0) fail("bet size percentages must be positive");
  }
  for (double pct : sizing.raises) {
    if (pct <= 0) fail("raise size percentages must be positive");
  }
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
  if (config.game != "nlhe" && config.game != "kuhn" && config.game != "leduc") {
    fail("game must be nlhe | kuhn | leduc, got '" + config.game + "'");
  }

  if (config.game == "nlhe") {
    if (!j.contains("board")) fail("nlhe solves need a board");
    config.board = j.at("board").get<std::string>();
    const auto board_cards = parse_cards(config.board);
    if (board_cards.size() != 5) {
      fail("this pass solves rivers only: the board must have exactly 5 cards "
           "(turn and flop solving land in a later pass)");
    }
    if (static_cast<std::size_t>(std::popcount(cards_mask(board_cards))) != board_cards.size()) {
      fail("board has duplicate cards");
    }

    if (!j.contains("pot")) fail("nlhe solves need a root pot");
    config.pot = j.at("pot").get<Chips>();
    if (config.pot <= 0) fail("pot must be positive");
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
        const std::filesystem::path range_path =
            path.parent_path() / player.range.substr(6);
        player.range = read_file(range_path);
      }
      config.players.push_back(std::move(player));
    }
    if (config.players.size() != 2) {
      fail("this pass solves 2-player games only (multiway lands in a later pass); got " +
           std::to_string(config.players.size()) + " players");
    }
    if (config.players[0].stack != config.players[1].stack) {
      fail("this pass requires equal stacks (the terminal evaluator is side-pot capable, "
           "but the 2p betting tree does not generate all-in-for-less lines yet)");
    }

    if (!j.contains("bet_sizing") || !j.at("bet_sizing").contains("river")) {
      fail("nlhe solves need bet_sizing.river");
    }
    config.river_sizing = parse_sizing(j.at("bet_sizing").at("river"));
  }

  if (j.contains("algorithm")) config.update = parse_algorithm(j.at("algorithm"));

  if (j.contains("qre")) {
    config.qre_mode = j.at("qre").value("mode", "nash");
    if (config.qre_mode != "nash") {
      fail("qre.mode '" + config.qre_mode + "' is not available yet: QRE lands in a later "
           "pass (M7). Use \"nash\".");
    }
  }

  if (j.contains("agents")) {
    const json& agents = j.at("agents");
    if (agents.contains("partition") && !agents.at("partition").is_null()) {
      config.partition = agents.at("partition").get<std::vector<std::vector<int>>>();
    }
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
    if (config.target_exploitable_pct > 0 && config.game != "nlhe") {
      fail("budget.target_exploitable_pct needs a pot to be a percent of; toy games "
           "use budget.target_nashconv (chips)");
    }
    if (config.checkpoint_every == 0) config.checkpoint_every = 1000;
  }

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
