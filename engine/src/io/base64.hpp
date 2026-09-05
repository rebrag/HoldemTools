#pragma once
// Base64 (RFC 4648, standard alphabet, padded) for byte arrays that ride in
// the artifact's JSON metadata. Header-only: the joint team export and its
// test are the only users, and both want the same two functions.
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace engine {

inline std::string base64_encode(const std::vector<std::uint8_t>& bytes) {
  static constexpr char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((bytes.size() + 2) / 3) * 4);
  std::size_t i = 0;
  while (i + 3 <= bytes.size()) {
    const std::uint32_t v = (static_cast<std::uint32_t>(bytes[i]) << 16) |
                            (static_cast<std::uint32_t>(bytes[i + 1]) << 8) |
                            static_cast<std::uint32_t>(bytes[i + 2]);
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
    out.push_back(kAlphabet[(v >> 6) & 63]);
    out.push_back(kAlphabet[v & 63]);
    i += 3;
  }
  const std::size_t rest = bytes.size() - i;
  if (rest == 1) {
    const std::uint32_t v = static_cast<std::uint32_t>(bytes[i]) << 16;
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
    out.push_back('=');
    out.push_back('=');
  } else if (rest == 2) {
    const std::uint32_t v = (static_cast<std::uint32_t>(bytes[i]) << 16) |
                            (static_cast<std::uint32_t>(bytes[i + 1]) << 8);
    out.push_back(kAlphabet[(v >> 18) & 63]);
    out.push_back(kAlphabet[(v >> 12) & 63]);
    out.push_back(kAlphabet[(v >> 6) & 63]);
    out.push_back('=');
  }
  return out;
}

// Decodes a padded standard-alphabet string; anything else (whitespace,
// url-safe alphabet) is rejected by returning an empty vector.
inline std::vector<std::uint8_t> base64_decode(std::string_view text) {
  auto value = [](char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
  };
  std::vector<std::uint8_t> out;
  if (text.size() % 4 != 0) return out;
  out.reserve((text.size() / 4) * 3);
  for (std::size_t i = 0; i < text.size(); i += 4) {
    const int a = value(text[i]);
    const int b = value(text[i + 1]);
    const bool pad2 = text[i + 2] == '=';
    const bool pad3 = text[i + 3] == '=';
    const int c = pad2 ? 0 : value(text[i + 2]);
    const int d = pad3 ? 0 : value(text[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0 || (pad2 && !pad3)) return {};
    const std::uint32_t v = (static_cast<std::uint32_t>(a) << 18) |
                            (static_cast<std::uint32_t>(b) << 12) |
                            (static_cast<std::uint32_t>(c) << 6) | static_cast<std::uint32_t>(d);
    out.push_back(static_cast<std::uint8_t>((v >> 16) & 0xFF));
    if (!pad2) out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xFF));
    if (!pad3) out.push_back(static_cast<std::uint8_t>(v & 0xFF));
  }
  return out;
}

}  // namespace engine
