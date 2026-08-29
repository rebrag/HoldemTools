// Standalone microbenchmark: does u16 storage make the regret update faster?
//
// Build (from engine/, after build.ps1 has bootstrapped the MSVC env once):
//   cl /nologo /O2 /arch:AVX2 /fp:precise /EHsc /std:c++20 tools/qbench.cpp
//
// Exists because the answer is counterintuitive and cost a full implementation
// pass to learn. See docs/roadmap.md M7.2 for the numbers and what they mean.
//
// The question is NOT "are 16-bit cells smaller" - obviously they are. It is
// where the float/int conversion ends up, because that decides whether MSVC
// vectorizes the loop at all. Three shapes appear in the solver and they
// behave completely differently:
//
//   round trip     load i16 -> widen -> float math -> narrow -> store i16
//   widen only     load i16 -> widen -> write float elsewhere
//   pure integer   load i16 -> integer math -> store i16
//
// Sizing mirrors a real node from the user flop spot: 536 hands x 5 actions,
// action-major, over enough nodes that the regret array streams from DRAM
// (268 MB of f32 cells against a 96 MB V-Cache). The per-node scratch that
// the solver keeps in an arena - sigma, sums, out, child_vals - is modelled
// as ONE reused buffer, because that is what it is: cache-resident, not part
// of the streaming traffic.
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
constexpr std::size_t kNodeCells = static_cast<std::size_t>(kHands) * kActions;

// ---------------------------------------------------------------- the update
// r -= out[h], clamped. `out` is hands-wide and cache-resident.

void a_f32(float* RESTRICT r, const float* RESTRICT out, std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float v = r[h] - out[h];
    r[h] = v < 0.0f ? 0.0f : v;
  }
}

// Round trip: what a naive quantized regret update looks like.
void b_u16_floatmath(std::uint16_t* RESTRICT q, const float* RESTRICT out, std::uint32_t hands,
                     float scale, float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float v = static_cast<float>(q[h]) * scale - out[h];
    const float c = v < 0.0f ? 0.0f : v * inv_scale;
    q[h] = static_cast<std::uint16_t>(c);
  }
}

// Pure integer: only reachable if `out` is quantized ONCE per node into the
// node's own scale (H conversions) instead of once per cell (H x A).
void c_u16_intmath(std::uint16_t* RESTRICT q, const std::uint16_t* RESTRICT d,
                   std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const std::uint16_t cur = q[h];
    const std::uint16_t sub = d[h];
    q[h] = cur > sub ? static_cast<std::uint16_t>(cur - sub) : std::uint16_t{0};
  }
}

// -------------------------------------------------------- regret matching
// Pass 1 of regret_matched_action_major: read regrets, write the positive
// part into sigma, accumulate the per-hand sum. Integer-in / float-out - it
// never stores a narrowed value, which is the interesting difference.

void e_rm_f32(const float* RESTRICT regrets, float* RESTRICT sigma, float* RESTRICT sums,
              std::uint32_t hands, std::uint16_t actions) {
  for (std::uint32_t h = 0; h < hands; ++h) sums[h] = 0.0f;
  for (std::uint16_t k = 0; k < actions; ++k) {
    const float* r = regrets + static_cast<std::size_t>(k) * hands;
    float* col = sigma + static_cast<std::size_t>(k) * hands;
    for (std::uint32_t h = 0; h < hands; ++h) {
      const float p = r[h] > 0.0f ? r[h] : 0.0f;
      col[h] = p;
      sums[h] += p;
    }
  }
}

void f_rm_i16(const std::int16_t* RESTRICT regrets, float* RESTRICT sigma, float* RESTRICT sums,
              std::uint32_t hands, std::uint16_t actions, float scale) {
  for (std::uint32_t h = 0; h < hands; ++h) sums[h] = 0.0f;
  for (std::uint16_t k = 0; k < actions; ++k) {
    const std::int16_t* r = regrets + static_cast<std::size_t>(k) * hands;
    float* col = sigma + static_cast<std::size_t>(k) * hands;
    for (std::uint32_t h = 0; h < hands; ++h) {
      const std::int16_t v = r[h];
      const float p = v > 0 ? static_cast<float>(v) * scale : 0.0f;
      col[h] = p;
      sums[h] += p;
    }
  }
}

