#pragma once
#include <array>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace engine {

// Card code = rank * 4 + suit. rank 0..12 = 2..A, suit 0..3 = c,d,h,s.
// Card 51 = As, card 0 = 2c.
using Card = std::int8_t;

inline constexpr int kNumCards = 52;
inline constexpr char kRankChars[] = "23456789TJQKA";
inline constexpr char kSuitChars[] = "cdhs";

inline int card_rank(Card c) { return c / 4; }
inline int card_suit(Card c) { return c % 4; }

inline std::string card_to_string(Card c) {
  return std::string{kRankChars[card_rank(c)], kSuitChars[card_suit(c)]};
}

inline std::optional<Card> parse_card(char rank_ch, char suit_ch) {
  int rank = -1, suit = -1;
  for (int i = 0; i < 13; ++i) {
    if (kRankChars[i] == rank_ch) rank = i;
  }
  if (rank_ch >= 'a' && rank_ch <= 'z') {
    for (int i = 0; i < 13; ++i) {
      if (kRankChars[i] == rank_ch - 'a' + 'A') rank = i;
    }
  }
  for (int i = 0; i < 4; ++i) {
    if (kSuitChars[i] == suit_ch) suit = i;
    if (kSuitChars[i] == suit_ch + ('c' - 'C')) suit = i;  // accept upper-case suit
  }
  if (rank < 0 || suit < 0) return std::nullopt;
  return static_cast<Card>(rank * 4 + suit);
}

// Parse a run of card codes like "QsJh2h8d6c" or "Qs Jh 2h 8d 6c".
inline std::vector<Card> parse_cards(const std::string& text) {
  std::vector<Card> cards;
  std::size_t i = 0;
  while (i < text.size()) {
    if (text[i] == ' ' || text[i] == ',') {
      ++i;
      continue;
    }
    if (i + 1 >= text.size()) throw std::runtime_error("dangling card character in '" + text + "'");
    auto card = parse_card(text[i], text[i + 1]);
    if (!card) throw std::runtime_error("invalid card '" + text.substr(i, 2) + "'");
    cards.push_back(*card);
    i += 2;
  }
  return cards;
}

inline std::uint64_t cards_mask(const std::vector<Card>& cards) {
  std::uint64_t mask = 0;
  for (Card c : cards) mask |= (1ULL << c);
  return mask;
}

}  // namespace engine
