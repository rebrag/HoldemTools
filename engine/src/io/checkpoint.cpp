#include "io/checkpoint.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <type_traits>
#include <nlohmann/json.hpp>

#include "config/schema.hpp"

namespace engine {
namespace {

constexpr char kMagic[8] = {'H', 'T', 'C', 'K', 'P', 'T', '0', '1'};

template <typename T>
void put(std::ostream& os, const T& v) {
  static_assert(std::is_trivially_copyable_v<T>);
  os.write(reinterpret_cast<const char*>(&v), sizeof(T));
}

template <typename T>
bool get(std::istream& is, T& v) {
  static_assert(std::is_trivially_copyable_v<T>);
  is.read(reinterpret_cast<char*>(&v), sizeof(T));
  return static_cast<bool>(is);
}

void put_floats(std::ostream& os, const std::vector<float>& v) {
  const std::uint64_t n = v.size();
  put(os, n);
  if (n > 0) os.write(reinterpret_cast<const char*>(v.data()),
                      static_cast<std::streamsize>(n * sizeof(float)));
}

bool get_floats(std::istream& is, std::vector<float>& v) {
  std::uint64_t n = 0;
  if (!get(is, n)) return false;
  v.assign(static_cast<std::size_t>(n), 0.0f);
  if (n > 0) {
    is.read(reinterpret_cast<char*>(v.data()), static_cast<std::streamsize>(n * sizeof(float)));
  }
  return static_cast<bool>(is);
}

void put_string(std::ostream& os, const std::string& s) {
  const std::uint64_t n = s.size();
  put(os, n);
  os.write(s.data(), static_cast<std::streamsize>(n));
}

bool get_string(std::istream& is, std::string& s) {
  std::uint64_t n = 0;
  if (!get(is, n)) return false;
  s.assign(static_cast<std::size_t>(n), '\0');
  if (n > 0) is.read(s.data(), static_cast<std::streamsize>(n));
  return static_cast<bool>(is);
}

}  // namespace

double write_checkpoint(const std::string& path, const SampledCfrSolver& solver,
                        const SolveConfig& config, const CheckpointExtras& extras) {
  const auto start = std::chrono::steady_clock::now();
  // Write to a temp file and rename. A checkpoint is overwritten every run,
  // so a crash mid-write would otherwise take out the only copy of a solve
  // that may represent hours of iterations.
  const std::filesystem::path parent = std::filesystem::path(path).parent_path();
  if (!parent.empty()) std::filesystem::create_directories(parent);
  const std::string tmp = path + ".tmp";
  {
    std::ofstream os(tmp, std::ios::binary | std::ios::trunc);
    if (!os) throw std::runtime_error("checkpoint: cannot open " + tmp + " for writing");
    os.write(kMagic, sizeof(kMagic));
    put_string(os, config_solve_key(config));
    put(os, static_cast<std::uint64_t>(solver.iteration()));
    put(os, static_cast<std::uint64_t>(solver.store_total()));
    put(os, static_cast<std::int64_t>(solver.joint_classes()));
    put(os, static_cast<std::int64_t>(solver.universe_hands()));
    put(os, static_cast<std::uint64_t>(extras.baseline_iterations));

    const std::uint64_t base_ev_n = extras.baseline_ev_chips.size();
    put(os, base_ev_n);
    if (base_ev_n > 0) {
      os.write(reinterpret_cast<const char*>(extras.baseline_ev_chips.data()),
               static_cast<std::streamsize>(base_ev_n * sizeof(double)));
    }

    put_floats(os, solver.regrets());
    put_floats(os, solver.strategy_sums());
    put_floats(os, solver.ev_sums());
    put_floats(os, solver.ev_weights());

    // Frozen seats (unaware phase 2). Stored so a resumed run never re-runs
    // phase 1 - which would be both wasteful and, if its budget changed,
    // a DIFFERENT baseline than the one the team has been training against.
    const std::vector<bool>& frozen = solver.frozen_seats();
    put(os, static_cast<std::uint64_t>(frozen.size()));
    for (bool b : frozen) put(os, static_cast<std::uint8_t>(b ? 1 : 0));
    const std::vector<std::vector<float>>& rows = solver.frozen_rows();
    std::uint64_t nonempty = 0;
    for (const auto& r : rows) if (!r.empty()) ++nonempty;
    put(os, static_cast<std::uint64_t>(rows.size()));
    put(os, nonempty);
    for (std::size_t id = 0; id < rows.size(); ++id) {
      if (rows[id].empty()) continue;
      put(os, static_cast<std::uint64_t>(id));
      put_floats(os, rows[id]);
    }
    os.flush();
    if (!os) throw std::runtime_error("checkpoint: write failed for " + tmp);
  }
  std::remove(path.c_str());
  if (std::rename(tmp.c_str(), path.c_str()) != 0) {
    throw std::runtime_error("checkpoint: cannot move " + tmp + " into place");
  }
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
}

bool read_checkpoint(const std::string& path, SampledCfrSolver& solver,
                     const SolveConfig& config, CheckpointExtras& extras,
                     std::string& err) {
  std::ifstream is(path, std::ios::binary);
  if (!is) {
    err = "no checkpoint at " + path;
    return false;
  }
  char magic[sizeof(kMagic)] = {};
  is.read(magic, sizeof(magic));
  if (!is || std::memcmp(magic, kMagic, sizeof(kMagic)) != 0) {
    err = "not a checkpoint file (or written by a different format version)";
    return false;
  }
  std::string key;
  if (!get_string(is, key)) {
    err = "truncated checkpoint header";
    return false;
  }
  if (key != config_solve_key(config)) {
    // Refusing is the whole point: the arrays are indexed by a layout this
    // config may not share, and even where the shapes match, continuing a
    // different game's regrets would produce a confident wrong answer.
    err = "checkpoint belongs to a different spot (config mismatch) - "
          "solve settings other than the budget must match to resume";
    return false;
  }
  std::uint64_t iteration = 0, store_total = 0, baseline_iters = 0;
  std::int64_t joint_classes = 0, universe_hands = 0;
  if (!get(is, iteration) || !get(is, store_total) || !get(is, joint_classes) ||
      !get(is, universe_hands) || !get(is, baseline_iters)) {
    err = "truncated checkpoint header";
    return false;
  }
  if (store_total != solver.store_total() || joint_classes != solver.joint_classes() ||
      universe_hands != solver.universe_hands()) {
    err = "checkpoint layout does not match this solver (tree, universe or team differs)";
    return false;
  }
  std::uint64_t base_ev_n = 0;
  if (!get(is, base_ev_n)) {
    err = "truncated checkpoint";
    return false;
  }
  std::vector<double> baseline_ev(static_cast<std::size_t>(base_ev_n), 0.0);
  if (base_ev_n > 0) {
    is.read(reinterpret_cast<char*>(baseline_ev.data()),
            static_cast<std::streamsize>(base_ev_n * sizeof(double)));
  }
  std::vector<float> regrets, strat_sum, ev_sum, ev_w;
  if (!get_floats(is, regrets) || !get_floats(is, strat_sum) || !get_floats(is, ev_sum) ||
      !get_floats(is, ev_w)) {
    err = "truncated checkpoint state";
    return false;
  }
  std::uint64_t seats_n = 0;
  if (!get(is, seats_n)) {
    err = "truncated checkpoint";
    return false;
  }
  std::vector<bool> frozen_seat(static_cast<std::size_t>(seats_n), false);
  for (std::uint64_t i = 0; i < seats_n; ++i) {
    std::uint8_t b = 0;
    if (!get(is, b)) {
      err = "truncated checkpoint";
      return false;
    }
    frozen_seat[static_cast<std::size_t>(i)] = b != 0;
  }
  std::uint64_t rows_n = 0, nonempty = 0;
  if (!get(is, rows_n) || !get(is, nonempty)) {
    err = "truncated checkpoint";
    return false;
  }
  std::vector<std::vector<float>> frozen_rows(static_cast<std::size_t>(rows_n));
  for (std::uint64_t i = 0; i < nonempty; ++i) {
    std::uint64_t id = 0;
    if (!get(is, id) || id >= rows_n) {
      err = "corrupt checkpoint frozen-row table";
      return false;
    }
    if (!get_floats(is, frozen_rows[static_cast<std::size_t>(id)])) {
      err = "truncated checkpoint frozen rows";
      return false;
    }
  }
  solver.restore(iteration, std::move(regrets), std::move(strat_sum), std::move(ev_sum),
                 std::move(ev_w), std::move(frozen_seat), std::move(frozen_rows));
  extras.baseline_iterations = baseline_iters;
  extras.baseline_ev_chips = std::move(baseline_ev);
  return true;
}

}  // namespace engine
