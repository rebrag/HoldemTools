// src/components/treeBuildingView.ts
//
// The one shape the shared tree-building UI edits, plus the pure helpers that
// go with it. Kept out of TreeBuilding.tsx so the Playwright pure-logic specs
// can import it without React.
//
// Deliberately identical, field for field, to the /compare page's existing
// TreeConfigText plus the three knobs that are ours alone. That is not a
// coincidence and it is not cosmetic: because BuilderState is a structural
// superset of this type, /compare's adapter is a widening rather than a copy,
// and serializeTreeConfigText literally cannot observe that the refactor
// happened. Byte-identity of the PioViewer clipboard text therefore holds by
// construction, not by assertion.
//
// The solver / hand-history side does need a real conversion, because it
// speaks Pio integer chips and optional fields - see lib/solver/treeParamsView.ts.

export type TreeStreet = "flop" | "turn" | "river";
export const TREE_STREETS: TreeStreet[] = ["flop", "turn", "river"];

export type TreeSeat = "oop" | "ip";

/**
 * One street's boxes for one seat.
 *
 * ALWAYS strings, `""` for empty, never `undefined`, and never trimmed - this
 * is the text the user typed, verbatim. Both serializers gate their output on
 * plain truthiness, so `""` and `undefined` are equivalent at emit time while
 * `" "` is not; normalising here would change what leaves the app.
 */
export interface TreeStreetView {
  bet: string;
  raise: string;
  /** OOP only: lead into the previous street's aggressor. */
  donk: string;
  addAllin: boolean;
  /** IP only, htsolver only. Has no representation in PioViewer's format. */
  noThreeBet: boolean;
}

export type TreeSeatView = Record<TreeStreet, TreeStreetView>;

export interface TreeBuildingView {
  oopRange: Record<string, number>;
  ipRange: Record<string, number>;
  /** Raw board text as typed; parse it, never store cards here. */
  board: string;
  /** DISPLAY money, as typed - never a number. The solver adapter multiplies
   *  by its frozen chip scale on the way out. */
  pot: string;
  effectiveStacks: string;
  /** % of the effective stack, as typed. */
  allinThresholdPct: string;
  /** #AddAllinOnlyIfLessThanThisTimesThePot#, % of pot, as typed. */
  addAllinCapPct: string;
  /** "" when the max-raises control is hidden. */
  maxRaises: string;
  /** "none" when the aggressor control is hidden. */
  preflopAggressor: "none" | "ip" | "oop";
  /** PioViewer's "Change only betting structure when loading configuration". */
  betStructureOnly: boolean;
  oop: TreeSeatView;
  ip: TreeSeatView;
}

export const emptyStreetView = (): TreeStreetView => ({
  bet: "",
  raise: "",
  donk: "",
  addAllin: false,
  noThreeBet: false,
});

export const emptySeatView = (): TreeSeatView => ({
  flop: emptyStreetView(),
  turn: emptyStreetView(),
  river: emptyStreetView(),
});

export const cloneSeatView = (s: TreeSeatView): TreeSeatView => ({
  flop: { ...s.flop },
  turn: { ...s.turn },
  river: { ...s.river },
});

/* ─────────────────────────── size syntax ─────────────────────────── */

/** A percent-of-pot list, or Pio's "a" for all-in. Separators are spaces or
 *  commas; this is the looser of the two regexes the pre-refactor screens
 *  used, and it only ever governs whether a box shows a red border. */
const SIZE_RE = /^(a|\d+(\.\d+)?)([\s,]+(a|\d+(\.\d+)?))*$/i;

export const sizeOk = (v: string | undefined): boolean =>
  !v || !v.trim() || SIZE_RE.test(v.trim());

/** A street needs at least one lead size - a plain bet, or (OOP turn/river) a
 *  donk. Raise sizes stay optional. */
export const streetHasLead = (s: TreeStreetView): boolean =>
  !!(s.bet.trim() || s.donk.trim());

/* ─────────────────────────── the deck ─────────────────────────── */

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const SUITS = ["h", "d", "c", "s"] as const;
export const ALL_CARDS: string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

/**
 * Every card a board string names, in order.
 *
 * Deliberately forgiving and deliberately NOT de-duplicating: it accepts
 * "AhKd9c" as readily as "Ah Kd 9c", and a repeated card survives to be
 * rejected later with a readable message rather than vanishing under the
 * cursor while it is being typed. pages/compare/treeConfigText.ts re-exports
 * this so the serializer and the panel can never disagree about what a board
 * string means.
 */
