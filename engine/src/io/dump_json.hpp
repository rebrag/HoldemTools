#pragma once
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "io/artifact_store.hpp"

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
nlohmann::json dump_artifact_json(ArtifactStore& store, const std::string& path,
                                  std::optional<std::uint32_t> only_node,
                                  std::optional<int> runouts = std::nullopt);

}  // namespace engine