// ------------------------------------------------------------ the fold-in
// plain_fold_in: out[h] += sigma*cv[h] and regret_col[h] += cv[h]. `cv` and
// `out` are hands-wide arena slots; only the regret column streams.

void g_foldin_f32(float* RESTRICT out, float* RESTRICT regret_col,
                  const float* RESTRICT sigma_col, const float* RESTRICT cv,
                  std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    out[h] += sigma_col[h] * cv[h];
    regret_col[h] += cv[h];
  }
}

// The same with i16 regrets, fused - a round trip, so expect variant B's fate.
void h_foldin_i16_fused(float* RESTRICT out, std::int16_t* RESTRICT q_col,
                        const float* RESTRICT sigma_col, const float* RESTRICT cv,
                        std::uint32_t hands, float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    out[h] += sigma_col[h] * cv[h];
    const float v = static_cast<float>(q_col[h]) + cv[h] * inv_scale;
    q_col[h] = static_cast<std::int16_t>(v);
  }
}

// Split: quantize cv into a hands-wide scratch (float->int, vectorizable on
// its own), then a pure-integer accumulate into the streaming regret column.
// Two passes, but the streaming one is integer.
void i_foldin_i16_split(float* RESTRICT out, std::int16_t* RESTRICT q_col,
                        const float* RESTRICT sigma_col, const float* RESTRICT cv,
                        std::int16_t* RESTRICT cvq, std::uint32_t hands, float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    out[h] += sigma_col[h] * cv[h];
    cvq[h] = static_cast<std::int16_t>(cv[h] * inv_scale);
  }
  for (std::uint32_t h = 0; h < hands; ++h) {
    q_col[h] = static_cast<std::int16_t>(q_col[h] + cvq[h]);
  }
}

// The strongest form of the idea: hoist the widening into its OWN loop, so
// neither loop mixes widths. Pass 1 streams i16 and writes a cache-resident
// f32 scratch (H x A = 10.7 KB); pass 2 is the existing all-float kernel.
// If MSVC vectorizes a bare widening loop, this is the route to i16 regrets.
void j_widen(const std::int16_t* RESTRICT src, float* RESTRICT dst, std::size_t n, float scale) {
  for (std::size_t i = 0; i < n; ++i) dst[i] = static_cast<float>(src[i]) * scale;
}

// Variant I kept the two halves inside one function and MSVC scalarised both.
// K is the same idea with the halves as SEPARATE functions, which is exactly
// what rescued strat_accum_q16 in the solver. K1 touches only hands-wide
// cache-resident buffers; K2 is the one that streams, and it is pure integer.
void k1_prepare(float* RESTRICT out, const float* RESTRICT sigma_col,
                const float* RESTRICT cv, std::int16_t* RESTRICT cvq,
                std::uint32_t hands, float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    out[h] += sigma_col[h] * cv[h];
    cvq[h] = static_cast<std::int16_t>(cv[h] * inv_scale);
  }
}

void k2_intadd(std::int16_t* RESTRICT q_col, const std::int16_t* RESTRICT cvq,
               std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    q_col[h] = static_cast<std::int16_t>(q_col[h] + cvq[h]);
  }
}

// L: K again with k1 itself split, because k1 mixed widths too. Now every
// loop is single-width: float, narrowing, integer.
void l1_out(float* RESTRICT out, const float* RESTRICT sigma_col, const float* RESTRICT cv,
            std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) out[h] += sigma_col[h] * cv[h];
}

