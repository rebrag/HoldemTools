#include <doctest/doctest.h>

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "config/schema.hpp"
#include "eval/hand_eval.hpp"
#include "game/nlhe_river.hpp"
#include "game/toy/kuhn.hpp"
#include "io/artifact_reader.hpp"
#include "io/artifact_store.hpp"
#include "io/artifact_writer.hpp"
#include "io/dump_streets.hpp"
#include "solver/cfr.hpp"

using namespace engine;
using nlohmann::json;

namespace {

// LocalStore that counts range reads. dump-streets reads from several
// threads, hence the atomics.
class CountingStore final : public ArtifactStore {
 public:
  void open_write(const std::string& path) override { inner_.open_write(path); }
  void write(const void* data, std::size_t size) override { inner_.write(data, size); }
  std::uint64_t tell() override { return inner_.tell(); }
  void seek(std::uint64_t offset) override { inner_.seek(offset); }
  void close_write() override { inner_.close_write(); }
  std::vector<std::uint8_t> read_range(const std::string& path, std::uint64_t offset,
                                       std::uint64_t length) override {
    reads.fetch_add(1);
    bytes.fetch_add(length);
    return inner_.read_range(path, offset, length);
  }
  std::uint64_t size(const std::string& path) override { return inner_.size(path); }

  std::atomic<std::uint64_t> reads{0};
  std::atomic<std::uint64_t> bytes{0};

