#!/bin/bash
# SessionStart hook — installs project dependencies so type-checks, linters, and
# the dev server are ready in Claude Code on the web sessions.
#
# Runs only in remote (web) sessions, so it never touches a local dev machine.
# Idempotent: safe to run repeatedly; npm install (not ci) lets the cached
# container reuse an existing node_modules.
set -euo pipefail

# Only run in Claude Code on the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG="$(mktemp)"

# Frontend (npm).
if [ -f "$ROOT/frontend/package.json" ]; then
  echo "[session-start] Installing frontend dependencies (npm install)…" >&2
  if ! npm install --prefix "$ROOT/frontend" >"$LOG" 2>&1; then
    echo "[session-start] frontend npm install FAILED:" >&2
    cat "$LOG" >&2
    exit 1
  fi
fi

# Backend (.NET) — only when the SDK is available; a no-op otherwise (the web
# container may ship the runtime but not the SDK).
if command -v dotnet >/dev/null 2>&1 && [ -f "$ROOT/backend/GTOLiteAPI.csproj" ]; then
  echo "[session-start] Restoring backend NuGet packages (dotnet restore)…" >&2
  if ! dotnet restore "$ROOT/backend/GTOLiteAPI.csproj" >"$LOG" 2>&1; then
    echo "[session-start] backend dotnet restore FAILED:" >&2
    cat "$LOG" >&2
    exit 1
  fi
fi

echo "[session-start] Dependencies ready." >&2
