#!/bin/bash
# SessionStart hook - brings up the Firebase Auth + Firestore emulators and seeds
# them, so Claude Code on the web has a working Firebase without any real
# credentials (cloud sessions clone from GitHub, so the gitignored .env is absent).
#
# Runs only in remote (web) sessions, so it never touches a local dev machine.
# Idempotent: if the emulator hub already answers, it exits without starting a
# second copy. Never fails the session - a missing firebase CLI is reported and
# skipped rather than treated as fatal.
set -euo pipefail

# Only run in Claude Code on the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PROJECT_ID="demo-gto-lite"
AUTH_PORT=9099
FIRESTORE_PORT=8080
LOG="/tmp/firebase-emulators.log"

# Node is guaranteed present here, and this avoids depending on curl/nc/lsof
# being installed in the container.
port_is_open() {
  node -e '
    const net = require("net");
    const s = net.connect(Number(process.argv[1]), "127.0.0.1");
    s.on("connect", () => { s.destroy(); process.exit(0); });
    s.on("error", () => process.exit(1));
    s.setTimeout(1000, () => { s.destroy(); process.exit(1); });
  ' "$1" >/dev/null 2>&1
}

# Readiness is measured on the product ports, NOT the hub: the hub starts
# listening seconds before Auth and Firestore accept connections, so waiting on
# it alone races the seed script into "emulator not reachable".
emulators_are_up() {
  port_is_open "$AUTH_PORT" && port_is_open "$FIRESTORE_PORT"
}

if emulators_are_up; then
  echo "[firebase] Emulators already running - reseeding only." >&2
else
  if ! command -v firebase >/dev/null 2>&1; then
    echo "[firebase] firebase-tools not found; skipping emulator startup." >&2
    echo "[firebase] Add 'npm install -g firebase-tools' to the cloud environment's Setup script." >&2
    exit 0
  fi

  echo "[firebase] Starting Auth + Firestore emulators (log: $LOG)…" >&2
  # Detached so the hook can return; the emulators outlive it for the session.
  nohup firebase emulators:start \
    --project "$PROJECT_ID" \
    --only auth,firestore \
    --config "$ROOT/firebase.json" \
    >"$LOG" 2>&1 &
  disown || true

  # Wait for both emulators, up to ~90s. The Firestore emulator is a Java
  # process and is the slow part of a cold start.
  for _ in $(seq 1 90); do
    if emulators_are_up; then break; fi
    sleep 1
  done

  if ! emulators_are_up; then
    echo "[firebase] Emulators did not come up within 90s. Last log lines:" >&2
    tail -n 20 "$LOG" >&2 || true
    exit 0
  fi
  echo "[firebase] Emulators ready (UI on http://127.0.0.1:4000)." >&2
fi

# Seeding uses firebase-admin from frontend/node_modules, which the
# session-start.sh hook installs before this one runs.
if ! (cd "$ROOT/frontend" && node scripts/seed-emulators.mjs) >&2; then
  echo "[firebase] Seeding failed - see output above. Emulators are still running." >&2
  exit 0
fi
