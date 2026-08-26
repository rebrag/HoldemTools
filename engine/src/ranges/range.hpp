#pragma once
#include <cctype>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "cards/combos.hpp"

namespace engine {

// Parse a range string into per-combo weights over the canonical 1326 order.
// Grammar: comma-separated entries, each `token[:weight]` with weight in
// [0,1] (default 1). Tokens: hand classes ("AA", "AKs", "T9o") or explicit
// combos ("AhKd"). Later entries override earlier ones for the same combo.
// Plus/dash shorthand ("TT+", "A5s-A2s") is NOT supported in this pass.
inline std::vector<float> parse_range(const std::string& text) {
  std::vector<float> weights(kNumCombos, 0.0f);

  auto rank_of = [](char ch) -> int {
    const char upper = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    for (int i = 0; i < 13; ++i) {
      if (kRankChars[i] == upper) return i;
    }
    return -1;
  };

  auto set_combo = [&](Card a, Card b, float w) { weights[combo_index(a, b)] = w; };

  auto apply_token = [&](const std::string& token, float w) {
    if (token.size() == 4) {
      // Explicit combo "AhKd".
      auto c1 = parse_card(token[0], token[1]);
      auto c2 = parse_card(token[2], token[3]);
      if (c1 && c2 && *c1 != *c2) {
        set_combo(*c1, *c2, w);
        return;
      }
    }
    const int r1 = token.empty() ? -1 : rank_of(token[0]);
    const int r2 = token.size() < 2 ? -1 : rank_of(token[1]);
    if (r1 < 0 || r2 < 0) throw std::runtime_error("bad range token '" + token + "'");
    const int hi = r1 > r2 ? r1 : r2;
    const int lo = r1 > r2 ? r2 : r1;
    if (token.size() == 2) {
      if (hi != lo) throw std::runtime_error("two-rank token needs s/o suffix: '" + token + "'");
      for (int s1 = 0; s1 < 4; ++s1) {
        for (int s2 = 0; s2 < s1; ++s2) {
          set_combo(static_cast<Card>(hi * 4 + s1), static_cast<Card>(hi * 4 + s2), w);
        }
      }
      return;
    }
    if (token.size() != 3) throw std::runtime_error("bad range token '" + token + "'");
    const char kind = static_cast<char>(std::tolower(static_cast<unsigned char>(token[2])));
    if (hi == lo) throw std::runtime_error("pair token cannot take s/o: '" + token + "'");
    if (kind == 's') {
      for (int s = 0; s < 4; ++s) {
        set_combo(static_cast<Card>(hi * 4 + s), static_cast<Card>(lo * 4 + s), w);
      }
    } else if (kind == 'o') {
      for (int s1 = 0; s1 < 4; ++s1) {
        for (int s2 = 0; s2 < 4; ++s2) {
          if (s1 == s2) continue;
          set_combo(static_cast<Card>(hi * 4 + s1), static_cast<Card>(lo * 4 + s2), w);
        }
      }
    } else {
      throw std::runtime_error("bad range token '" + token + "'");
    }
  };

  std::size_t pos = 0;
  while (pos < text.size()) {
    std::size_t comma = text.find(',', pos);
    if (comma == std::string::npos) comma = text.size();
    std::string entry = text.substr(pos, comma - pos);
    pos = comma + 1;
    // Trim whitespace.
    while (!entry.empty() && std::isspace(static_cast<unsigned char>(entry.front()))) entry.erase(0, 1);
    while (!entry.empty() && std::isspace(static_cast<unsigned char>(entry.back()))) entry.pop_back();
    if (entry.empty()) continue;
    float w = 1.0f;
    const std::size_t colon = entry.find(':');
    std::string token = entry;
    if (colon != std::string::npos) {
      token = entry.substr(0, colon);
      w = std::stof(entry.substr(colon + 1));
      if (w < 0.0f || w > 1.0f) throw std::runtime_error("range weight out of [0,1]: '" + entry + "'");
    }
    apply_token(token, w);
  }
  return weights;
}

// Zero out combos that overlap the given board cards.
inline void mask_range_vs_board(std::vector<float>& weights, std::uint64_t board_mask) {
  for (int i = 0; i < kNumCombos; ++i) {
    if (combo_mask(i) & board_mask) weights[i] = 0.0f;
  }
}

}  // namespace engine
