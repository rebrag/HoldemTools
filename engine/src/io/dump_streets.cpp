#include "io/dump_streets.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "cards/cards.hpp"
#include "cards/combos.hpp"
#include "eval/terminal.hpp"
#include "io/artifact_reader.hpp"
#include "util/parallel.hpp"

namespace engine {

namespace {

using nlohmann::json;

constexpr std::uint32_t kNone = 0xFFFFFFFFu;
constexpr std::uint8_t kDecision = 0, kChance = 1;
constexpr std::uint8_t kFold = 1, kCheckCall = 2, kBet = 3, kDeal = 4;

// 7 decimals, like dump-json --fields detail.
double round7(double v) { return std::round(v * 1e7) / 1e7; }

const char* street_name(std::uint8_t street) {
  switch (street) {
    case 1: return "flop";
    case 2: return "turn";
    case 3: return "river";
    default: return "preflop";
  }
}

std::string edge_label(const ArtifactNodeRecord& n) {
  switch (n.action_kind) {
    case kFold: return "f";
    case kCheckCall: return "c";
    case kBet: return "b" + std::to_string(n.action_amount);
    case kDeal: return card_to_string(static_cast<Card>(n.dealt_card));
    default: return "";
  }
}

std::string file_name_of(const std::string& seed) {
  std::string name = seed;
  std::replace(name.begin(), name.end(), ':', '.');
  return name + ".json";
}

struct StreetDoc {
  std::uint32_t seed = 0;
  std::string seed_id;
  std::vector<Card> board;
  std::vector<std::uint32_t> nodes;            // emitted, ascending node id
  std::map<std::uint32_t, std::string> ids;    // node id -> colon id
  std::vector<std::uint32_t> decisions;        // decision subset, ascending
  std::vector<std::uint64_t> runouts;          // 5-card board masks (equity only)
};

class StreetDumper {
 public:
  StreetDumper(ArtifactStore& store, const std::string& path, const DumpStreetsOptions& options)
      : reader_(store, path), options_(options), pool_(resolve_thread_count(options.threads)) {
    validate();
    records_ = &reader_.nodes();
    for (std::uint16_t id : reader_.hand_dicts()[0]) {
      universe_.push_back(canonical_combos()[id]);
      hand_names_.push_back(combo_to_string(id));
    }
    root_board_ = parse_cards(reader_.metadata().value("board", ""));
  }

  json run() {
    std::vector<StreetDoc> streets = select_streets();
    for (StreetDoc& s : streets) collect(s);
    if (options_.equity) build_evaluators(streets);

    std::filesystem::create_directories(options_.out_dir);
    // One task per street: each reads its own blobs, computes, and writes its
    // own file, so nothing is shared between tasks but the immutable reader
    // and evaluators.
    pool_.parallel_for(static_cast<int>(streets.size()),
                       [&](int i) { write_street(streets[static_cast<std::size_t>(i)]); });

    json index;
    index["metadata"] = reader_.metadata();
    index["hands"] = hand_names_;
    json list = json::array();
    for (const StreetDoc& s : streets) {
      json cards = json::array();
      for (Card c : s.board) cards.push_back(card_to_string(c));
      list.push_back({{"seed", s.seed_id},
                      {"street", street_name((*records_)[s.seed].street)},
                      {"board", std::move(cards)},
                      {"decision_nodes", s.decisions.size()},
                      {"file", file_name_of(s.seed_id)}});
    }
    index["streets"] = std::move(list);
    write_json(options_.out_dir + "/streets.json", index);
    return index;
  }

 private:
  void validate() const {
    const json& meta = reader_.metadata();
    const auto refuse = [](const std::string& why) {
      throw std::runtime_error("dump-streets needs a heads-up nlhe postflop artifact with per-hand "
                               "vectorized exports: " + why);
    };
    if (meta.value("game", "") != "nlhe") refuse("game is '" + meta.value("game", "") + "'");
    if (meta.value("hand_universe", "") != "nlhe_combos_1326") refuse("not a hold'em hand universe");
    if (reader_.hand_dicts().size() != 2) {
      refuse(std::to_string(reader_.hand_dicts().size()) + " seats");
    }
    if (reader_.bucketed() || meta.value("export", "per_hand") != "per_hand") refuse("bucketed export");
    if (!meta.value("per_hand_ev", true)) refuse("no per-hand EVs");
    if (meta.value("solver_family", "vectorized") != "vectorized") {
      refuse("solver_family is '" + meta.value("solver_family", "") + "'");
    }
    if (reader_.hand_dicts()[0] != reader_.hand_dicts()[1]) {
      refuse("the two seats' hand dictionaries differ");
    }
    if (reader_.nodes().empty() || reader_.nodes()[0].kind != kDecision) refuse("no root decision");
  }

