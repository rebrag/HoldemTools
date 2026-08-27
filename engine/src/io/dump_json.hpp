#pragma once
#include <cstdint>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "io/artifact_store.hpp"
#include "io/dump_fields.hpp"

namespace engine {

// Developer/debug view of an artifact as JSON: metadata, hand dictionaries
// (combo strings for hold'em), and per-decision-node arrays. This is a dev
// tool and the validation harness's input - not a production read path.
//
// runouts: when set, chance nodes emit only that many evenly spaced children
// (and their subtrees) - the same deterministic sampling the harness uses.
// Without it, a flop-sized artifact (tens of thousands of decision nodes)
// produces a JSON DOM too large to build. Betting structure is identical
// under every card, so a sampled dump still contains every betting line.
//
// fields: the harness's diets. Both trimmed modes keep the full tree
// structure and metadata (marked "dump_fields"), the actor seat's hands per
// decision node, and BOTH seats' {hand, reach} at the root (they feed Pio's
// set_range); both drop hand_dicts, rollup_169, and non-actor seat hands,
// and round floats to 7 decimals (lossless for the harness, which feeds Pio
// %.6f and renders at 0.01 chip).
//   kDetail - actor hands carry {hand, reach, strategy, ev, action_ev}: what
//             the per-hand comparison view needs.
//   kGate   - actor hands carry {hand, reach, strategy}: what the
//             cross-exploitability gate alone needs.
// A full-precision consumer must use the default kFull dump.
nlohmann::json dump_artifact_json(ArtifactStore& store, const std::string& path,
                                  std::optional<std::uint32_t> only_node,
                                  std::optional<int> runouts = std::nullopt,
                                  DumpFields fields = DumpFields::kFull);

}  // namespace engine
