// src/components/ChipStack.tsx
// Renders a poker bet or pot as a visual chip stack. Every metric — chip
// radius, stack overlap, spread step, amount-label font and gap — derives from
// the single `chipRadius` prop, so a caller sizes the whole block (chips AND
// label) with one number instead of transform-scaling the rendered output.
import { useMemo } from "react";

// ─── Chip definitions ────────────────────────────────────────────────────────
// Standard US casino cash-game denominations, largest first.
interface ChipDef {
  value: number;
  label: string;
  color: string;
  stripe: string;
  edge: string;
  text: string;
}

const CHIP_DEFS: ChipDef[] = [
  { value: 5000, label: "$5k",  color: "#C94040", stripe: "#E87070", edge: "#A33030", text: "#fff" },
  { value: 1000, label: "$1k",  color: "#E8A020", stripe: "#F5C060", edge: "#C07010", text: "#fff" },
  { value: 500,  label: "$500", color: "#7B4BB8", stripe: "#A87DE0", edge: "#5A3490", text: "#fff" },
  { value: 100,  label: "$100", color: "#222222", stripe: "#555555", edge: "#111111", text: "#eee" },
  { value: 25,   label: "$25",  color: "#2E8B57", stripe: "#5DBE85", edge: "#1C6640", text: "#fff" },
  { value: 5,    label: "$5",   color: "#C0392B", stripe: "#E26050", edge: "#922B21", text: "#fff" },
  { value: 1,    label: "$1",   color: "#DADADA", stripe: "#ffffff", edge: "#AAAAAA", text: "#333" },
];

const MAX_SINGLE  = 20; // chips per column in a vertical tower
const MAX_PER_ROW = 12; // chips per row in a horizontal spread before wrapping

// Ratios of the historical constants at the original 21px radius, so the
// default render is pixel-identical to the pre-`chipRadius` component:
// OVERLAP 8/21, H_STEP 15/21, H_ROW_GAP 6/21.
const OVERLAP_RATIO   = 0.38; // vertical overlap between chips in a tower
// The spread step is wider than the tower overlap because a spread reads by
// chip FACE, not by edge. Deliberately tight (~75% overlap): the row stays
// compact on the felt, and the top chip plus the amount pill carry the
// reading — the buried denominations are texture, not information.
const H_STEP_RATIO    = 0.5; // px between chip centers in a spread
const H_ROW_GAP_RATIO = 0.29; // px between wrapped spread rows

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Break `amount` into the fewest chips, largest denomination first. */
function decompose(amount: number): (ChipDef & { count: number })[] {
  let rem = Math.round(amount);
  return CHIP_DEFS.map((c) => {
    const count = Math.floor(rem / c.value);
    rem -= count * c.value;
    return { ...c, count };
  }).filter((c) => c.count > 0);
}

/**
 * Shared gradients + drop-shadow filter, defined once per <svg>. The gloss and
 * inner-shade gradients use objectBoundingBox units so each <circle> re-centres
 * them, echoing the felt's top-lit specular sheen (PokerTableSurface).
 */
function ChipDefs() {
  return (
    <defs>
      {/* Top-lit sheen (bright near the top of each chip, fading out). */}
      <radialGradient id="chipGloss" cx="0.5" cy="0.3" r="0.75">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.34" />
        <stop offset="55%"  stopColor="#ffffff" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      {/* Soft radial shade at the base of the center disc for a sunken inlay. */}
      <radialGradient id="chipInner" cx="0.5" cy="0.62" r="0.72">
        <stop offset="55%"  stopColor="#000000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
      </radialGradient>
      {/* Depth shadow, matching the shadow-md language of the badges/felt. */}
      <filter id="chipShadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#000" floodOpacity="0.4" />
      </filter>
    </defs>
  );
}

/** SVG elements for a single chip centred at (cx, cy). */
function ChipFace({ cx, cy, chip, r }: { cx: number; cy: number; chip: ChipDef; r: number }) {
  const body = r * 0.93;      // chip body inside the darker edge ring
  const ringR = r * 0.80;     // decorative inlay ring on the felt
  const ir = r * 0.60;        // center disc (holds the label)
  const fs = Math.max(5, Math.round(r * 0.38));

  // Edge spots: short rounded dashes around the rim, poker-chip style.
  const nc = 8;
  const spotW = r * 0.16;
  const spotH = r * 0.30;
  const spots = Array.from({ length: nc }, (_, i) => {
    const deg = (i / nc) * 360;
    return (
      <rect
        key={i}
        x={cx - spotW / 2}
        y={cy - r + r * 0.02}
        width={spotW}
        height={spotH}
        rx={spotW / 2}
        fill={chip.stripe}
        transform={`rotate(${deg} ${cx} ${cy})`}
      />
    );
  });

  return (
    <g filter="url(#chipShadow)">
      {/* darker edge ring + main body */}
      <circle cx={cx} cy={cy} r={r}    fill={chip.edge} />
      <circle cx={cx} cy={cy} r={body} fill={chip.color} />
      {spots}
      {/* thin emerald-neutral inlay ring, echoing the felt's rim rings */}
      <circle
        cx={cx} cy={cy} r={ringR}
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={Math.max(0.6, r * 0.04)}
      />
      {/* sunken center disc with a soft inner shade */}
      <circle cx={cx} cy={cy} r={ir} fill={chip.color} />
      <circle cx={cx} cy={cy} r={ir} fill="url(#chipInner)" />
      <circle
        cx={cx} cy={cy} r={ir}
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth={Math.max(0.5, r * 0.035)}
      />
      {/* top-lit specular sheen over the whole chip */}
      <circle cx={cx} cy={cy} r={r} fill="url(#chipGloss)" />
      <text
        x={cx}
        y={cy + fs * 0.36}
        textAnchor="middle"
        fontSize={fs}
        fontWeight="600"
        fill={chip.text}
        fontFamily="system-ui, sans-serif"
        letterSpacing="-0.3"
      >
        {chip.label}
      </text>
    </g>
  );
}

