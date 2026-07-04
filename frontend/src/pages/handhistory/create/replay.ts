// src/pages/handhistory/create/replay.ts
// Structured replay payload for the hand replayer. Saved hands persist only as
// plain `rawText`, and that text is lossy (named seats hide their position;
// non-shown opponents' hole cards are absent), so the betting engine cannot be
// faithfully rebuilt from text alone. Instead we capture the full setup +
// ordered action list at save time, embed it (base64) inside the saved text as
// an HTML comment marker, and strip it from every user-facing display.
//
// Reconstruction reuses the SAME engine as the recorder — buildEngine(state)
// then a fold of applyAction over the actions — so every replayed frame is
// byte-identical to what the creator showed.
import type { AdvancedHandState } from "./types";
import {
  applyAction,
  buildEngine,
  fmtChips,
  setWinners,
  type Engine,
} from "./engine";

// A single betting action, ready to feed back to applyAction. `to` (the total
// street commitment) is only present for bet/raise; call/check/fold recompute
// their amounts from the engine state and clamp to the actor's stack.
export interface ReplayAction {
  kind: "fold" | "check" | "call" | "bet" | "raise";
  to?: number;
}

export interface ReplayData {
  v: 1;
  state: AdvancedHandState; // full setup, verbatim (strings preserved)
  actions: ReplayAction[]; // engine.streetActions flattened in street order 0..3
  winners: number[] | null;
  winners2: number[] | null;
}

// ───────────────────────── capture ─────────────────────────

// Build the replay payload from a fully-resolved engine. Callers must only
// invoke this once the hand is done (engine.done && winners resolved) — the
// same guard the recorder's auto-save uses.
export function buildReplayData(state: AdvancedHandState, engine: Engine): ReplayData {
  // streetActions fills streets 0→3 in play order, so flattening preserves the
  // global chronological order of actions.
  const actions: ReplayAction[] = engine.streetActions.flat().map((a) =>
    a.kind === "bet" || a.kind === "raise"
      ? { kind: a.kind, to: a.amount }
      : { kind: a.kind }
  );
  return {
    v: 1,
    state,
    actions,
    winners: engine.winners ? [...engine.winners] : null,
    winners2: engine.winners2 ? [...engine.winners2] : null,
  };
}

// ───────────────────────── codec ─────────────────────────

// UTF-8-safe base64 (seat names / comments may contain emoji or non-Latin
// characters, which make a naive btoa(JSON.stringify(...)) throw).
function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Base64 has no newlines and can never contain "-->", so the payload can't
// terminate the HTML comment early or break the serialized text's formatting.
const MARKER_RE = /<!--HT_REPLAY:v1:([A-Za-z0-9+/=]+)-->/;
const MARKER_STRIP_RE = /\n*<!--HT_REPLAY:v1:[A-Za-z0-9+/=]+-->\s*$/;

export function encodeReplay(data: ReplayData): string {
  return `\n\n<!--HT_REPLAY:v1:${toB64(JSON.stringify(data))}-->`;
}

export function parseReplay(rawText: string): ReplayData | null {
  const m = rawText.match(MARKER_RE);
  if (!m) return null;
  try {
    const data = JSON.parse(fromB64(m[1])) as unknown;
    if (
      !data ||
      typeof data !== "object" ||
      (data as ReplayData).v !== 1 ||
      !(data as ReplayData).state ||
      !Array.isArray((data as ReplayData).actions)
    ) {
      return null;
    }
    return data as ReplayData;
  } catch {
    return null;
  }
}

// Remove the embedded payload (and its leading blank lines) so the canonical
// hand text is shown/copied clean. Idempotent; a no-op on unmarked text.
export function stripReplay(rawText: string): string {
  return rawText.replace(MARKER_STRIP_RE, "");
}

// ───────────────────────── reconstruction ─────────────────────────

// Human caption for a single action ("BTN raises to $30"). Computed against the
// engine state BEFORE the action, because the actor is prev.toAct.
function describeAction(prev: Engine, a: ReplayAction): string {
  if (prev.toAct == null) return "";
  const p = prev.players[prev.toAct];
  const label = p.name; // already the custom name or position from buildEngine
  switch (a.kind) {
    case "fold":
      return `${label} folds`;
    case "check":
      return `${label} checks`;
    case "call": {
      const amt = Math.min(prev.currentBet - p.committed, p.stack);
      const allIn = amt >= p.stack ? " (all-in)" : "";
      return `${label} calls $${fmtChips(amt)}${allIn}`;
    }
    case "bet": {
      const to = a.to ?? 0;
      const allIn = to - p.committed >= p.stack ? " (all-in)" : "";
      return `${label} bets $${fmtChips(to)}${allIn}`;
    }
    case "raise": {
      const to = a.to ?? 0;
      const allIn = to - p.committed >= p.stack ? " (all-in)" : "";
      return `${label} raises to $${fmtChips(to)}${allIn}`;
    }
  }
}

// Precompute every engine snapshot for the replay. frames[0] is the posted-blinds
// state; frames[i+1] is the state after actions[i]. Winners are applied to the
// final frame (finishHand leaves winners=null at a multi-way showdown).
export function reconstructFrames(data: ReplayData): {
  frames: Engine[];
  captions: string[];
} {
  const frames: Engine[] = [buildEngine(data.state)];
  const captions: string[] = ["Blinds posted"];

  for (const a of data.actions) {
    const prev = frames[frames.length - 1];
    const caption = describeAction(prev, a);
    frames.push(applyAction(prev, a.kind, a.to));
    captions.push(caption);
  }

  // Apply the recorded winners to the last frame so the replay shows the same
  // award the recorder settled on (idempotent when a fold already set them).
  let last = frames[frames.length - 1];
  if (data.winners) last = setWinners(last, data.winners, 1);
  if (data.state.numBoards === 2 && data.winners2) {
    last = setWinners(last, data.winners2, 2);
  }
  frames[frames.length - 1] = last;

  return { frames, captions };
}