void l2_narrow(const float* RESTRICT cv, std::int16_t* RESTRICT cvq, std::uint32_t hands,
               float inv_scale) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    cvq[h] = static_cast<std::int16_t>(cv[h] * inv_scale);
  }
}

// M is a different question entirely, and it applies to the CURRENT f32 code.
// Today the regret array is streamed twice per node: plain_fold_in does a
// read-modify-write per action, then the update loop does another. If every
// action's child values were buffered in a cache-resident H x A scratch (the
// fork path already materializes exactly that as forked_out), the two could
// merge into ONE streaming pass: r[i] += cvs[i] - out[h]. That halves the
// regret traffic with no quantization involved at all.
void m_merged_f32(float* RESTRICT r, const float* RESTRICT cvs, const float* RESTRICT out,
                  std::uint32_t hands) {
  for (std::uint32_t h = 0; h < hands; ++h) {
    const float v = r[h] + cvs[h] - out[h];
    r[h] = v < 0.0f ? 0.0f : v;
  }
}

template <typename F>
double timed(const char* name, std::size_t bytes, F&& fn) {
  double t[5];
  for (int rep = 0; rep < 7; ++rep) {
    const auto t0 = std::chrono::steady_clock::now();
    fn();
    const auto t1 = std::chrono::steady_clock::now();
    const double s = std::chrono::duration<double>(t1 - t0).count();
    if (rep >= 2) t[rep - 2] = s;
  }
  for (int i = 0; i < 5; ++i)
    for (int j = i + 1; j < 5; ++j)
      if (t[j] < t[i]) { const double tmp = t[i]; t[i] = t[j]; t[j] = tmp; }
  std::printf("%-34s %8.4f s  %7.1f GB/s\n", name, t[2],
              static_cast<double>(bytes) / t[2] / 1e9);
  return t[2];
}
}  // namespace

