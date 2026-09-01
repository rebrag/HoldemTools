// Cooperative cancel: the latch a caller sets to stop a solve without
// killing it. The contract worth pinning is the FAIL-SAFE direction - every
// unusable answer has to read as "keep solving", because the caller's kill is
// the backstop and a solve that stops on a phantom cancel has thrown away
// real work for nothing.
#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>

#include "config/schema.hpp"
#include "util/stop_signal.hpp"

using namespace engine;

namespace {

std::filesystem::path temp_dir(const char* name) {
  const std::filesystem::path dir =
      std::filesystem::temp_directory_path() / ("htsolver_stop_" + std::string(name));
  std::filesystem::remove_all(dir);
  std::filesystem::create_directories(dir);
  return dir;
}

}  // namespace

TEST_CASE("no stop file configured means never cancelled") {
  CHECK_FALSE(stop_requested(""));
}

TEST_CASE("a stop file cancels only once it exists") {
  const std::filesystem::path dir = temp_dir("exists");
  const std::string path = (dir / "STOP").string();

  // The normal state for the whole life of an uninterrupted solve.
  CHECK_FALSE(stop_requested(path));

  { std::ofstream(path) << "cancelled by the owner"; }
  CHECK(stop_requested(path));

  // Latching, not edge-triggered: it keeps reading true, so a solve that
  // checks between slices cannot miss the moment it was set.
  CHECK(stop_requested(path));

  std::filesystem::remove_all(dir);
}

TEST_CASE("an unreachable path is not a cancel") {
  // A path under a directory that does not exist cannot be stat'd. That is an
  // error, and an error must not stop a solve - a caller who genuinely wants
  // this run dead can still kill the process.
  const std::filesystem::path dir = temp_dir("unreachable");
  CHECK_FALSE(stop_requested((dir / "no_such_dir" / "STOP").string()));
  std::filesystem::remove_all(dir);
}

TEST_CASE("budget.stop_file survives the config round trip") {
  const std::filesystem::path dir = temp_dir("config");
  const std::filesystem::path cfg = dir / "config.json";
  {
    std::ofstream out(cfg);
    out << R"({
      "game": "kuhn",
      "budget": { "iterations": 10, "stop_file": "C:/tmp/run/STOP" }
    })";
  }
  const SolveConfig config = load_config(cfg.string());
  CHECK(config.stop_file == "C:/tmp/run/STOP");
  CHECK(stop_requested(config.stop_file) == false);

  // A cancel is a property of ONE run, never of the spot being solved, so it
  // must not change which checkpoint this config resumes. Two configs that
  // differ only here are the same solve.
  {
    std::ofstream out(cfg);
    out << R"({ "game": "kuhn", "budget": { "iterations": 10 } })";
  }
  const SolveConfig plain = load_config(cfg.string());
  CHECK(config_solve_key(config) == config_solve_key(plain));

  std::filesystem::remove_all(dir);
}
