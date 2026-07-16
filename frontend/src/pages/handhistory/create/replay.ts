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
  dealStreets,
  fmtChips,
  setWinners,
  settleAction,
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

// The engine's recorded actions as a replayable list. streetActions fills
// streets 0→3 in play order, so flattening preserves global chronological order.
// bet/raise carry their total street commitment; call/check/fold recompute from
// engine state on replay.
export function actionsFromEngine(engine: Engine): ReplayAction[] {
  return engine.streetActions.flat().map((a) =>
    a.kind === "bet" || a.kind === "raise"
      ? { kind: a.kind, to: a.amount }
      : { kind: a.kind }
  );
}

// Build the replay payload from a fully-resolved engine. Callers must only
// invoke this once the hand is done (engine.done && winners resolved) — the
// same guard the recorder's auto-save uses.
export function buildReplayData(state: AdvancedHandState, engine: Engine): ReplayData {
  return {
    v: 1,
    state,
    actions: actionsFromEngine(engine),
    winners: engine.winners ? [...engine.winners] : null,
    winners2: engine.winners2 ? [...engine.winners2] : null,
  };
}

// Replay an action list against a (possibly edited) setup, returning every
// intermediate engine frame: frames[0] is the posted-blinds state, frames[i+1]
// the state after actions[i]. Used by the recorder to re-derive the live engine
// (and its undo stack) after a retroactive setup edit mid-hand. Winners are NOT
// applied here — callers re-apply them to the final frame if needed.
export function rebuildFrames(state: AdvancedHandState, actions: ReplayAction[]): Engine[] {
  const frames: Engine[] = [buildEngine(state)];
  for (const a of actions) {
    frames.push(applyAction(frames[frames.length - 1], a.kind, a.to));
  }
  return frames;
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

const STREET_NAMES = ["Pre Flop", "Flop", "Turn", "River"];

// Precompute every engine snapshot the replayer scrubs through. Unlike the
// recorder (where applyAction folds a street-closing action, the next card, and
// the pot collection into ONE frame), the replay splits them so the deal feels
// real: the closing action is shown first (chips still in front, board unchanged),
// then each street is dealt on its own step (a run-out reveals one card at a
// time), then the hand resolves (pot pushed), and finally — when any seat is
// hidden-until-showdown — an extra step flips those cards face-up.
//
// frames[0] is the posted-blinds state. `revealHidden[i]` marks the single trailing
// step on which concealed hole cards are shown (see HandReplay's concealSeats).
export function reconstructFrames(data: ReplayData): {
  frames: Engine[];
  captions: string[];
  revealHidden: boolean[];
} {
  const frames: Engine[] = [];
  const captions: string[] = [];
  const revealHidden: boolean[] = [];
  const push = (e: Engine, caption: string, reveal = false) => {
    frames.push(e);
    captions.push(caption);
    revealHidden.push(reveal);
  };

  push(buildEngine(data.state), "Blinds posted");
  let prev = frames[0];

  for (const a of data.actions) {
    const caption = describeAction(prev, a);
    const { e: settled, close } = settleAction(prev, a.kind, a.to);
    // The action itself is always its own step, shown before anything reacts.
    push(settled, caption);

    if (close === "foldout") {
      // Everyone folded to one player: push the pot on a separate step.
      const resolved = applyAction(prev, a.kind, a.to); // = settle + finishFoldout
      push(resolved, "Pot awarded");
      prev = resolved;
    } else if (close === "advance") {
      // Deal each street on its own step (turn, then river for a run-out).
      const steps = dealStreets(settled);
      for (const s of steps) {
        push(s.e, s.status === "showdown" ? "Showdown" : STREET_NAMES[s.e.street]);
      }
      prev = steps[steps.length - 1].e;
    } else {
      prev = settled; // betting continues
    }
  }

  // Bake the recorded winners into the final resolved engine so the replay shows
  // the same award the recorder settled on (a fold already set them; a multi-way
  // showdown left winners=null for the user's pick).
  let last = frames[frames.length - 1];
  if (data.winners) last = setWinners(last, data.winners, 1);
  if (data.state.numBoards === 2 && data.winners2) {
    last = setWinners(last, data.winners2, 2);
  }
  frames[frames.length - 1] = last;

  // If any hidden seat is still live at the end, add one final step that flips
  // those cards face-up — always, even on an uncontested win. Non-hero hands are
  // hidden by default (unless an explicit per-seat choice says otherwise).
  const hasConcealedToReveal = data.state.seats.some((s, i) => {
    const hidden = s.hideUntilShowdown ?? i !== data.state.heroSeat;
    if (!hidden) return false;
    const fp = last.players.find((p) => p.seat === i);
    return fp && !fp.folded;
  });
  if (hasConcealedToReveal) push(last, "Show cards", true);

  return { frames, captions, revealHidden };
}

// ───────────────────────── list preview ─────────────────────────

/** One player shown in a list preview: the hero, or an opponent whose hole
 *  cards were recorded. `cards` entries may be null (unrecorded slots). */
export interface PreviewPlayer {
  cards: (string | null)[];
  name: string;
  isHero: boolean;
}

export interface HandPreview {
  /** Hero (when a hero seat exists) followed by every opponent whose hole cards
   *  were recorded, ordered by chips committed. */
  players: PreviewPlayer[];
  /** Known community cards, in dealt order (may be empty for preflop-only hands). */
  board: string[];
}

// Fold the recorded actions into a single final engine, without retaining the
// per-action frames reconstructFrames keeps — cheaper for rendering a list of
// hands where only end-of-hand totals (totalCommitted) and cards are needed.
export function finalEngine(data: ReplayData): Engine {
  let e = buildEngine(data.state);
  for (const a of data.actions) e = applyAction(e, a.kind, a.to);
  return e;
}

// Extract the pieces the hand-history list preview renders: the hero, the board,
// and every opponent whose hole cards were recorded (showdown/revealed hands),
// ordered by chips committed so the most-involved players appear first.
export function buildHandPreview(data: ReplayData): HandPreview {
  const e = finalEngine(data);
  const heroIdx = e.heroIndex;

  const players: PreviewPlayer[] = [];
  if (heroIdx != null) {
    const h = e.players[heroIdx];
    players.push({ cards: h.hole, name: h.name, isHero: true });
  }
  e.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== heroIdx && p.hole.some((c) => !!c))
    .sort((a, b) => b.p.totalCommitted - a.p.totalCommitted)
    .forEach(({ p }) => players.push({ cards: p.hole, name: p.name, isHero: false }));

  return {
    players,
    board: data.state.board.filter((c): c is string => !!c),
  };
}