/** Split `chips` into groups of at most `max`, preserving order. */
function chunk<T>(chips: T[], max: number): T[][] {
  const groups: T[][] = [];
  const rem = [...chips];
  while (rem.length) groups.push(rem.splice(0, max));
  return groups;
}

/**
 * Render an ordered array of chips, either as vertical towers (default) or as
 * a horizontal spread.
 *
 * Vertical: columns of at most MAX_SINGLE, each chip stacked on the one below.
 * Horizontal: rows of at most MAX_PER_ROW, laid left→right and wrapping upward.
 *
 * Either way later chips paint over earlier ones, so passing the list smallest
 * denomination first puts the big chips on top — the tower's crown, the
 * spread's right edge.
 *
 * Returns an <svg> element sized to fit exactly.
 */
function StackSVG({ chips, r, horizontal }: { chips: ChipDef[]; r: number; horizontal: boolean }) {
  const D = r * 2;
  const overlap = r * OVERLAP_RATIO;
  const hStep = r * H_STEP_RATIO;
  const hRowGap = Math.max(2, Math.round(r * H_ROW_GAP_RATIO));
  // Breathing room for the drop shadow at the stack's base.
  const vPad = Math.round(r * OVERLAP_RATIO);
  const hPad = Math.round(r * 0.19);

  const groups = chunk(chips, horizontal ? MAX_PER_ROW : MAX_SINGLE);
  const longest = Math.max(...groups.map((g) => g.length));

  const svgW = horizontal
    ? (longest - 1) * hStep + D
    : groups.length * D + (groups.length - 1) * 10;
  const svgH = horizontal
    ? groups.length * (D + hRowGap) - hRowGap + hPad * 2
    : longest * overlap + (D - overlap) + vPad * 2;

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <ChipDefs />
      {groups.map((group, groupIdx) =>
        group.map((chip, i) => {
          // Horizontal: rows fill from the bottom up, so the first (smallest)
          // chips sit on the front row nearest the reader.
          const cx = horizontal ? r + i * hStep : r + groupIdx * (D + 10);
          const cy = horizontal
            ? svgH - r - hPad - groupIdx * (D + hRowGap)
            : svgH - r - vPad - i * overlap;
          return <ChipFace key={`${groupIdx}-${i}`} cx={cx} cy={cy} chip={chip} r={r} />;
        })
      )}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ChipStackProps {
  /** Bet amount in chips/dollars. Non-positive renders nothing. */
  amount: number;
  /** Chip radius in px; every other metric derives from it. Default 21. */
  chipRadius?: number;
  /** Spread the chips left→right instead of stacking them upward. Use where
   *  vertical growth would collide with something above — the pot sitting
   *  under the board. */
  horizontal?: boolean;
  /** Show the bet amount next to the chips (default true). */
  showAmount?: boolean;
  /** Preformatted amount label ("2 BB", "SB 0.5"); falls back to $amount. */
  amountText?: string;
  /** Where the amount renders relative to the chips. "right" keeps the whole
   *  block a single short row — the poker table's bet/pot layout. */
  amountPlacement?: "below" | "right";
  /** Styling for the amount label (e.g. a pill). Font size and the chip↔label
   *  gap stay size-derived so they scale with `chipRadius`. */
  amountClassName?: string;
}

export default function ChipStack({
  amount,
  chipRadius = 21,
  horizontal = false,
  showAmount = true,
  amountText,
  amountPlacement = "below",
  amountClassName,
}: ChipStackProps) {
  // Flatten into one draw list: decompose() is largest-first, and SVG paints
  // in order, so reverse it — small chips first (the base), big chips last
  // (the tower's crown, the spread's front-right).
  const chipList = useMemo(() => {
    const flat: ChipDef[] = [];
    for (const c of [...decompose(amount)].reverse()) {
      for (let i = 0; i < c.count; i++) flat.push(c);
    }
    return flat;
  }, [amount]);

  const r = chipRadius;
  const label =
    amount > 0 && showAmount ? amountText ?? `$${amount.toLocaleString()}` : null;

  // A sub-half-unit amount rounds to zero chips but keeps its label, so a
  // tiny bet still reads on the table.
  if (!amount || amount <= 0 || (chipList.length === 0 && label == null))
    return null;
  const labelFontSize = Math.min(15, Math.max(8, Math.round(r * 0.86)));
  const gap = Math.round(r * H_ROW_GAP_RATIO);

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: amountPlacement === "right" ? "row" : "column",
        alignItems: "center",
        gap,
      }}
    >
      {chipList.length > 0 && (
        <StackSVG chips={chipList} r={r} horizontal={horizontal} />
      )}
      {label != null && (
        <span
          className={amountClassName}
          style={{
            fontSize: labelFontSize,
            fontWeight: 700,
            whiteSpace: "nowrap",
            fontFamily: "system-ui, sans-serif",
            letterSpacing: "-0.01em",
            ...(amountClassName ? {} : { color: "var(--color-text-primary, #111)" }),
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
