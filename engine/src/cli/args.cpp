#include "cli/args.hpp"

#include <cstdint>
#include <cstdlib>

namespace engine {

const char* usage() {
  return "usage:\n"
         "  engine solve <config.json>      solve and write the artifact from output.path\n"
         "  engine dry-run <config.json>    print the memory estimate and exit\n"
         "  engine plan <config.json> [--time-budget-seconds N] [--target-pct X] [--threads T]\n"
         "                                  JSON on stdout: tree size, per-core memory and predicted\n"
         "                                  rate, and the recommended core/abstraction/batch for the\n"
         "                                  budget (no solving, no clustering)\n"
         "  engine dump-json <file.hta> [--node <id>] [--runouts <n>] [--meta-only]\n"
         "                   [--compact] [--fields full|detail|gate|rollup] [--out <path>]\n"
         "                                  dump an artifact as JSON (stdout, or --out file);\n"
         "                                  --compact skips pretty-printing; --fields trims\n"
         "                                  per-hand data: detail = actor hands with EVs,\n"
         "                                  gate = actor strategies only, both dropping\n"
         "                                  hand_dicts, rollups, and non-actor seats\n"
         "  engine dump-streets <file.hta> --out-dir <dir> (--through flop|turn | --seed <id>...)\n"
         "                   [--equity] [--threads N]\n"
         "                                  one JSON document per street (a seed node and everything\n"
         "                                  below it before the next deal) plus streets.json; seeds are\n"
         "                                  Pio colon ids (r:0:c:b30:c:Th); --equity adds per-hand\n"
         "                                  equity and matchups for both seats at every decision\n"
         "  engine version                  print engine and artifact format versions\n";
}

CliArgs parse_args(int argc, const char* const* argv) {
  CliArgs args;
  if (argc < 2) {
    args.error = "missing subcommand";
    return args;
  }
  args.subcommand = argv[1];
  if (args.subcommand == "version") {
    args.valid = true;
    return args;
  }
  if (args.subcommand != "solve" && args.subcommand != "dry-run" &&
      args.subcommand != "dump-json" && args.subcommand != "plan" &&
      args.subcommand != "dump-streets") {
    args.error = "unknown subcommand '" + args.subcommand + "'";
    return args;
  }
  if (argc < 3) {
    args.error = args.subcommand + " needs an input path";
    return args;
  }
  args.input_path = argv[2];
  for (int i = 3; i < argc; ++i) {
    const std::string flag = argv[i];
    if (flag == "--node" && i + 1 < argc && args.subcommand == "dump-json") {
      args.node = static_cast<std::uint32_t>(std::strtoul(argv[++i], nullptr, 10));
    } else if (flag == "--runouts" && i + 1 < argc && args.subcommand == "dump-json") {
      args.runouts = static_cast<int>(std::strtol(argv[++i], nullptr, 10));
    } else if (flag == "--meta-only" && args.subcommand == "dump-json") {
      args.meta_only = true;
    } else if (flag == "--compact" && args.subcommand == "dump-json") {
      args.compact = true;
    } else if (flag == "--fields" && i + 1 < argc && args.subcommand == "dump-json") {
      const std::string value = argv[++i];
      if (value == "full") args.fields = DumpFields::kFull;
      else if (value == "detail") args.fields = DumpFields::kDetail;
      else if (value == "gate") args.fields = DumpFields::kGate;
      else if (value == "rollup") args.fields = DumpFields::kRollup;
      else {
        args.error = "--fields must be full, detail, gate, or rollup (got '" + value + "')";
        return args;
      }
    } else if (flag == "--out" && i + 1 < argc && args.subcommand == "dump-json") {
      args.out_path = argv[++i];
    } else if (flag == "--time-budget-seconds" && i + 1 < argc && args.subcommand == "plan") {
      args.time_budget_s = std::strtod(argv[++i], nullptr);
    } else if (flag == "--target-pct" && i + 1 < argc && args.subcommand == "plan") {
      args.target_pct = std::strtod(argv[++i], nullptr);
    } else if (flag == "--out-dir" && i + 1 < argc && args.subcommand == "dump-streets") {
      args.out_dir = argv[++i];
    } else if (flag == "--through" && i + 1 < argc && args.subcommand == "dump-streets") {
      args.through = argv[++i];
      if (*args.through != "flop" && *args.through != "turn") {
        args.error = "--through must be flop or turn (got '" + *args.through + "')";
        return args;
      }
    } else if (flag == "--seed" && i + 1 < argc && args.subcommand == "dump-streets") {
      args.seeds.push_back(argv[++i]);
    } else if (flag == "--equity" && args.subcommand == "dump-streets") {
      args.equity = true;
    } else if (flag == "--threads" && i + 1 < argc &&
               (args.subcommand == "plan" || args.subcommand == "dump-streets")) {
      args.threads = static_cast<int>(std::strtol(argv[++i], nullptr, 10));
    } else {
      args.error = "unexpected argument '" + flag + "'";
      return args;
    }
  }
  if (args.subcommand == "dump-streets") {
    if (args.out_dir.empty()) {
      args.error = "dump-streets needs --out-dir";
      return args;
    }
    if (args.through.has_value() == !args.seeds.empty()) {
      args.error = "dump-streets takes exactly one of --through or --seed";
      return args;
    }
  }
  args.valid = true;
  return args;
}

}  // namespace engine
