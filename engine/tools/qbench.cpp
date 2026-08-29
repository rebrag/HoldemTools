// Standalone microbenchmark: does u16 storage make the regret update faster?
//
// Build (from engine/, after build.ps1 has bootstrapped the MSVC env once):
//   cl /nologo /O2 /arch:AVX2 /fp:precise /EHsc /std:c++20 tools/qbench.cpp
//
// Exists because the answer is counterintuitive and cost a full implementation
// pass to learn. See docs/roadmap.md M7.2 for the numbers and what they mean.
//
// Does u16 storage make the regret update faster?
//
// Mimics update_regret_row at realistic sizes: a working set far larger than
// the 9800X3D's 96 MB V-Cache, laid out action-major exactly like
// InfosetLayout, with `out` indexed by hand within a node.
//
// A: f32 storage, f32 math                 - what the solver does today
// B: u16 storage, f32 math                 - what quantized regrets would do
// C: u16 storage, u16 INTEGER math         - the screenshot's ideal ceiling
// D: f32 pure read stream                  - bandwidth reference
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <vector>

#if defined(_MSC_VER)
#define RESTRICT __restrict
#else
#define RESTRICT
#endif

namespace {
constexpr std::uint32_t kHands = 536;    // the user spot's compact universe
constexpr std::uint16_t kActions = 5;
constexpr std::size_t kNodes = 25000;    // ~335 MB of f32 cells
constexpr std::size_t kCells = static_cast<std::size_t>(kHands) * kActions * kNodes;

void a_f32(float* RESTRICT r, const float* RESTRICT out, std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float v = r[h] - out[h];
    r[h] = v < 0.0f ? 0.0f : v;
  }
}

void b_u16_floatmath(std::uint16_t* RESTRICT q, const float* RESTRICT out, std::uint32_t hands,
                     float scale, float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float v = static_cast<float>(q[h]) * scale - out[h];
    const float c = v < 0.0f ? 0.0f : v * inv_scale;
    q[h] = static_cast<std::uint16_t>(c);
  }
}

void c_u16_intmath(std::uint16_t* RESTRICT q, const std::uint16_t* RESTRICT d,
                   std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const std::uint16_t cur = q[h];
    const std::uint16_t sub = d[h];
    q[h] = cur > sub ? static_cast<std::uint16_t>(cur - sub) : std::uint16_t{0};
  }
}

double d_stream(const float* RESTRICT r, std::uint32_t hands) {
  float acc = 0.0f;
  for (std::uint32_t h = 0; h < hands; ++h) acc += r[h];
  return acc;
}

template <typename F>
double timed(const char* name, std::size_t bytes_touched, F&& fn) {
  // Two warm passes, then the median of five.
  double best[5];
  for (int rep = 0; rep < 7; ++rep) {
    const auto t0 = std::chrono::steady_clock::now();
    fn();
    const auto t1 = std::chrono::steady_clock::now();
    const double s = std::chrono::duration<double>(t1 - t0).count();
    if (rep >= 2) best[rep - 2] = s;
  }
  for (int i = 0; i < 5; ++i)
    for (int j = i + 1; j < 5; ++j)
      if (best[j] < best[i]) { const double t = best[i]; best[i] = best[j]; best[j] = t; }
  const double med = best[2];
  std::printf("%-26s %8.4f s   %7.1f GB/s\n", name, med,
              static_cast<double>(bytes_touched) / med / 1e9);
  return med;
}
}  // namespace

int main() {
  std::vector<float> rf(kCells, 1.0f);
  std::vector<std::uint16_t> rq(kCells, 30000);
  std::vector<float> out(kHands, 0.001f);
  std::vector<std::uint16_t> du(kHands, 1);

  std::printf("cells %zu  (f32 %.0f MB, u16 %.0f MB)  hands %u actions %u nodes %zu\n\n",
              kCells, kCells * 4.0 / 1e6, kCells * 2.0 / 1e6, kHands, kActions, kNodes);

  // read + write of the stored array; `out` is hands-wide and stays in L1.
  const std::size_t bytes_f32 = kCells * 4 * 2;
  const std::size_t bytes_u16 = kCells * 2 * 2;

  const double ta = timed("A f32 store, f32 math", bytes_f32, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        a_f32(rf.data() + (n * kActions + k) * kHands, out.data(), kHands);
  });
  const double tb = timed("B u16 store, f32 math", bytes_u16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        b_u16_floatmath(rq.data() + (n * kActions + k) * kHands, out.data(), kHands,
                        1.0f / 32768.0f, 32768.0f);
  });
  const double tc = timed("C u16 store, u16 math", bytes_u16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        c_u16_intmath(rq.data() + (n * kActions + k) * kHands, du.data(), kHands);
  });
  double sink = 0.0;
  const double td = timed("D f32 pure read stream", kCells * 4, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        sink += d_stream(rf.data() + (n * kActions + k) * kHands, kHands);
  });

  std::printf("\nB vs A (what quantized regrets would buy): %.2fx\n", ta / tb);
  std::printf("C vs A (integer-math ceiling):             %.2fx\n", ta / tc);
  std::printf("(sink %.1f, read-stream %.4f s)\n", sink, td);
  return 0;
}
