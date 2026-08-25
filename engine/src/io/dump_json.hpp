#pragma once
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "io/artifact_store.hpp"

namespace engine {

// Developer/debug view of an artifact as JSON: metadata, hand dictionaries
// (combo strings for hold'em), and per-decision-node arrays. This is a dev
// tool and the validation harness's input - not a production read path.
nlohmann::json dump_artifact_json(ArtifactStore& store, const std::string& path,
                                  std::optional<std::uint32_t> only_node);

}  // namespace engine