 private:
  LocalStore inner_;
};

constexpr const char* kBoard = "Qs Jh 2h";

// A small flop tree with every boundary kind: check-check streets, a bet and
// call into the turn, and an all-in and call that runs out with no decisions.
SolveConfig flop_config() {
  SolveConfig config;
  config.game = "nlhe";
  config.board = kBoard;
  config.pot = 100;
  config.chip_scale = 1.0;
  config.players = {{"SB", 120, "AA,KK,QQ,AKs"}, {"BTN", 120, "JJ,TT,AQs,KQs,AhKh"}};
  for (StreetSizing* s : {&config.flop_sizing, &config.turn_sizing, &config.river_sizing}) {
    s->oop.bets = {50.0, 10000.0};
    s->ip.bets = {50.0, 10000.0};
    s->max_raises = 0;
  }
  config.strategy_quantize_u8 = false;
  config.ev_float32 = true;
  config.rollups_169 = false;
  config.raw = json{{"game", "nlhe"}, {"board", kBoard}};
  return config;
}

const std::string& artifact_path() {
  static const std::string path = [] {
    const SolveConfig config = flop_config();
    NlhePostflopGame game(config);
    CfrSolver solver(game, UpdateConfig{}, 4);
    solver.run(40);
    SolveStats stats;
    stats.iterations = solver.iteration();
    const std::string p =
        (std::filesystem::temp_directory_path() / "engine_dump_streets_flop.hta").string();
    LocalStore store;
    write_artifact(store, p, game, solver, config, stats);
    return p;
  }();
  return path;
}

std::string out_dir(const std::string& tag) {
  const auto dir = std::filesystem::temp_directory_path() / ("engine_dump_streets_" + tag);
  std::filesystem::remove_all(dir);
  return dir.string();
}

json read_json(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  REQUIRE(in);
  return json::parse(in);
}

std::string slurp(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// Colon id of a node, from the node table alone (independent of the dumper).
std::string colon_id(const ArtifactReader& reader, std::uint32_t id) {
  std::vector<std::string> labels;
  const auto& nodes = reader.nodes();
  for (std::uint32_t at = id; at != 0; at = nodes[at].parent_id) {
    const ArtifactNodeRecord& n = nodes[at];
    labels.push_back(n.action_kind == 1   ? "f"
                     : n.action_kind == 2 ? "c"
                     : n.action_kind == 3 ? "b" + std::to_string(n.action_amount)
                                          : card_to_string(static_cast<Card>(n.dealt_card)));
  }
  std::string s = "r:0";
  for (auto it = labels.rbegin(); it != labels.rend(); ++it) s += ":" + *it;
  return s;
}

// Brute force: hand h's equity and matchups against `villain` at a node on
// `board`, enumerating every runout and every opponent hand.
void brute_equity(const std::vector<Card>& board, int hero, const std::map<int, double>& villain,
                  double& eq, double& mu) {
  const Combo& hc = canonical_combos()[static_cast<std::size_t>(hero)];
  std::uint64_t used = cards_mask(board);
  std::vector<std::vector<Card>> runouts;
  std::vector<Card> deck;
  for (int c = 0; c < kNumCards; ++c) {
    if (!(used & (1ULL << c))) deck.push_back(static_cast<Card>(c));
  }
  const std::size_t need = 5 - board.size();
  if (need == 0) runouts.push_back({});
  if (need == 1) {
    for (Card c : deck) runouts.push_back({c});
  }
  if (need == 2) {
    for (std::size_t a = 0; a < deck.size(); ++a) {
      for (std::size_t b = a + 1; b < deck.size(); ++b) runouts.push_back({deck[a], deck[b]});
    }
  }
  double num = 0.0, den = 0.0;
  int count = 0;
  for (const auto& r : runouts) {
    std::vector<Card> full = board;
    full.insert(full.end(), r.begin(), r.end());
    const std::uint64_t fm = cards_mask(full);
    const std::uint64_t hm = (1ULL << hc.hi) | (1ULL << hc.lo);
    if (fm & hm) continue;
    ++count;
    Card cards[7];
    for (int i = 0; i < 5; ++i) cards[i] = full[static_cast<std::size_t>(i)];
    cards[5] = hc.hi;
    cards[6] = hc.lo;
    const std::uint32_t mine = evaluate7(cards, 7);
    for (const auto& [o, w] : villain) {
      const Combo& oc = canonical_combos()[static_cast<std::size_t>(o)];
      const std::uint64_t om = (1ULL << oc.hi) | (1ULL << oc.lo);
      if ((om & fm) || (om & hm)) continue;
      cards[5] = oc.hi;
      cards[6] = oc.lo;
      const std::uint32_t theirs = evaluate7(cards, 7);
      num += w * (mine > theirs ? 1.0 : mine == theirs ? 0.5 : 0.0);
      den += w;
    }
  }
  eq = den > 0.0 ? num / den : std::nan("");
  mu = count > 0 ? den / count : 0.0;
}

}  // namespace

TEST_CASE("dump-streets: colon ids, street membership and boundaries") {
  LocalStore store;
  const std::string dir = out_dir("through");
  DumpStreetsOptions opt;
  opt.out_dir = dir;
  opt.through = Street::Turn;
  const json index = dump_streets(store, artifact_path(), opt);
  ArtifactReader reader(store, artifact_path());

  // The flop street, then one per turn card dealt into a decision.
  std::size_t turn_seeds = 0;
  for (const ArtifactNodeRecord& n : reader.nodes()) {
    if (n.kind == 0 && n.action_kind == 4 && n.street == 2) ++turn_seeds;
  }
  const json& streets = index.at("streets");
  REQUIRE(streets.size() == 1 + turn_seeds);
  CHECK(streets[0].at("seed") == "r:0");
  CHECK(streets[0].at("street") == "flop");
  CHECK(streets[0].at("file") == "r.0.json");
  CHECK(streets[0].at("board") == json::array({"Qs", "Jh", "2h"}));
  CHECK(index.at("hands").size() == reader.hand_dicts()[0].size());

  bool saw_runout = false, saw_dealt = false;
  for (const json& s : streets) {
    const json doc = read_json(dir + "/" + s.at("file").get<std::string>());
    CHECK(doc.at("seed") == s.at("seed"));
    std::set<std::string> ids;
    std::uint32_t last = 0;
    int decisions = 0;
    for (const json& n : doc.at("nodes")) {
      const std::uint32_t id = n.at("node_id");
      CHECK((ids.empty() || id > last));  // node-id order
      last = id;
      // Every id is the colon path the node table gives.
      CHECK(n.at("id") == colon_id(reader, id));
      ids.insert(n.at("id").get<std::string>());
      const std::string kind = n.at("kind");
      if (kind == "decision") {
        ++decisions;
        // Decisions never cross a deal: they sit on the seed's street.
        CHECK(reader.nodes()[id].street == (s.at("street") == "flop" ? 1 : 2));
      }
      if (kind == "chance") {
        const bool has = n.at("has_decisions");
        // b120:c is the flop all-in and call: a runout with nothing to decide.
        if (n.at("id") == "r:0:b120:c") {
          CHECK_FALSE(has);
          saw_runout = true;
        }
        if (n.at("id") == "r:0:c:c") {
          CHECK(has);
          saw_dealt = true;
        }
      }
    }
    CHECK(decisions == s.at("decision_nodes").get<int>());
    // Every child of an emitted decision is emitted.
    for (const json& n : doc.at("nodes")) {
      if (n.at("kind") != "decision") continue;
      for (const json& c : n.at("children")) CHECK(ids.count(c.get<std::string>()) == 1);
      CHECK(n.at("actions").size() == n.at("children").size());
    }
  }
  CHECK(saw_runout);
  CHECK(saw_dealt);
}

TEST_CASE("dump-streets: rows equal ArtifactReader::read_node") {
  LocalStore store;
  const std::string dir = out_dir("rows");
  DumpStreetsOptions opt;
  opt.out_dir = dir;
  opt.through = Street::Flop;
  dump_streets(store, artifact_path(), opt);
  ArtifactReader reader(store, artifact_path());
  const json doc = read_json(dir + "/r.0.json");
  int checked = 0;
  for (const json& n : doc.at("nodes")) {
    if (n.at("kind") != "decision") continue;
    const ArtifactNodeData data = reader.read_node(n.at("node_id"));
    CHECK(n.at("actor") == data.actor);
    for (int seat = 0; seat < 2; ++seat) {
      const json& js = n.at("seats")[static_cast<std::size_t>(seat)];
      const ArtifactSeatData& sd = data.seats[static_cast<std::size_t>(seat)];
      REQUIRE(js.at("idx").size() == sd.idx.size());
      for (std::size_t i = 0; i < sd.idx.size(); ++i) {
        CHECK(js.at("idx")[i] == sd.idx[i]);
        CHECK(js.at("reach")[i].get<double>() == doctest::Approx(sd.reach[i]).epsilon(1e-6));
        CHECK(js.at("ev")[i].get<double>() == doctest::Approx(sd.ev[i]).epsilon(1e-6).scale(1.0));
      }
      CHECK_FALSE(js.contains("eq"));
    }
    const std::size_t rows = data.seats[data.actor].idx.size();
    for (int a = 0; a < data.num_actions; ++a) {
      for (std::size_t h = 0; h < rows; ++h) {
        const std::size_t cell = h * data.num_actions + static_cast<std::size_t>(a);
        CHECK(n.at("strategy")[static_cast<std::size_t>(a)][h].get<double>() ==
              doctest::Approx(data.strategy[cell]).epsilon(1e-6).scale(1.0));
        CHECK(n.at("action_ev")[static_cast<std::size_t>(a)][h].get<double>() ==
              doctest::Approx(data.action_ev[cell]).epsilon(1e-6).scale(1.0));
      }
    }
    ++checked;
  }
  CHECK(checked > 0);
}

TEST_CASE("dump-streets --equity matches brute-force enumeration on flop, turn and river") {
  LocalStore store;
  ArtifactReader reader(store, artifact_path());
  // One street of each kind: the root, a turn after check-check, and a river
  // after check-check twice.
  std::string turn_seed, river_seed;
  for (const ArtifactNodeRecord& n : reader.nodes()) {
    if (n.kind != 0 || n.action_kind != 4) continue;
    const std::string id = colon_id(reader, n.node_id);
    if (turn_seed.empty() && n.street == 2 && id.rfind("r:0:c:c:", 0) == 0) turn_seed = id;
    if (river_seed.empty() && n.street == 3 && id.find(":b") == std::string::npos) river_seed = id;
  }
  REQUIRE_FALSE(turn_seed.empty());
  REQUIRE_FALSE(river_seed.empty());

  const std::string dir = out_dir("equity");
  DumpStreetsOptions opt;
  opt.out_dir = dir;
  opt.seeds = {"r:0", turn_seed, river_seed};
  opt.equity = true;
  const json index = dump_streets(store, artifact_path(), opt);
  REQUIRE(index.at("streets").size() == 3);
  const std::vector<std::uint16_t>& dict = reader.hand_dicts()[0];
  int compared = 0;
  for (const json& s : index.at("streets")) {
    std::vector<Card> board;
    for (const json& c : s.at("board")) {
      const std::string t = c;
      board.push_back(*parse_card(t[0], t[1]));
    }
    const json doc = read_json(dir + "/" + s.at("file").get<std::string>());
    for (const json& n : doc.at("nodes")) {
      if (n.at("kind") != "decision") continue;
      for (int seat = 0; seat < 2; ++seat) {
        const json& hero = n.at("seats")[static_cast<std::size_t>(seat)];
        const json& vill = n.at("seats")[static_cast<std::size_t>(1 - seat)];
        // The stored f32 reach, not the dump's 7-decimal copy: tiny reaches
        // lose relative precision in the rounding.
        const ArtifactNodeData data = reader.read_node(n.at("node_id"));
        const ArtifactSeatData& vs = data.seats[static_cast<std::size_t>(1 - seat)];
        REQUIRE(vs.idx.size() == vill.at("idx").size());
        std::map<int, double> villain;
        for (std::size_t i = 0; i < vs.idx.size(); ++i) villain[dict[vs.idx[i]]] = vs.reach[i];
        for (std::size_t i = 0; i < hero.at("idx").size(); ++i) {
          double eq = 0.0, mu = 0.0;
          brute_equity(board, dict[hero.at("idx")[i].get<std::size_t>()], villain, eq, mu);
          if (std::isnan(eq)) {
            CHECK(hero.at("eq")[i].is_null());
          } else {
            // The evaluator's per-runout sums are f32; 1e-6 absolute is the
            // display precision and well above that error.
            CHECK(std::abs(hero.at("eq")[i].get<double>() - eq) < 1e-6);
          }
          CHECK(hero.at("mu")[i].get<double>() == doctest::Approx(mu).epsilon(1e-6));
          ++compared;
        }
      }
    }
  }
  CHECK(compared > 50);
}

TEST_CASE("dump-streets: a river seed reads only that street's blobs") {
  CountingStore boot;
  { ArtifactReader reader(boot, artifact_path()); }
  const std::uint64_t bootstrap = boot.reads.load();

  LocalStore plain;
  ArtifactReader reader(plain, artifact_path());
  std::string river_seed;
  for (const ArtifactNodeRecord& n : reader.nodes()) {
    if (n.kind == 0 && n.action_kind == 4 && n.street == 3) {
      river_seed = colon_id(reader, n.node_id);
      break;
    }
  }
  REQUIRE_FALSE(river_seed.empty());

  CountingStore counting;
  DumpStreetsOptions opt;
  opt.out_dir = out_dir("river");
  opt.seeds = {river_seed};
  opt.equity = true;
  const json index = dump_streets(counting, artifact_path(), opt);
  REQUIRE(index.at("streets").size() == 1);
  CHECK(index.at("streets")[0].at("street") == "river");
  const std::uint64_t decisions = index.at("streets")[0].at("decision_nodes");
  CHECK(decisions > 0);
  CHECK(counting.reads.load() == bootstrap + decisions);
}

TEST_CASE("dump-streets output does not depend on the thread count") {
  LocalStore store;
  std::string files[2];
  const int threads[2] = {1, 8};
  for (int i = 0; i < 2; ++i) {
    DumpStreetsOptions opt;
    opt.out_dir = out_dir("threads" + std::to_string(threads[i]));
    opt.through = Street::Turn;
    opt.equity = true;
    opt.threads = threads[i];
    const json index = dump_streets(store, artifact_path(), opt);
    for (const json& s : index.at("streets")) files[i] += slurp(opt.out_dir + "/" + s.at("file").get<std::string>());
  }
  CHECK(files[0] == files[1]);
}

TEST_CASE("dump-streets refuses what it cannot describe") {
  // A toy artifact: not hold'em.
  toy::KuhnGame game;
  CfrSolver solver(game, UpdateConfig{});
  solver.run(10);
  SolveConfig config;
  config.game = "kuhn";
  config.rollups_169 = false;
  config.raw = json{{"game", "kuhn"}};
  SolveStats stats;
  const std::string path = (std::filesystem::temp_directory_path() / "engine_dump_streets_kuhn.hta").string();
  LocalStore store;
  write_artifact(store, path, game, solver, config, stats);
  DumpStreetsOptions opt;
  opt.out_dir = out_dir("refuse");
  opt.through = Street::Flop;
  CHECK_THROWS_WITH_AS(dump_streets(store, path, opt), doctest::Contains("game is 'kuhn'"),
                       std::runtime_error);

  // Bad seeds and option combinations.
  DumpStreetsOptions bad;
  bad.out_dir = out_dir("refuse2");
  bad.seeds = {"r:0:b77"};
  CHECK_THROWS_WITH_AS(dump_streets(store, artifact_path(), bad), doctest::Contains("no child"),
                       std::runtime_error);
  bad.seeds = {"r:0:c"};  // a decision, but not a street seed
  CHECK_THROWS_WITH_AS(dump_streets(store, artifact_path(), bad), doctest::Contains("does not start a street"),
                       std::runtime_error);
  bad.through = Street::Turn;
  CHECK_THROWS(dump_streets(store, artifact_path(), bad));
}
