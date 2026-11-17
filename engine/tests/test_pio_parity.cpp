// The engine's betting tree against PioViewer's OWN tree builder.
//
// The fixtures in watcher/fixtures/pio_trees are scripts PioViewer generated
// from a tree-building panel: a `#Key#Value` header (the panel) followed by
// one `add_line` per maximal aggressive betting line, each token the actor's
// hand-cumulative postflop total after the action (a check repeats the
// current total). Pio adds every passive continuation (check, call, fold)
// itself, so a tree is fully described by its set of maximal aggressive
// lines, and that is the set compared here.
//
// The header parser lives HERE, in test code, on purpose: the engine library
// reads engine configs, never Pio's format. Every *.txt in the fixture
// directory is checked, so dropping a new PioViewer script there extends the
// gate; a fixture with no entry in kKnownDifferences must match exactly.
//
// The one systematic difference is ROUNDING, which the engine deliberately
// keeps (changing it would move every existing tree and the tree_hash
// digests): PioViewer rounds the cumulative TOTAL half-to-even, the engine
// rounds the INCREMENT half away from zero, and the engine truncates the
// all-in threshold to whole chips (`target >= floor(t * stack)`) where Pio
// compares against the exact product. Both only bite on exact ties, and each
// such tie is listed below with the arithmetic that produces it.

#include <doctest/doctest.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "cards/cards.hpp"
#include "game/betting_tree.hpp"

#ifndef HT_PIO_TREE_FIXTURES
#error "HT_PIO_TREE_FIXTURES must name watcher/fixtures/pio_trees (set in CMakeLists.txt)"
#endif

using namespace engine;

namespace {

using Line = std::vector<Chips>;
using LineSet = std::set<Line>;

struct PioScript {
  std::map<std::string, std::string> header;
  std::vector<Line> lines;
};

PioScript read_script(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) throw std::runtime_error("cannot open " + path.string());
  PioScript script;
  std::string raw;
  while (std::getline(in, raw)) {
    if (!raw.empty() && raw.back() == '\r') raw.pop_back();
    if (raw.size() > 1 && raw[0] == '#') {
      const std::size_t sep = raw.find('#', 1);
      if (sep == std::string::npos) continue;
      script.header[raw.substr(1, sep - 1)] = raw.substr(sep + 1);
    } else if (raw.rfind("add_line", 0) == 0) {
      std::istringstream tokens(raw.substr(8));
      Line line;
      Chips t = 0;
      while (tokens >> t) line.push_back(t);
      script.lines.push_back(std::move(line));
    }
  }
  return script;
}

// "30 66", "75, 150", "a" -> percentages, with Pio's `a` as the engine's
// explicit all-in size (10000% of pot, which always clamps to the stack).
std::vector<double> parse_sizes(const std::string& text) {
  std::vector<double> out;
  std::string token;
  auto flush = [&]() {
    if (token.empty()) return;
    if (token == "a") {
      out.push_back(10000.0);
    } else {
      std::size_t used = 0;
      const double v = std::stod(token, &used);
      if (used != token.size()) {
        throw std::runtime_error("size '" + token + "' has no engine equivalent (x / e / c sizes)");
      }
      out.push_back(v);
    }
    token.clear();
  };
  for (char ch : text) {
    if (ch == ' ' || ch == ',') flush();
    else token.push_back(ch);
  }
  flush();
  return out;
}

std::string get(const PioScript& s, const std::string& key, const std::string& fallback = "") {
  const auto it = s.header.find(key);
  return it == s.header.end() ? fallback : it->second;
}

