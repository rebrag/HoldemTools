#pragma once

#include <filesystem>
#include <string>
#include <system_error>

namespace engine {

// Cooperative cancel: "does this path exist yet?"
//
// A solve checks this wherever it checks its time budget, and takes the same
// exit when it fires - checkpoint written, EV pass run, artifact exported -
// so a stopped solve is still viewable and still resumable. The alternative
// available to a caller is killing the process, which discards everything:
// both the checkpoint and the artifact are written at the END of a run.
//
// A FILE rather than a signal, because the caller is a watcher on Windows
// driving a child process, where there is no portable way to deliver one -
// and because existence is a latch. The caller sets it once and is done; the
// solve cannot miss it by being busy at the wrong moment, and there is
// nothing to parse, to re-deliver, or to get half-written.
//
// An empty path means no cancel is possible, which is the default. Any error
// - a path that cannot be stat'd, a directory that cannot be read - reads as
// "keep going": a cancel that cannot be observed must never masquerade as one
// that can, and the caller's kill is still there as the backstop.
inline bool stop_requested(const std::string& stop_file) {
  if (stop_file.empty()) return false;
  std::error_code ec;
  const bool present = std::filesystem::exists(stop_file, ec);
  return present && !ec;
}

}  // namespace engine