  // Walk the node table from the root: the colon id of any node.
  std::string colon_id(std::uint32_t id) const {
    std::vector<std::string> labels;
    for (std::uint32_t at = id; at != 0 && at != kNone; at = (*records_)[at].parent_id) {
      labels.push_back(edge_label((*records_)[at]));
    }
    std::string out = "r:0";
    for (auto it = labels.rbegin(); it != labels.rend(); ++it) out += ":" + *it;
    return out;
  }

  std::uint32_t resolve(const std::string& colon) const {
    std::vector<std::string> tokens;
    std::size_t start = 0;
    for (std::size_t at; (at = colon.find(':', start)) != std::string::npos; start = at + 1) {
      tokens.push_back(colon.substr(start, at - start));
    }
    tokens.push_back(colon.substr(start));
    if (tokens.size() < 2 || tokens[0] != "r" || tokens[1] != "0") {
      throw std::runtime_error("seed '" + colon + "' is not a colon id (must start r:0)");
    }
    std::uint32_t node = 0;
    for (std::size_t t = 2; t < tokens.size(); ++t) {
      const ArtifactNodeRecord& n = (*records_)[node];
      std::uint32_t next = kNone;
      for (std::uint16_t c = 0; c < n.num_children && n.first_child != kNone; ++c) {
        if (edge_label((*records_)[n.first_child + c]) == tokens[t]) {
          next = n.first_child + c;
          break;
        }
      }
      if (next == kNone) {
        throw std::runtime_error("seed '" + colon + "': no child '" + tokens[t] + "' at " +
                                 colon_id(node));
      }
      node = next;
    }
    const ArtifactNodeRecord& seed = (*records_)[node];
    if (seed.kind != kDecision || (node != 0 && seed.action_kind != kDeal)) {
      throw std::runtime_error("seed '" + colon + "' does not start a street (it must be r:0 or a "
                               "dealt card followed by a decision)");
    }
    return node;
  }

  std::vector<StreetDoc> select_streets() const {
    std::vector<std::uint32_t> seeds;
    if (options_.through) {
      const std::uint8_t limit = static_cast<std::uint8_t>(*options_.through);
      const std::uint8_t root_street = (*records_)[0].street;
      if (root_street > limit) {
        throw std::runtime_error(std::string("--through ") + street_name(limit) +
                                 " is before this artifact's root street (" +
                                 street_name(root_street) + ")");
      }
      seeds.push_back(0);
      for (const ArtifactNodeRecord& n : *records_) {
        if (n.node_id != 0 && n.kind == kDecision && n.action_kind == kDeal && n.street <= limit) {
          seeds.push_back(n.node_id);
        }
      }
    } else {
      for (const std::string& s : options_.seeds) seeds.push_back(resolve(s));
      std::sort(seeds.begin(), seeds.end());
      seeds.erase(std::unique(seeds.begin(), seeds.end()), seeds.end());
    }
    std::vector<StreetDoc> streets(seeds.size());
    for (std::size_t i = 0; i < seeds.size(); ++i) {
      StreetDoc& s = streets[i];
      s.seed = seeds[i];
      s.seed_id = colon_id(s.seed);
      s.board = root_board_;
      std::vector<Card> dealt;
      for (std::uint32_t at = s.seed; at != 0 && at != kNone; at = (*records_)[at].parent_id) {
        if ((*records_)[at].action_kind == kDeal) dealt.push_back(static_cast<Card>((*records_)[at].dealt_card));
      }
      s.board.insert(s.board.end(), dealt.rbegin(), dealt.rend());
    }
    return streets;
  }

  // The seed's decisions and every child of them; chance children are the
  // street's boundary and are not descended.
  void collect(StreetDoc& s) const {
    std::vector<std::uint32_t> stack{s.seed};
    s.ids[s.seed] = s.seed_id;
    while (!stack.empty()) {
      const std::uint32_t id = stack.back();
      stack.pop_back();
      s.nodes.push_back(id);
      const ArtifactNodeRecord& n = (*records_)[id];
      if (n.kind != kDecision) continue;
      s.decisions.push_back(id);
      for (std::uint16_t c = 0; c < n.num_children; ++c) {
        const std::uint32_t child = n.first_child + c;
        s.ids[child] = s.ids[id] + ":" + edge_label((*records_)[child]);
        stack.push_back(child);
      }
    }
    std::sort(s.nodes.begin(), s.nodes.end());
    std::sort(s.decisions.begin(), s.decisions.end());
  }

