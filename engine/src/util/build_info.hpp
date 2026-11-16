#pragma once

namespace engine {

// The engine's semantic version: a static string that moves only on a
// deliberate release, so it cannot tell two builds apart.
inline constexpr const char* kSolverVersion = "0.1.0";

// The build's identity: the short id of the last git commit that touched
// engine/ (so a commit elsewhere in the monorepo does not change it),
// suffixed "-dirty" when engine/ had uncommitted changes, "unknown" when the
// build had no git. Stamped into artifact metadata as `engine_build`, so a
// consumer can tell whether two artifacts came from the same engine code.
// Regenerated on every build (cmake/engine_build_id.cmake); only
// build_info.cpp includes the generated header, so a new commit recompiles
// one file.
const char* engine_build_id();

}  // namespace engine