// PioViewer's panel -> the engine's tree parameters, the way the hand-history
// path maps it (contract section 1).
PostflopTreeParams params_from_header(const PioScript& s) {
  PostflopTreeParams p;
  p.pot = std::stoll(get(s, "Pot"));
  p.effective_stack = std::stoll(get(s, "EffectiveStacks"));
  const std::vector<Card> board = parse_cards(get(s, "Board"));
  p.board_mask = cards_mask(board);
  p.start_street = board.size() == 3 ? Street::Flop : board.size() == 4 ? Street::Turn : Street::River;
  p.preflop_aggressor = Aggressor::None;  // Pio's flop OOP always uses BetSize

  const double threshold = std::stod(get(s, "AllinThreshold", "100")) / 100.0;
  const double ratio = std::stod(get(s, "AddAllinOnlyIfLessThanThisTimesThePot", "0")) / 100.0;
  const double merge = get(s, "MergeSimilarBets") == "True"
                           ? std::stod(get(s, "MergeSimilarBetsThreshold", "0"))
                           : 0.0;
  // CapPerStreet is "flop\nturn\nriver" with a LITERAL backslash-n. 0 (and a
  // disabled or absent cap) means unlimited in Pio - checked against a saved
  // Pio tree built with CapPerStreet 0 that still has raises.
  std::vector<int> caps;
  if (get(s, "CapEnabled") == "True") {
    std::string text = get(s, "CapPerStreet");
    for (std::size_t at = 0; (at = text.find("\\n")) != std::string::npos;) {
      caps.push_back(std::stoi(text.substr(0, at)));
      text = text.substr(at + 2);
    }
    if (!text.empty()) caps.push_back(std::stoi(text));
  }
  const char* names[] = {"Flop", "Turn", "River"};
  StreetSizing* streets[] = {&p.flop, &p.turn, &p.river};
  for (int i = 0; i < 3; ++i) {
    StreetSizing& st = *streets[i];
    const std::string oop = std::string(names[i]) + "Config.";
    const std::string ip = std::string(names[i]) + "ConfigIP.";
    st.oop.bets = parse_sizes(get(s, oop + "BetSize"));
    st.oop.raises = parse_sizes(get(s, oop + "RaiseSize"));
    st.oop.donks = parse_sizes(get(s, oop + "DonkBetSize"));
    st.oop.add_allin = get(s, oop + "AddAllin") == "True";
    st.ip.bets = parse_sizes(get(s, ip + "BetSize"));
    st.ip.raises = parse_sizes(get(s, ip + "RaiseSize"));
    st.ip.add_allin = get(s, ip + "AddAllin") == "True";
    st.allin_threshold = threshold;
    st.add_allin_max_pot_ratio = ratio;
    st.merge_similar_pct = merge;
    const int cap = static_cast<std::size_t>(i) < caps.size() ? caps[static_cast<std::size_t>(i)] : 0;
    st.max_raises = cap > 0 ? cap : 20;
  }
  return p;
}

// Every aggressive line in the engine tree, in the add_line encoding. Betting
// structure is identical under every card, so a chance node descends its
// first child only.
void collect(const PublicTree& tree, NodeId id, Line& path, LineSet& out) {
  const Node& n = tree[id];
  for (std::uint16_t c = 0; c < n.num_children; ++c) {
    const NodeId cid = n.first_child + c;
    const Node& child = tree[cid];
    if (child.action_kind == ActionKind::Fold) continue;
    const bool token = child.action_kind != ActionKind::Deal;
    if (token) path.push_back(child.action_amount);
    if (child.action_kind == ActionKind::Bet) out.insert(path);
    collect(tree, cid, path, out);
    if (token) path.pop_back();
    if (n.kind == NodeKind::Chance) break;
  }
}

LineSet maximal(const LineSet& lines) {
  LineSet out;
  for (const Line& l : lines) {
    bool extended = false;
    for (const Line& o : lines) {
      if (o.size() > l.size() && std::equal(l.begin(), l.end(), o.begin())) {
        extended = true;
        break;
      }
    }
    if (!extended) out.insert(l);
  }
  return out;
}

std::string to_text(const Line& l) {
  std::string s;
  for (Chips t : l) s += (s.empty() ? "" : " ") + std::to_string(t);
  return s;
}

struct KnownDifference {
  std::vector<std::string> only_engine;
  std::vector<std::string> only_pio;
};

