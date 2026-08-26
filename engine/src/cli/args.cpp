#include "cli/args.hpp"

#include <cstdint>
#include <cstdlib>

namespace engine {

const char* usage() {
  return "usage:\n"
         "  engine solve <config.json>      solve and write the artifact from output.path\n"
         "  engine dry-run <config.json>    print the memory estimate and exit\n"
         "  engine dump-json <file.hta> [--node <id>] [--runouts <n>] [--meta-only]\n"
         "                   [--compact] [--strategy-only] [--out <path>]\n"
         "                                  dump an artifact as JSON (stdout, or --out file);\n"
         "                                  --compact skips pretty-printing; --strategy-only\n"
         "                                  keeps tree + actor strategies (+ root reaches) and\n"
         "                                  drops per-hand EVs, hand_dicts, and rollups\n"
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
      args.subcommand != "dump-json") {
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
    } else if (flag == "--strategy-only" && args.subcommand == "dump-json") {
      args.strategy_only = true;
    } else if (flag == "--out" && i + 1 < argc && args.subcommand == "dump-json") {
      args.out_path = argv[++i];
    } else {
      args.error = "unexpected argument '" + flag + "'";
      return args;
    }
  }
  args.valid = true;
  return args;
}

}  // namespace engine