int main() {
  std::vector<float> rf(kCells, 1.0f);
  std::vector<std::uint16_t> rqu(kCells, 30000);
  std::vector<std::int16_t> rqs(kCells, 1000);
  // Per-node arena scratch: cache-resident in the solver, so here too.
  std::vector<float> sigma(kNodeCells, 0.2f);
  std::vector<float> sums(kHands, 0.0f);
  std::vector<float> outv(kHands, 0.001f);
  std::vector<float> cv(kHands, 0.5f);
  std::vector<std::uint16_t> du(kHands, 1);
  std::vector<std::int16_t> cvq(kHands, 0);
  std::vector<float> widened(kNodeCells, 0.0f);  // cache-resident, like sigma

  std::printf("cells %zu  (f32 %.0f MB, i16 %.0f MB)  hands %u actions %u nodes %zu\n\n",
              kCells, kCells * 4.0 / 1e6, kCells * 2.0 / 1e6, kHands, kActions, kNodes);

  const std::size_t rw_f32 = kCells * 4 * 2;   // read + write
  const std::size_t rw_i16 = kCells * 2 * 2;
  const std::size_t r_f32 = kCells * 4;        // read only
  const std::size_t r_i16 = kCells * 2;

  std::printf("-- the update (r -= out[h]) --\n");
  const double ta = timed("A  f32 store, f32 math", rw_f32, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        a_f32(rf.data() + (n * kActions + k) * kHands, outv.data(), kHands);
  });
  const double tb = timed("B  u16 store, f32 math (roundtrip)", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        b_u16_floatmath(rqu.data() + (n * kActions + k) * kHands, outv.data(), kHands,
                        1.0f / 32768.0f, 32768.0f);
  });
  const double tc = timed("C  u16 store, u16 math (pure int)", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        c_u16_intmath(rqu.data() + (n * kActions + k) * kHands, du.data(), kHands);
  });

  std::printf("\n-- regret matching pass 1 (integer-in, float-out) --\n");
  const double te = timed("E  f32 regrets", r_f32, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      e_rm_f32(rf.data() + n * kNodeCells, sigma.data(), sums.data(), kHands, kActions);
  });
  const double tf = timed("F  i16 regrets", r_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      f_rm_i16(rqs.data() + n * kNodeCells, sigma.data(), sums.data(), kHands, kActions,
               1.0f / 32768.0f);
  });

  const double tj = timed("J  i16 widen pass, then f32 kernel", r_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n) {
      j_widen(rqs.data() + n * kNodeCells, widened.data(), kNodeCells, 1.0f / 32768.0f);
      e_rm_f32(widened.data(), sigma.data(), sums.data(), kHands, kActions);
    }
  });

  std::printf("\n-- plain_fold_in (regret_col += cv) --\n");
  const double tg = timed("G  f32 regrets", rw_f32, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        g_foldin_f32(outv.data(), rf.data() + (n * kActions + k) * kHands,
                     sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(), kHands);
  });
  const double th = timed("H  i16 regrets, fused (roundtrip)", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        h_foldin_i16_fused(outv.data(), rqs.data() + (n * kActions + k) * kHands,
                           sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(),
                           kHands, 32768.0f);
  });
  const double ti = timed("I  i16 regrets, split (int accum)", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k)
        i_foldin_i16_split(outv.data(), rqs.data() + (n * kActions + k) * kHands,
                           sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(),
                           cvq.data(), kHands, 32768.0f);
  });

  const double tk = timed("K  i16, split into two functions", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k) {
        k1_prepare(outv.data(), sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(),
                   cvq.data(), kHands, 32768.0f);
        k2_intadd(rqs.data() + (n * kActions + k) * kHands, cvq.data(), kHands);
      }
  });

  const double tl = timed("L  i16, every loop single-width", rw_i16, [&] {
    for (std::size_t n = 0; n < kNodes; ++n)
      for (std::uint16_t k = 0; k < kActions; ++k) {
        l1_out(outv.data(), sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(),
               kHands);
        l2_narrow(cv.data(), cvq.data(), kHands, 32768.0f);
        k2_intadd(rqs.data() + (n * kActions + k) * kHands, cvq.data(), kHands);
      }
  });

  std::printf("\n-- fold-in AND update merged into one streaming pass (f32) --\n");
  const double tga = timed("G+A  two passes (today)", rw_f32 * 2, [&] {
    for (std::size_t n = 0; n < kNodes; ++n) {
      for (std::uint16_t k = 0; k < kActions; ++k)
        g_foldin_f32(outv.data(), rf.data() + (n * kActions + k) * kHands,
                     sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(), kHands);
      for (std::uint16_t k = 0; k < kActions; ++k)
        a_f32(rf.data() + (n * kActions + k) * kHands, outv.data(), kHands);
    }
  });
  const double tm = timed("M    one merged pass", rw_f32, [&] {
    for (std::size_t n = 0; n < kNodes; ++n) {
      for (std::uint16_t k = 0; k < kActions; ++k)
        l1_out(outv.data(), sigma.data() + static_cast<std::size_t>(k) * kHands, cv.data(),
               kHands);
      for (std::uint16_t k = 0; k < kActions; ++k)
        m_merged_f32(rf.data() + (n * kActions + k) * kHands, cv.data(), outv.data(), kHands);
    }
  });

  std::printf("\n== speedup vs the f32 baseline for that touch ==\n");
  std::printf("update        B roundtrip %.2fx   C pure-int  %.2fx\n", ta / tb, ta / tc);
  std::printf("regret match  F i16       %.2fx   J widen+f32 %.2fx\n", te / tf, te / tj);
  std::printf("fold-in       H fused     %.2fx   I split     %.2fx   K 2-func %.2fx"
              "   L 3-func %.2fx\n", tg / th, tg / ti, tg / tk, tg / tl);
  std::printf("MERGED PASS   %.2fx faster than today's two passes (f32, no quantization)\n",
              tga / tm);
  std::printf("\n(sums[0] %.3f out[0] %.3f - keeps the work live)\n", sums[0], outv[0]);
  return 0;
}
