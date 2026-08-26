#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace engine {

struct CliArgs {
  std::string subcommand;                 // solve | dry-run | dump-json | version
  std::string input_path;                 // config (solve/dry-run) or artifact (dump-json)
  std::optional<std::uint32_t> node;      // dump-json --node
  std::optional<int> runouts;             // dump-json --runouts (sampled chance fan-out)
  bool meta_only = false;                 // dump-json --meta-only
  bool valid = false;
  std::string error;
};

CliArgs parse_args(int argc, const char* const* argv);
const char* usage();

}  // namespace engine
