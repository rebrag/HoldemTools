// src/pages/handhistory/create/parseHandDefaults.ts
// Setup defaults for the *next* hand, recovered from a saved hand. We reuse only
// blinds, ante, game, table size, and each seat's name + stack + sitting-out
// state; hand-specific details (button, hero, hole cards, action) are ignored.
//
// Preferred source is the lossless replay payload embedded in the saved text
// (see replay.ts) — it carries the full state including sitting-out seats, which
// the human-readable text drops (serialize.ts lists only dealt-in players). We
// fall back to a tolerant reverse-parse of the text for old/foreign hands that
// have no payload.
import type { AdvancedHandState, InitialStateOverrides } from "./types";
import { parseReplay } from "./replay";

export interface HandDefaults extends InitialStateOverrides {
  tableSize?: number;
  seats?: { name: string; stack: string; sittingOut?: boolean; occupied?: boolean }[];
}

// Build defaults straight from a previous hand's full state (the lossless path).
// Keeps every seat — occupied, empty, AND sitting-out — at its original index, so
// the next hand keeps the whole table layout: the table size doesn't collapse to
// the dealt-in count, an empty seat stays empty in the same spot, and sitting-out
// seats stay sitting out.
function defaultsFromState(state: AdvancedHandState): HandDefaults {
  return {
    game: state.game,
    smallBlind: cleanNum(state.smallBlind),
    bigBlind: cleanNum(state.bigBlind),
    ante: cleanNum(state.ante),
    tableSize: state.seats.length,
    seats: state.seats.map((s) => ({
      name: s.name,
      stack: cleanNum(s.stack),
      sittingOut: s.sittingOut,
      occupied: s.occupied,
    })),
  };
}

// Bare position labels serialize.ts emits when a seat has no custom name. When a
// seat line uses one of these, there is no real name to copy.
const POSITION_LABEL = /^(?:BTN|SB|BB|UTG(?:\+\d+)?|MP(?:\+\d+)?|LJ|HJ|CO|P\d+)$/;

// A seat listing line: "David: $100.00", "UTG: $100.00", "David (Hero): $50.00".
const SEAT_LINE = /^(.+): \$([\d.]+)$/;

// Stakes summary line: "$<bb> <NL|PL> - <Game> - <n> players". Older hands
// prefixed it with a "<site> - " segment; matching from the "$<bb>" onward reads
// both the old and the new (site-less) header.
const HEADER = /\$([\d.]+)\s+(?:NL|PL)\s+-\s+(\S+)\s+-\s+(\d+)\s+players/;

// Drop trailing zeros so inputs read "0.5"/"100" instead of "0.50"/"100.00".
function cleanNum(raw: string): string {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

// serialize.ts's gameName() mapping, reversed. Order matters: "Omaha5" before "Omaha".
function gameFromLabel(label: string): string {
  if (label === "Omaha5") return "PLO5";
  if (label === "Omaha") return "PLO";
  if (label === "Holdem") return "Holdem";
  return label; // "Other" or anything unrecognized passes through
}

// The name to copy from a seat label, or "" when the label is just a position
// (or the hero marker), i.e. the seat had no custom name.
function nameFromLabel(label: string): string {
  let l = label.trim();
  const named = l.match(/^(.*) \(Hero\)$/); // new format: "David (Hero)"
  if (named) l = named[1].trim();
  if (l === "Hero" || /^Hero \(.+\)$/.test(l)) return ""; // "Hero" / old "Hero (BTN)"
  if (POSITION_LABEL.test(l)) return "";
  return l;
}

export function parseHandDefaults(rawText: string): HandDefaults {
  // Lossless path: newer hands embed the full state, which keeps sitting-out
  // seats the text-only parse below can't see.
  const replay = parseReplay(rawText);
  if (replay) return defaultsFromState(replay.state);

  const out: HandDefaults = {};
  const lines = rawText.split("\n");

  for (const line of lines) {
    const m = line.match(HEADER);
    if (m) {
      out.bigBlind = cleanNum(m[1]);
      out.game = gameFromLabel(m[2]);
      break;
    }
  }

  const sb = rawText.match(/posts SB \$([\d.]+)/);
  if (sb) out.smallBlind = cleanNum(sb[1]);

  const ante = rawText.match(/Ante \$([\d.]+) total/);
  if (ante) out.ante = cleanNum(ante[1]);

  // The seats block is the first maximal run of consecutive "Name: $stack" lines.
  const seats: { name: string; stack: string }[] = [];
  let inRun = false;
  for (const line of lines) {
    const m = line.match(SEAT_LINE);
    if (m) {
      seats.push({ name: nameFromLabel(m[1]), stack: cleanNum(m[2]) });
      inRun = true;
    } else if (inRun) {
      break; // run ended
    }
  }
  if (seats.length) {
    out.seats = seats;
    out.tableSize = seats.length;
  }

  return out;
}