  void build_evaluators(std::vector<StreetDoc>& streets) {
    std::vector<std::uint64_t> masks;
    for (StreetDoc& s : streets) {
      if (s.decisions.empty()) continue;
      const std::uint64_t board = cards_mask(s.board);
      if (s.board.size() == 5) {
        s.runouts.push_back(board);
      } else {
        for (int a = 0; a < kNumCards; ++a) {
          if (board & (1ULL << a)) continue;
          if (s.board.size() == 4) {
            s.runouts.push_back(board | (1ULL << a));
            continue;
          }
          for (int b = a + 1; b < kNumCards; ++b) {
            if (board & (1ULL << b)) continue;
            s.runouts.push_back(board | (1ULL << a) | (1ULL << b));
          }
        }
      }
      masks.insert(masks.end(), s.runouts.begin(), s.runouts.end());
    }
    std::sort(masks.begin(), masks.end());
    masks.erase(std::unique(masks.begin(), masks.end()), masks.end());
    evaluators_.resize(masks.size());
    pool_.parallel_for(static_cast<int>(masks.size()), [&](int i) {
      std::vector<Card> cards;
      for (int c = 0; c < kNumCards; ++c) {
        if (masks[static_cast<std::size_t>(i)] & (1ULL << c)) cards.push_back(static_cast<Card>(c));
      }
      evaluators_[static_cast<std::size_t>(i)] = std::make_unique<RiverEvaluator>(cards, universe_);
    });
    for (std::size_t i = 0; i < masks.size(); ++i) evaluator_of_[masks[i]] = i;
  }

  struct Equity {
    std::vector<double> eq;  // NaN = no matchups
    std::vector<double> mu;
  };

  // Equity of every hand in `hero.idx` against `villain`'s reach, averaged
  // over the street's runouts in ascending board-mask order.
  Equity equity(const StreetDoc& s, const ArtifactSeatData& hero, const ArtifactSeatData& villain) const {
    const std::size_t hands = universe_.size();
    std::vector<float> opp(hands, 0.0f);
    for (std::size_t i = 0; i < villain.idx.size(); ++i) opp[villain.idx[i]] = villain.reach[i];
    std::vector<double> num(hands, 0.0), den(hands, 0.0);
    std::vector<int> count(hands, 0);
    std::vector<float> win(hands), compat(hands);
    for (std::uint64_t mask : s.runouts) {
      const RiverEvaluator& ev = *evaluators_[evaluator_of_.at(mask)];
      ev.showdown_2p(opp.data(), 1.0, 0.0, win.data());
      ev.compat_reach(opp.data(), compat.data());
      for (std::uint32_t h : hero.idx) {
        if (!ev.valid(static_cast<int>(h))) continue;
        num[h] += win[h];
        den[h] += compat[h];
        ++count[h];
      }
    }
    Equity out;
    out.eq.reserve(hero.idx.size());
    out.mu.reserve(hero.idx.size());
    for (std::uint32_t h : hero.idx) {
      out.eq.push_back(den[h] > 0.0 ? num[h] / den[h] : std::nan(""));
      out.mu.push_back(count[h] > 0 ? den[h] / count[h] : 0.0);
    }
    return out;
  }

  json entry_base(const StreetDoc& s, std::uint32_t id, const char* kind) const {
    const ArtifactNodeRecord& n = (*records_)[id];
    json j;
    j["id"] = s.ids.at(id);
    j["node_id"] = id;
    j["kind"] = kind;
    j["pot"] = n.pot;
    j["commit"] = {n.commit[0], n.commit[1]};
    return j;
  }

