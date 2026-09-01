#pragma once

namespace engine {

// Which per-hand fields a JSON dump carries. Trimming is what keeps a
// turn-sized dump readable in seconds instead of minutes; the CLI selects it
// with --fields and io/dump_json.hpp documents what each mode emits.
enum class DumpFields {
  kFull,    // everything (default; the golden fixture's shape)
  kDetail,  // actor hands with EVs, no dictionaries/rollups/non-actor seats
  kGate,    // actor strategies only - no EVs at all
  kRollup,  // node structure + the 169-class rollups, NO per-hand fields.
            // The /multiway payload: the page renders only the rollup chart,
            // and per-hand data for 4 seats x 1326 combos was ~98% of the
            // bytes it uploaded, downloaded, and ignored.
};

}  // namespace engine