export const parseBoardCards = (board: string): string[] =>
  (board.match(/[2-9TJQKA][hdcs]/gi) ?? []).map(
    (c) => c[0].toUpperCase() + c[1].toLowerCase()
  );

/** A random board of `count` cards. Fisher-Yates over a fresh deck. */
export const randomBoard = (count: number): string[] => {
  const deck = [...ALL_CARDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, count);
};

/**
 * Parse a typed board like "AhKd9c" / "Ah Kd 9c" into card codes, reporting
 * why it failed. Used where the board field is strict (the flop-only screens);
 * the 3-5 card screen uses the silent parseBoardCards instead.
 */
export function parseBoardInputStrict(
  raw: string,
  maxCards: number
): { cards: string[]; error: string | null } {
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, "").trim();
  if (!stripped) return { cards: [], error: null };

  const upper = stripped.toUpperCase();

  if (upper.length > maxCards * 2) {
    return {
      cards: [],
      error: `Please enter at most ${maxCards} cards, e.g. "AhKd9c" or "Ah Kd 9c".`,
    };
  }
  if (upper.length % 2 !== 0) {
    return { cards: [], error: 'Finish the card you\'re typing, e.g. "9c".' };
  }

  const parsed: string[] = [];
  for (let i = 0; i < upper.length; i += 2) {
    const rank = upper[i];
    const suitChar = upper[i + 1];
    if (!RANKS.includes(rank as (typeof RANKS)[number])) {
      return { cards: [], error: `Unknown rank "${rank}". Use A,K,Q,J,T,9..2.` };
    }
    const suitLower = suitChar.toLowerCase();
    if (!SUITS.includes(suitLower as (typeof SUITS)[number])) {
      return { cards: [], error: `Unknown suit "${suitChar}". Use h,d,c,s.` };
    }
    const code = `${rank}${suitLower}`;
    if (parsed.includes(code)) {
      return { cards: [], error: "Cards must be unique." };
    }
    parsed.push(code);
  }
  return { cards: parsed, error: null };
}

/* ─────────────────────────── clipboard ─────────────────────────── */

/** The spot half of a parsed config: everything except the sizing boxes. */
export type TreeSpotView = Partial<
  Omit<TreeBuildingView, "oop" | "ip" | "maxRaises" | "preflopAggressor" | "betStructureOnly">
>;

/**
 * PioViewer clipboard interop, injected into the panel rather than imported by
 * it. The codec itself lives beside the format it speaks
 * (pages/compare/treeConfigText.ts) and nothing in src/components may import
 * from src/pages, so the dependency has to point this way.
 *
 * Passing it also doubles as the feature flag: a screen that cannot round-trip
 * through PioViewer simply has no codec to give.
 */
export interface TreeClipboardCodec {
  serialize: (v: TreeBuildingView) => string;
  /** Throws with a readable message when the text is clearly not a config. */
  parse: (text: string) => { spot: TreeSpotView; oop: TreeSeatView; ip: TreeSeatView };
}

/* ─────────────────────────── validation ─────────────────────────── */

export interface TreeViewIssues {
  /** Boxes whose text fails the percent-list syntax check. */
  badSizes: { seat: TreeSeat; street: TreeStreet; field: "bet" | "raise" | "donk" }[];
  /** Streets with neither a bet nor a donk size. Empty unless required. */
  missingLead: { seat: TreeSeat; street: TreeStreet }[];
}

/**
 * Everything both screens need to decide whether to mark a box red or block a
 * confirm. Pages keep owning what they DO about it: the solver disables its
 * upload button, /compare lets buildEngineConfig throw a readable message.
 */
export const inspectTreeView = (
  v: TreeBuildingView,
  opts: { requireLeadSizePerStreet: boolean }
): TreeViewIssues => {
  const badSizes: TreeViewIssues["badSizes"] = [];
  const missingLead: TreeViewIssues["missingLead"] = [];

  for (const seat of ["oop", "ip"] as const) {
    for (const street of TREE_STREETS) {
      const boxes = v[seat][street];
      for (const field of ["bet", "raise", "donk"] as const) {
        if (!sizeOk(boxes[field])) badSizes.push({ seat, street, field });
      }
      if (opts.requireLeadSizePerStreet && !streetHasLead(boxes)) {
        missingLead.push({ seat, street });
      }
    }
  }

  return { badSizes, missingLead };
};