  json decision_entry(const StreetDoc& s, std::uint32_t id) const {
    const ArtifactNodeRecord& n = (*records_)[id];
    const ArtifactNodeData data = reader_.read_node(id);
    json j = entry_base(s, id, "decision");
    j["actor"] = data.actor;
    json actions = json::array(), children = json::array();
    for (std::uint16_t c = 0; c < n.num_children; ++c) {
      actions.push_back(edge_label((*records_)[n.first_child + c]));
      children.push_back(s.ids.at(n.first_child + c));
    }
    j["actions"] = std::move(actions);
    j["children"] = std::move(children);

    std::vector<Equity> eq(2);
    if (options_.equity) {
      for (int seat = 0; seat < 2; ++seat) eq[seat] = equity(s, data.seats[seat], data.seats[1 - seat]);
    }
    json seats = json::array();
    for (int seat = 0; seat < 2; ++seat) {
      const ArtifactSeatData& sd = data.seats[static_cast<std::size_t>(seat)];
      json js;
      js["idx"] = sd.idx;
      json reach = json::array(), ev = json::array();
      for (float r : sd.reach) reach.push_back(round7(r));
      for (float e : sd.ev) ev.push_back(round7(e));
      js["reach"] = std::move(reach);
      js["ev"] = std::move(ev);
      if (options_.equity) {
        json e = json::array(), m = json::array();
        for (double v : eq[seat].eq) e.push_back(std::isnan(v) ? json(nullptr) : json(round7(v)));
        for (double v : eq[seat].mu) m.push_back(round7(v));
        js["eq"] = std::move(e);
        js["mu"] = std::move(m);
      }
      seats.push_back(std::move(js));
    }
    j["seats"] = std::move(seats);

    // [action][position in the actor's idx list]; the blob is [hand][action].
    const std::size_t rows = data.seats[data.actor].idx.size();
    const int actions_n = data.num_actions;
    json strategy = json::array(), action_ev = json::array();
    for (int a = 0; a < actions_n; ++a) {
      json srow = json::array(), erow = json::array();
      for (std::size_t h = 0; h < rows; ++h) {
        const std::size_t cell = h * static_cast<std::size_t>(actions_n) + static_cast<std::size_t>(a);
        srow.push_back(round7(data.strategy[cell]));
        erow.push_back(round7(data.action_ev[cell]));
      }
      strategy.push_back(std::move(srow));
      action_ev.push_back(std::move(erow));
    }
    j["strategy"] = std::move(strategy);
    j["action_ev"] = std::move(action_ev);
    return j;
  }

  void write_street(const StreetDoc& s) const {
    std::vector<json> entries(s.nodes.size());
    // Decision entries are the expensive ones (a blob read plus, with
    // equity, a sweep per runout); fan them out, then assemble in order.
    pool_.parallel_for(static_cast<int>(s.nodes.size()), [&](int i) {
      const std::uint32_t id = s.nodes[static_cast<std::size_t>(i)];
      const ArtifactNodeRecord& n = (*records_)[id];
      json& j = entries[static_cast<std::size_t>(i)];
      if (n.kind == kDecision) {
        j = decision_entry(s, id);
      } else if (n.kind == kChance) {
        j = entry_base(s, id, "chance");
        bool decisions = false;
        for (std::uint16_t c = 0; c < n.num_children; ++c) {
          if ((*records_)[n.first_child + c].kind == kDecision) decisions = true;
        }
        j["has_decisions"] = decisions;
      } else {
        j = entry_base(s, id, "terminal");
        j["terminal"] = n.terminal_kind == 1 ? "fold" : n.terminal_kind == 2 ? "showdown" : "depth_limit";
      }
    });
    json doc;
    doc["seed"] = s.seed_id;
    doc["street"] = street_name((*records_)[s.seed].street);
    json cards = json::array();
    for (Card c : s.board) cards.push_back(card_to_string(c));
    doc["board"] = std::move(cards);
    doc["nodes"] = std::move(entries);
    write_json(options_.out_dir + "/" + file_name_of(s.seed_id), doc);
  }

  static void write_json(const std::string& path, const json& doc) {
    std::ofstream out(path, std::ios::binary);
    if (!out) throw std::runtime_error("cannot open " + path);
    out << doc.dump() << "\n";
    out.close();
    if (!out) throw std::runtime_error("failed writing " + path);
  }

  ArtifactReader reader_;
  const DumpStreetsOptions& options_;
  mutable ThreadPool pool_;
  const std::vector<ArtifactNodeRecord>* records_ = nullptr;
  std::vector<Combo> universe_;
  std::vector<std::string> hand_names_;
  std::vector<Card> root_board_;
  std::vector<std::unique_ptr<RiverEvaluator>> evaluators_;
  std::map<std::uint64_t, std::size_t> evaluator_of_;
};

}  // namespace

nlohmann::json dump_streets(ArtifactStore& store, const std::string& path,
                            const DumpStreetsOptions& options) {
  if (options.through.has_value() == !options.seeds.empty()) {
    throw std::runtime_error("dump-streets takes exactly one of --through or --seed");
  }
  if (options.through && *options.through != Street::Flop && *options.through != Street::Turn) {
    throw std::runtime_error("--through must be flop or turn");
  }
  if (options.out_dir.empty()) throw std::runtime_error("dump-streets needs --out-dir");
  StreetDumper dumper(store, path, options);
  return dumper.run();
}

}  // namespace engine
