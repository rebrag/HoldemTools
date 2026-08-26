// src/lib/solver/defaultRanges.ts
//
// Canned preflop ranges used to seed the tree-building panel when a game tree
// is built from a recorded hand (which, unlike a preflop sim, carries no range
// information). These are deliberately coarse, chart-style approximations -
// the user reviews and edits them in the range editor before uploading.
//
// Ranges are written in standard shorthand ("TT+", "ATs+", "A5s-A2s", "KQo")
// and expanded to 169-class weight maps. A trailing ":0.5" on a token sets a
// partial weight.

const RANKS = "AKQJT98765432";
const rankIdx = (r: string) => RANKS.indexOf(r);

const expandToken = (token: string, out: Record<string, number>) => {
  let weight = 1;
  let t = token.trim();
  const wMatch = t.match(/^(.*):([0-9.]+)$/);
  if (wMatch) {
    t = wMatch[1];
    weight = Number(wMatch[2]);
  }
  if (!t) return;

  const put = (hand: string) => {
    out[hand] = weight;
  };

  // Pair runs: "TT+" or "99-66" or "55"
  const pairPlus = t.match(/^([2-9TJQKA])\1\+$/);
  if (pairPlus) {
    for (let i = rankIdx(pairPlus[1]); i >= 0; i--) put(RANKS[i] + RANKS[i]);
    return;
  }
  const pairRun = t.match(/^([2-9TJQKA])\1-([2-9TJQKA])\2$/);
  if (pairRun) {
    const hi = rankIdx(pairRun[1]);
    const lo = rankIdx(pairRun[2]);
    for (let i = Math.min(hi, lo); i <= Math.max(hi, lo); i++) put(RANKS[i] + RANKS[i]);
    return;
  }

  // Kicker runs: "ATs+" (ATs..AKs) / "A5s-A2s"
  const plus = t.match(/^([2-9TJQKA])([2-9TJQKA])([so])\+$/);
  if (plus) {
    const hi = rankIdx(plus[1]);
    for (let k = rankIdx(plus[2]); k > hi; k--) put(plus[1] + RANKS[k] + plus[3]);
    return;
  }
  const run = t.match(/^([2-9TJQKA])([2-9TJQKA])([so])-([2-9TJQKA])([2-9TJQKA])([so])$/);
  if (run && run[1] === run[4] && run[3] === run[6]) {
    const a = rankIdx(run[2]);
    const b = rankIdx(run[5]);
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) put(run[1] + RANKS[k] + run[3]);
    return;
  }

  // Single class: "AKo", "76s", "TT"
  if (/^([2-9TJQKA])\1$/.test(t) || /^[2-9TJQKA]{2}[so]$/.test(t)) {
    put(t);
    return;
  }

  if (import.meta.env.DEV) console.warn(`defaultRanges: unparsed range token "${token}"`);
};

export const expandRange = (spec: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const token of spec.split(",")) expandToken(token, out);
  return out;
};

export type PreflopRole =
  | "open"
  | "flatCall"
  | "threeBet"
  | "threeBetCall"
  | "bbDefend"
  | "limp";

/** Position groups collapse: UTG1 uses the UTG chart, SB opens like the BTN. */
const OPEN: Record<string, string> = {
  UTG: "77+,ATs+,KTs+,QTs+,JTs,T9s,98s,A5s:0.5,A4s:0.5,AJo+,KQo",
  UTG1: "66+,A9s+,KTs+,QTs+,J9s+,T9s,98s,87s,A5s-A3s:0.5,ATo+,KQo",
  LJ: "55+,A7s+,K9s+,Q9s+,J9s+,T8s+,97s+,87s,76s,A5s-A2s:0.5,ATo+,KJo+,QJo",
  HJ: "44+,A2s+,K8s+,Q9s+,J8s+,T8s+,97s+,86s+,76s,65s,A9o+,KTo+,QTo+,JTo",
  CO: "22+,A2s+,K5s+,Q8s+,J8s+,T7s+,96s+,86s+,75s+,65s,54s,A8o+,A5o:0.5,KTo+,QTo+,JTo,T9o",
  BTN: "22+,A2s+,K2s+,Q4s+,J6s+,T6s+,95s+,85s+,74s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T8o+,98o,87o",
  SB: "22+,A2s+,K2s+,Q4s+,J6s+,T6s+,95s+,85s+,74s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T8o+,98o,87o",
};

const FLAT_CALL =
  "22-QQ,AQs-ATs,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,A5s-A4s:0.5,AQo,AJo:0.5,KQo:0.5";

const THREE_BET =
  "JJ+,TT:0.5,AKs,AKo,AQs,AJs:0.5,A5s:0.5,A4s:0.5,KQs:0.5";

const THREE_BET_CALL =
  "88+,AQs+,AQo:0.5,AKo,AJs:0.5,KQs:0.5,JTs:0.5,T9s:0.5";

const BB_DEFEND =
  "22+,A2s+,K2s+,Q2s+,J4s+,T6s+,95s+,84s+,74s+,63s+,53s+,43s,A2o+,K7o+,Q8o+,J8o+,T7o+,97o+,87o,76o:0.5,65o:0.5";

const LIMP =
  "22-88,A2s-A9s,K5s+:0.5,QTs,JTs,T9s,98s,87s,76s,65s,54s,ATo-A7o:0.5,KTo:0.5,QTo:0.5,JTo:0.5";

/** Heuristic default range for a seat given how it entered the pot preflop.
 *  Positions must be solver-canonical (see POSTFLOP_ORDER). */
export const getDefaultRange = (
  solverPos: string,
  role: PreflopRole
): Record<string, number> => {
  switch (role) {
    case "open":
      return expandRange(OPEN[solverPos] ?? OPEN.CO);
    case "flatCall":
      return expandRange(FLAT_CALL);
    case "threeBet":
      return expandRange(THREE_BET);
    case "threeBetCall":
      return expandRange(THREE_BET_CALL);
    case "bbDefend":
      return expandRange(BB_DEFEND);
    case "limp":
      return expandRange(LIMP);
  }
};

/* ---------- the built-in library ----------
 *
 * The same charts above, exposed as a browsable read-only tree so the range
 * picker is useful before a user has saved anything of their own. These are the
 * only ranges a signed-out user sees.
 *
 * Kept as specs rather than expanded weight maps: expansion is cheap and doing
 * it lazily keeps 169-key objects out of the module's startup cost. */

export interface BuiltinRange {
  /** Stable id, used as a React key and as the picker's selection token. */
  id: string;
  name: string;
  spec: string;
}

export interface BuiltinFolder {
  id: string;
  name: string;
  ranges: BuiltinRange[];
}

const OPEN_ORDER = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB"] as const;

export const BUILTIN_RANGE_FOLDERS: BuiltinFolder[] = [
  {
    id: "builtin-opens",
    name: "Opens",
    ranges: OPEN_ORDER.map((pos) => ({
      id: `builtin-open-${pos}`,
      name: `${pos} open`,
      spec: OPEN[pos],
    })),
  },
  {
    id: "builtin-vs-open",
    name: "Facing an open",
    ranges: [
      { id: "builtin-flat", name: "Flat call", spec: FLAT_CALL },
      { id: "builtin-3bet", name: "3-bet", spec: THREE_BET },
      { id: "builtin-bb-defend", name: "BB defend", spec: BB_DEFEND },
    ],
  },
  {
    id: "builtin-other",
    name: "Other spots",
    ranges: [
      { id: "builtin-3bet-call", name: "Call a 3-bet", spec: THREE_BET_CALL },
      { id: "builtin-limp", name: "Limp", spec: LIMP },
    ],
  },
];
