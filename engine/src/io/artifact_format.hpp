#pragma once
// Binary layout constants and little-endian helpers for the .hta artifact.
// The authoritative spec is engine/docs/artifact-format.md. Any layout
// change bumps kFormatVersion and updates: the spec, this writer, the C++
// reader, the C# EngineArtifactReader, and the committed fixture - all in
// one commit.
#include <bit>
#include <cstdint>
#include <cstring>
#include <vector>

namespace engine::artifact {

inline constexpr char kMagic[8] = {'H', 'T', 'E', 'N', 'G', 'A', 'R', 'T'};
inline constexpr std::uint32_t kFormatVersion = 1;
inline constexpr std::uint32_t kHeaderSize = 64;
inline constexpr std::uint32_t kNodeRecordSize = 80;
inline constexpr std::uint32_t kIndexEntrySize = 24;

inline constexpr std::uint32_t kFlagStrategyU8 = 1u << 0;
inline constexpr std::uint32_t kFlagEvF16 = 1u << 1;
inline constexpr std::uint32_t kFlagRollups = 1u << 2;

// Node reach below this weight is dropped from the sparse per-node arrays.
inline constexpr float kSparseEps = 1e-6f;

static_assert(std::endian::native == std::endian::little,
              "artifact writer assumes a little-endian host");

// Append primitives to a byte buffer, explicitly little-endian.
inline void put_bytes(std::vector<std::uint8_t>& out, const void* data, std::size_t size) {
  const auto* p = static_cast<const std::uint8_t*>(data);
  out.insert(out.end(), p, p + size);
}
template <typename T>
inline void put(std::vector<std::uint8_t>& out, T value) {
  static_assert(std::is_trivially_copyable_v<T>);
  put_bytes(out, &value, sizeof(T));
}

template <typename T>
inline T get(const std::uint8_t* data) {
  T value;
  std::memcpy(&value, data, sizeof(T));
  return value;
}

// IEEE 754 half-precision conversion (round-to-nearest-even). Used only when
// the ev_f16 flag is set; float32 is the default EV precision.
inline std::uint16_t float_to_half(float value) {
  const std::uint32_t bits = std::bit_cast<std::uint32_t>(value);
  const std::uint32_t sign = (bits >> 16) & 0x8000u;
  const std::int32_t exponent = static_cast<std::int32_t>((bits >> 23) & 0xFF) - 127 + 15;
  std::uint32_t mantissa = bits & 0x7FFFFFu;
  if (exponent >= 31) return static_cast<std::uint16_t>(sign | 0x7C00u | (exponent == 143 && mantissa ? 0x200u : 0));
  if (exponent <= 0) {
    if (exponent < -10) return static_cast<std::uint16_t>(sign);
    mantissa |= 0x800000u;
    const int shift = 14 - exponent;
    const std::uint32_t rounded = (mantissa + (1u << (shift - 1)) - 1 +
                                   ((mantissa >> shift) & 1)) >> shift;
    return static_cast<std::uint16_t>(sign | rounded);
  }
  const std::uint32_t rounded = mantissa + 0xFFFu + ((mantissa >> 13) & 1);
  if (rounded & 0x800000u) {
    if (exponent + 1 >= 31) return static_cast<std::uint16_t>(sign | 0x7C00u);
    return static_cast<std::uint16_t>(sign | ((exponent + 1) << 10));
  }
  return static_cast<std::uint16_t>(sign | (exponent << 10) | (rounded >> 13));
}

inline float half_to_float(std::uint16_t half) {
  const std::uint32_t sign = static_cast<std::uint32_t>(half & 0x8000u) << 16;
  const std::uint32_t exponent = (half >> 10) & 0x1Fu;
  const std::uint32_t mantissa = half & 0x3FFu;
  std::uint32_t bits;
  if (exponent == 0) {
    if (mantissa == 0) {
      bits = sign;
    } else {
      // Subnormal half: normalize.
      int e = -1;
      std::uint32_t m = mantissa;
      do {
        ++e;
        m <<= 1;
      } while (!(m & 0x400u));
      bits = sign | ((127 - 15 - e) << 23) | ((m & 0x3FFu) << 13);
    }
  } else if (exponent == 31) {
    bits = sign | 0x7F800000u | (mantissa << 13);
  } else {
    bits = sign | ((exponent - 15 + 127) << 23) | (mantissa << 13);
  }
  return std::bit_cast<float>(bits);
}

}  // namespace engine::artifact
