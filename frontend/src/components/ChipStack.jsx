import { useMemo } from "react";

// ─── Chip definitions ────────────────────────────────────────────────────────
// Standard US casino cash-game denominations, largest first.
const CHIP_DEFS = [
  { value: 5000, label: "$5k",  color: "#C94040", stripe: "#E87070", edge: "#A33030", text: "#fff" },
  { value: 1000, label: "$1k",  color: "#E8A020", stripe: "#F5C060", edge: "#C07010", text: "#fff" },
  { value: 500,  label: "$500", color: "#7B4BB8", stripe: "#A87DE0", edge: "#5A3490", text: "#fff" },
  { value: 100,  label: "$100", color: "#222222", stripe: "#555555", edge: "#111111", text: "#eee" },
  { value: 25,   label: "$25",  color: "#2E8B57", stripe: "#5DBE85", edge: "#1C6640", text: "#fff" },
  { value: 5,    label: "$5",   color: "#C0392B", stripe: "#E26050", edge: "#922B21", text: "#fff" },
  { value: 1,    label: "$1",   color: "#DADADA", stripe: "#ffffff", edge: "#AAAAAA", text: "#333" },
];

const CHIP_R       = 21;   // radius in px (~20% smaller than the original 26)
const OVERLAP      = 8;    // vertical overlap between chips in a stack
const MAX_SINGLE   = 20;   // chips per column in single-stack mode
const MAX_PER_DENOM = 12;  // chips per column in multi-stack mode

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Break `amount` into the fewest chips, largest denomination first. */
function decompose(amount) {
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
function ChipFace({ cx, cy, chip, r = CHIP_R }) {
  const body = r * 0.93;      // chip body inside the darker edge ring
  const ringR = r * 0.80;     // decorative inlay ring on the felt
  const ir = r * 0.60;        // center disc (holds the label)
  const fs = r < 13 ? 6 : r < 18 ? 7 : 8;

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

/**
 * Render one or more columns of chips for a given ordered array of chip objects.
 * `maxPerCol` controls when a new column starts.
 * Returns an <svg> element sized to fit exactly.
 */
function StackSVG({ chips, maxPerCol, label }) {
  const D = CHIP_R * 2;
  const cols = Math.ceil(chips.length / maxPerCol);
  const svgW = cols * D + (cols - 1) * 10;

  // Split into columns
  const groups = [];
  let rem = [...chips];
  for (let c = 0; c < cols; c++) groups.push(rem.splice(0, maxPerCol));

  const maxInCol = Math.max(...groups.map((g) => g.length));
  const svgH = maxInCol * OVERLAP + (D - OVERLAP) + 16;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: "visible" }}
        aria-hidden="true"
      >
        <ChipDefs />
        {groups.map((group, colIdx) => {
          const cx = CHIP_R + colIdx * (D + 10);
          return group.map((chip, rowIdx) => {
            const cy = svgH - CHIP_R - 8 - rowIdx * OVERLAP;
            return <ChipFace key={`${colIdx}-${rowIdx}`} cx={cx} cy={cy} chip={chip} />;
          });
        })}
      </svg>
      {label && (
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary, #888)",
            marginTop: 6,
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ChipStack — renders a poker bet as a visual chip stack.
 *
 * Props:
 *   amount      {number}  Bet amount in dollars (required)
 *   singleStack {boolean} When true (default), all chips form one mixed tower.
 *                         When false, each denomination gets its own stack.
 *   showLabel   {boolean} Show the dollar amount label below the stack (default true)
 *   showBreakdown {boolean} Show denomination pills below the stack (default true)
 *
 * Usage:
 *   <ChipStack amount={51} />
 *   <ChipStack amount={1137} singleStack={false} />
 *   <ChipStack amount={350} showBreakdown={false} />
 */
export default function ChipStack({
  amount,
  singleStack = true,
  showLabel = true,
  showBreakdown = true,
  showAmount = true,
}) {
  const chips = useMemo(() => decompose(amount), [amount]);

  if (!amount || amount <= 0 || chips.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "var(--color-text-tertiary, #aaa)" }}>
        No chips to display.
      </p>
    );
  }

  // ── Single-stack mode ──────────────────────────────────────────────────────
  // Flatten all chips into one array. Largest denomination at top means it must
  // be drawn last (highest index = topmost in SVG bottom-up rendering), so we
  // put small chips first (bottom) → large chips last (top).
  const singleChipList = useMemo(() => {
    if (!singleStack) return [];
    const flat = [];
    // chips is largest-first from decompose; reverse so smallest go to the base.
    const reversed = [...chips].reverse();
    for (const c of reversed) {
      for (let i = 0; i < c.count; i++) flat.push(c);
    }
    return flat;
  }, [chips, singleStack]);

  // ── Breakdown pills ────────────────────────────────────────────────────────
  const breakdown = showBreakdown && (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        marginTop: 12,
        paddingTop: 12,
        borderTop: "0.5px solid rgba(0,0,0,0.1)",
      }}
    >
      {chips.map((c) => (
        <span
          key={c.value}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--color-text-secondary, #666)",
            background: "var(--color-background-secondary, #f5f5f5)",
            borderRadius: 99,
            padding: "4px 10px 4px 6px",
            border: "0.5px solid rgba(0,0,0,0.08)",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: c.color,
              border: `2px solid ${c.edge}`,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {c.count}× {c.label}
        </span>
      ))}
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-text-primary, #111)",
          marginLeft: "auto",
        }}
      >
        = ${amount.toLocaleString()}
      </span>
    </div>
  );

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        {singleStack ? (
          <StackSVG
            chips={singleChipList}
            maxPerCol={MAX_SINGLE}
            label={showLabel ? `$${amount.toLocaleString()}` : undefined}
          />
        ) : (
          chips.map((c) => {
            const flat = Array.from({ length: c.count }, () => c);
            return (
              <StackSVG
                key={c.value}
                chips={flat}
                maxPerCol={MAX_PER_DENOM}
                label={`${c.count}× ${c.label}`}
              />
            );
          })
        )}
      </div>
      {showAmount && (
        <span style={{
          marginTop: 6,
          fontSize: 15,
          fontWeight: 700,
          color: "var(--color-text-primary, #111)",
          fontFamily: "system-ui, sans-serif",
          letterSpacing: "-0.01em",
        }}>
          ${amount.toLocaleString()}
        </span>
      )}
      {breakdown}
    </div>
  );
}
