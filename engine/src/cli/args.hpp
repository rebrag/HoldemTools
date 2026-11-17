#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "io/dump_fields.hpp"

namespace engine {

struct CliArgs {
  std::string subcommand;                 // solve | dry-run | plan | dump-json | dump-streets | version
  std::string input_path;                 // config (solve/dry-run/plan) or artifact (dump-json)
  double time_budget_s = 0.0;             // plan --time-budget-seconds
  double target_pct = 0.0;                // plan --target-pct
  int threads = 0;                        // plan / dump-streets --threads (0 = the config's / all)
  std::optional<std::uint32_t> node;      // dump-json --node
  std::optional<int> runouts;             // dump-json --runouts (sampled chance fan-out)
  bool meta_only = false;                 // dump-json --meta-only
  bool compact = false;                   // dump-json --compact (no pretty-print)
  DumpFields fields = DumpFields::kFull;  // dump-json --fields
  std::optional<std::string> out_path;    // dump-json --out (write to file, not stdout)
  std::string out_dir;                    // dump-streets --out-dir
  std::optional<std::string> through;     // dump-streets --through flop|turn
  std::vector<std::string> seeds;         // dump-streets --seed (repeatable)
  bool equity = false;                    // dump-streets --equity
  bool valid = false;
  std::string error;
};

CliArgs parse_args(int argc, const char* const* argv);
const char* usage();

}  // namespace engine
