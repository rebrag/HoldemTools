#pragma once
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "game/types.hpp"
#include "io/artifact_store.hpp"

namespace engine {

// `engine dump-streets`: a heads-up postflop artifact as one JSON document
// per STREET, for the watcher's schema-4 adapter (watcher/ht_bundles.py).
//
// A street is a seed decision node plus every node reachable from it without
// crossing a deal. The root street is seeded at the root (`r:0`); every other
// street at a deal child that is a decision node. Node ids are Pio's colon
// ids: root `r:0`, fold `f`, check or call `c`, bet or raise
// `b<hand-cumulative postflop chips>`, deal = the card (`Th`).
//
// Only the node blobs a street emits are read: the bootstrap is the
// ArtifactReader's (header, metadata, node table, hand dictionaries, index),
// and colon ids resolve against the node table alone, so a river street of a
// multi-GB flop artifact costs a handful of range reads.
//
// Output: `<out_dir>/streets.json` = {metadata, hands, streets:[{seed, street,
// board, decision_nodes, file}]} plus one `<seed with ':' -> '.'>.json` per
// street. See engine/README.md for the per-street document.
//
// With `equity`, every emitted decision node carries per-hand equity (`eq`)
// and matchups (`mu`) for BOTH seats, from the node's stored reach through
// the engine's own RiverEvaluator, averaged over the remaining runouts the
// way Pio's calc_eq_node does: eq(h) = sum over runouts r and compatible
// opponent hands o of reach(o) * (win + tie/2), over the same sum of
// reach(o); mu(h) = that denominator / the number of runouts compatible with
// h. eq is null where mu is 0 (no opponent hand to be measured against).
// Only the runout boards the requested streets need are evaluated; work is
// spread over a thread pool, and every number is computed serially in a
// fixed order inside one task, so the output does not depend on `threads`.
//
// Refuses (std::runtime_error) anything but a 2-seat `nlhe` per-hand
// vectorized export with per-hand EVs: bucketed, 3+ seats, preflop and toy
// artifacts have no street documents to give.
struct DumpStreetsOptions {
  std::string out_dir;
  std::optional<Street> through;   // Flop | Turn: the root street and every street up to it
  std::vector<std::string> seeds;  // exactly these streets (river on demand)
  bool equity = false;
  int threads = 0;  // resolve_thread_count semantics
};

// Returns the streets.json document it wrote.
nlohmann::json dump_streets(ArtifactStore& store, const std::string& path,
                            const DumpStreetsOptions& options);

}  // namespace engine