// One-chip rounding ties, every one explained. Anything else is a failure.
const std::map<std::string, KnownDifference>& known_differences() {
  static const std::map<std::string, KnownDifference> table = {
      {"temp.txt",
       {
           // Flop x-x, turn: OOP bets 50% of 81 = 40.5. Engine: llround(40.5)
           // = 41; Pio: round-half-even(0 + 40.5) = 40. The river below it
           // (pot 163 vs 161) moves with it: 30% = 48.9 -> 41+49 = 90 vs
           // 40+48.3 -> 88, 66% = 107.58 -> 41+108 = 149 vs 146.
           // Same 40.5 tie for IP's turn bet after x-x / x.
           // Flop x / bet 81 / call, turn IP bets 50% of 243 = 121.5:
           // engine 81+122 = 203, Pio half-even(202.5) = 202; on the river
           // the engine's 30% of 487 is 146.1 -> 349, which is >= the
           // engine's TRUNCATED threshold floor(0.6 * 583) = 349 and so
           // becomes all-in, where Pio's 348 < 349.8 stays a bet.
           // Flop bet 27 / call, turn OOP bets 50% of 135 = 67.5: engine
           // 27+68 = 95, Pio half-even(94.5) = 94; the river sizes follow
           // (pot 271 vs 269: 30% -> 176 vs 175, 66% -> 274 vs 272).
           {
               // tie 40.5 (flop x-x, turn bet 41 vs 40)
               "0 0 0 41 41 41 149 583", "0 0 0 41 41 41 90 583", "0 0 0 41 41 90 583",
               "0 0 0 41 583", "0 0 41 41 149 583", "0 0 41 41 41 149 583",
               "0 0 41 41 41 90 583", "0 0 41 41 90 583", "0 0 41 583",
               // tie 121.5 (turn bet 203 vs 202; river 349 becomes all-in)
               "0 81 81 81 203 203 203 583", "0 81 81 81 203 203 583", "0 81 81 81 203 583",
               // tie 67.5 (turn bet 95 vs 94)
               "27 27 27 95 583", "27 27 27 95 95 176 583", "27 27 27 95 95 583",
               "27 27 27 95 95 95 176 583", "27 27 27 95 95 95 274 583", "27 27 27 95 95 95 583",
               "27 27 95 583", "27 27 95 95 176 583", "27 27 95 95 274 583", "27 27 95 95 583",
               "27 27 95 95 95 176 583", "27 27 95 95 95 274 583", "27 27 95 95 95 583",
           },
           {
               "0 0 0 40 40 40 146 583", "0 0 0 40 40 40 88 583", "0 0 0 40 40 88 583",
               "0 0 0 40 583", "0 0 40 40 146 583", "0 0 40 40 40 146 583",
               "0 0 40 40 40 88 583", "0 0 40 40 88 583", "0 0 40 583",
               "0 81 81 81 202 202 202 348 583", "0 81 81 81 202 202 202 583",
               "0 81 81 81 202 202 348 583", "0 81 81 81 202 202 583", "0 81 81 81 202 583",
               "27 27 27 94 583", "27 27 27 94 94 175 583", "27 27 27 94 94 583",
               "27 27 27 94 94 94 175 583", "27 27 27 94 94 94 272 583", "27 27 27 94 94 94 583",
               "27 27 94 583", "27 27 94 94 175 583", "27 27 94 94 272 583", "27 27 94 94 583",
               "27 27 94 94 94 175 583", "27 27 94 94 94 272 583", "27 27 94 94 94 583",
           },
       }},
  };
  return table;
}

}  // namespace

TEST_CASE("PioViewer parity: the engine's tree matches PioViewer's own add_line output") {
  const std::filesystem::path dir(HT_PIO_TREE_FIXTURES);
  REQUIRE(std::filesystem::is_directory(dir));
  int checked = 0;
  for (const auto& entry : std::filesystem::directory_iterator(dir)) {
    if (entry.path().extension() != ".txt") continue;
    const std::string name = entry.path().filename().string();
    CAPTURE(name);
    const PioScript script = read_script(entry.path());
    REQUIRE_FALSE(script.lines.empty());
    const PostflopTreeParams params = params_from_header(script);
    const PublicTree tree = build_postflop_tree(params);

    LineSet engine_all;
    Line path;
    collect(tree, tree.root(), path, engine_all);
    const LineSet engine_lines = maximal(engine_all);
    const LineSet pio_lines = maximal(LineSet(script.lines.begin(), script.lines.end()));
    // PioViewer writes exactly the maximal lines; if it ever writes a prefix
    // too, the comparison above still holds, but say so.
    CHECK(pio_lines.size() == script.lines.size());

    std::vector<std::string> only_engine, only_pio;
    for (const Line& l : engine_lines) {
      if (!pio_lines.count(l)) only_engine.push_back(to_text(l));
    }
    for (const Line& l : pio_lines) {
      if (!engine_lines.count(l)) only_pio.push_back(to_text(l));
    }
    KnownDifference expected;
    if (const auto it = known_differences().find(name); it != known_differences().end()) {
      expected = it->second;
    }
    std::sort(expected.only_engine.begin(), expected.only_engine.end());
    std::sort(expected.only_pio.begin(), expected.only_pio.end());
    std::sort(only_engine.begin(), only_engine.end());
    std::sort(only_pio.begin(), only_pio.end());
    std::string report;
    for (const auto& l : only_engine) report += "  only engine: " + l + "\n";
    for (const auto& l : only_pio) report += "  only pio:    " + l + "\n";
    CAPTURE(report);
    CHECK(only_engine == expected.only_engine);
    CHECK(only_pio == expected.only_pio);
    ++checked;
  }
  CHECK(checked >= 2);
}
