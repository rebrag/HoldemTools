// src/pages/compare/savedTreePayload.ts
//
// A BuilderState <-> the text stored in SavedTree.Config, both directions.
//
// The bulk of a tree is already expressible as PioViewer's own clipboard text,
// and that codec (treeConfigText.ts) is round-trip tested byte for byte against
// PioViewer itself. So a saved tree is that text, wrapped in a thin JSON
// envelope carrying only the fields the PioViewer format has no key for. The
// payload therefore stays legible in a database client, and the one piece of it
// that has to be exactly right is code that was already exercised.
//
// THE TRAP THIS FILE EXISTS TO AVOID: serializeTreeConfigText DELIBERATELY
// omits `noThreeBet` - PioViewer's format has no field it can round-trip, and
// emitting a guessed key would make the text fail to paste back into PioViewer
// (see treeConfigText.ts). Every one of those flags therefore has to travel in
// the envelope, or saving and reloading a tree would silently un-tick them.
//
// `betStructureOnly` is deliberately NOT persisted: it is a preference about
// how the next paste behaves, not a property of a tree.
import { DEFAULT_BUILDER, type BuilderState } from "./builderState";
import {
  parseTreeConfigText,
  serializeTreeConfigText,
  type StreetKey,
} from "./treeConfigText";
import { TREE_STREETS, type TreeSeat } from "@/components/treeBuildingView";

/** Bumped only when an older envelope can no longer be read as-is. */
const SCHEMA = 1;

type NoThreeBetFlags = Record<TreeSeat, Record<StreetKey, boolean>>;

interface SavedTreeEnvelope {
  v: number;
  /** serializeTreeConfigText output: ranges, board, pot, stacks, thresholds
   *  and all six sizing cards. */
  pio: string;
  /* ---- the tree knobs PioViewer's format cannot carry ---- */
  maxRaises: string;
  preflopAggressor: BuilderState["preflopAggressor"];
  noThreeBet: NoThreeBetFlags;
  /* ---- /compare's own solve settings ---- */
  accuracyMode: BuilderState["accuracyMode"];
  accuracy: string;
  maxIterations: string;
  updateRule: BuilderState["updateRule"];
  /* QRE settings. Additive: `pick()` below leaves an older envelope's
   * builder values alone, so no SCHEMA bump and no migration. */
  qreLambdaOop?: string;
  qreLambdaIp?: string;
  qreAnneal?: boolean;
  qreAnnealFactor?: string;
  qreAnnealAt?: string;
  isomorphism: boolean;
  recalc: boolean;
  sampling: boolean;
  samplingRunouts: string;
  samplingAnnealAt: string;
}

const readFlags = (b: BuilderState): NoThreeBetFlags => ({
  oop: Object.fromEntries(
    TREE_STREETS.map((s) => [s, b.oop[s].noThreeBet])
  ) as Record<StreetKey, boolean>,
  ip: Object.fromEntries(
    TREE_STREETS.map((s) => [s, b.ip[s].noThreeBet])
  ) as Record<StreetKey, boolean>,
});

export const serializeSavedTree = (b: BuilderState): string => {
  const envelope: SavedTreeEnvelope = {
    v: SCHEMA,
    pio: serializeTreeConfigText(b),
    maxRaises: b.maxRaises,
    preflopAggressor: b.preflopAggressor,
    noThreeBet: readFlags(b),
    accuracyMode: b.accuracyMode,
    accuracy: b.accuracy,
    maxIterations: b.maxIterations,
    updateRule: b.updateRule,
    qreLambdaOop: b.qreLambdaOop,
    qreLambdaIp: b.qreLambdaIp,
    qreAnneal: b.qreAnneal,
    qreAnnealFactor: b.qreAnnealFactor,
    qreAnnealAt: b.qreAnnealAt,
    isomorphism: b.isomorphism,
    recalc: b.recalc,
    sampling: b.sampling,
    samplingRunouts: b.samplingRunouts,
    samplingAnnealAt: b.samplingAnnealAt,
  };
  return JSON.stringify(envelope);
};

/** Fall back to the current value rather than to a hardcoded default, so a
 *  field an older envelope predates keeps whatever the builder already has
 *  instead of snapping back to DEFAULT_BUILDER mid-session. */
const pick = <T>(value: T | undefined, fallback: T): T =>
  value === undefined ? fallback : value;

/**
 * Load a stored tree over the current builder state.
 *
 * Throws with a readable message on anything that is not one of our envelopes;
 * the panel surfaces it the same way a bad paste is surfaced.
 */
export const applySavedTree = (prev: BuilderState, stored: string): BuilderState => {
  let envelope: Partial<SavedTreeEnvelope>;
  try {
    envelope = JSON.parse(stored) as Partial<SavedTreeEnvelope>;
  } catch {
    throw new Error("That saved tree is not readable - it may have been written by a newer version.");
  }
  if (!envelope || typeof envelope.pio !== "string") {
    throw new Error("That saved tree is missing its tree configuration.");
  }

  // Throws its own readable message when the inner text is not a config.
  const parsed = parseTreeConfigText(envelope.pio);

  const flags = envelope.noThreeBet;
  const withFlags = (seat: TreeSeat) =>
    Object.fromEntries(
      TREE_STREETS.map((street) => [
        street,
        {
          ...parsed[seat][street],
          // Absent flags read as false, matching a tree that never set them -
          // NOT as `prev`'s, which belongs to whatever was loaded before.
          noThreeBet: flags?.[seat]?.[street] ?? false,
        },
      ])
    ) as BuilderState["oop"];

  return {
    ...prev,
    ...parsed.spot,
    oop: withFlags("oop"),
    ip: withFlags("ip"),
    maxRaises: pick(envelope.maxRaises, DEFAULT_BUILDER.maxRaises),
    preflopAggressor: pick(envelope.preflopAggressor, DEFAULT_BUILDER.preflopAggressor),
    accuracyMode: pick(envelope.accuracyMode, prev.accuracyMode),
    accuracy: pick(envelope.accuracy, prev.accuracy),
    maxIterations: pick(envelope.maxIterations, prev.maxIterations),
    updateRule: pick(envelope.updateRule, DEFAULT_BUILDER.updateRule),
    qreLambdaOop: pick(envelope.qreLambdaOop, DEFAULT_BUILDER.qreLambdaOop),
    qreLambdaIp: pick(envelope.qreLambdaIp, DEFAULT_BUILDER.qreLambdaIp),
    qreAnneal: pick(envelope.qreAnneal, DEFAULT_BUILDER.qreAnneal),
    qreAnnealFactor: pick(envelope.qreAnnealFactor, DEFAULT_BUILDER.qreAnnealFactor),
    qreAnnealAt: pick(envelope.qreAnnealAt, DEFAULT_BUILDER.qreAnnealAt),
    isomorphism: pick(envelope.isomorphism, DEFAULT_BUILDER.isomorphism),
    recalc: pick(envelope.recalc, DEFAULT_BUILDER.recalc),
    sampling: pick(envelope.sampling, DEFAULT_BUILDER.sampling),
    samplingRunouts: pick(envelope.samplingRunouts, DEFAULT_BUILDER.samplingRunouts),
    samplingAnnealAt: pick(envelope.samplingAnnealAt, DEFAULT_BUILDER.samplingAnnealAt),
  };
};
