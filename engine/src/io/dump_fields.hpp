#pragma once

namespace engine {

// Which per-hand fields a JSON dump carries. Trimming is what keeps a
// turn-sized dump readable in seconds instead of minutes; the CLI selects it
// with --fields and io/dump_json.hpp documents what each mode emits.
enum class DumpFields {
  kFull,    // everything (default; the golden fixture's shape)
  kDetail,  // actor hands with EVs, no dictionaries/rollups/non-actor seats
  kGate,    // actor strategies only - no EVs at all
};

}  // namespace engine
