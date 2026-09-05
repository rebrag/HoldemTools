import {
  useMemo,
  useState,
  useRef,
  useEffect,
  FC,
  HTMLAttributes,
} from "react";
import HandCell from "./HandCell";
import { HandCellData, orderActionKeys, buildActionPalette } from "@/lib/solver/utils";
import { ALL_ACTIONS } from "@/lib/solver/constants";
import { HAND_ORDER } from "@/lib/solver/handOrder";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import type { MatrixDisplayData } from "@/lib/solver/matrixDisplayMode";
import type { BetUnit } from "@/lib/solver/utils";
import { fmtMoney, type MoneyOpts } from "./boardDisplay";

/* ---------- props ---------- */
interface DecisionMatrixProps extends HTMLAttributes<HTMLDivElement> {
  gridData: HandCellData[];          // may be empty when JSON not loaded yet
  randomFillEnabled?: boolean;
  isICMSim?: boolean;
  /** Cell-height mode; without reach data every mode renders full height. */
  heightMode?: MatrixHeightMode;
  /** Hand class -> reach 0..1 at this node (postflop schema-4 only). */
  reachByHand?: Map<string, number> | null;
  /** EV/Equity heat coloring (study view); null keeps the strategy render. */
  displayData?: MatrixDisplayData | null;
  /** Chips/bb display for the EV tooltip; absent for sims (big blinds). */
  money?: MoneyOpts | null;
  /** Override for the colour ramp's size reference; defaults to money.bbSize.
   *  Only needed alongside sizeUnit="pct", where money.bbSize means something
   *  else entirely (display-money-per-bb) and cannot double as the pot. */
  sizeRef?: number;
  /** Unit the ramp reference is in; see getColorForAction. Defaults to "bb",
   *  matching every /solver view - /compare is the one caller that passes
   *  "pct", since its trees have no big blind to calibrate against. */
  sizeUnit?: BetUnit;
  onMatrixClick?: () => void;
  /** The pinned hand class, ringed in the grid (study view's breakdown). */
  selectedHand?: string | null;
  /** Fires when a cell is clicked. Supplying it makes cells clickable; without
   *  it the grid is display-only and clicks fall through to onMatrixClick. */
  onHandSelect?: (hand: string) => void;
  /** Fires as the pointer moves across cells, so the study view can preview a
   *  hand while nothing is pinned. */
  onHandHover?: (hand: string) => void;
  /** Draw the grid on one canvas instead of 169 cells. For views that show
   *  many matrices at once (the multiway group view renders sixteen): a cell
   *  is ~15 DOM nodes with a width transition, so a page of them is tens of
   *  thousands of animated nodes. The canvas keeps the colours, reach
   *  heights and selection ring, drops the per-cell labels (unreadable at
   *  those sizes anyway) and the EV tooltip, and still reports clicks and
   *  hovers through onHandSelect / onHandHover. */
  performant?: boolean;
}

/* ---------- helper: fabricate an “empty” cell ---------- */
const BLANK_ACTIONS = ALL_ACTIONS.concat("UNKNOWN").reduce<Record<string, number>>(
  (obj, a) => ({ ...obj, [a]: 0 }),
  {}
);

const makeBlankCell = (hand: string): HandCellData & { evs: Record<string, number> } => ({
  hand,
  actions: { ...BLANK_ACTIONS },   // every action weight = 0
  evs: {},                         // no EVs while blank
});

const DecisionMatrix: FC<DecisionMatrixProps> = ({
  gridData,
  randomFillEnabled: randomFill,
  isICMSim = false,
  heightMode = "normalized",
  reachByHand,
  displayData,
  money,
  sizeRef: sizeRefOverride,
  sizeUnit = "bb",
  onMatrixClick,
  selectedHand,
  onHandSelect,
  onHandHover,
  performant = false,
  ...rest
}) => {
  /* Bet labels carry the solve's money; the colour ramp is calibrated in
   * big blinds, so tell it how much money makes one - UNLESS the caller
   * overrides both, which /compare does (see sizeUnit above). */
  const sizeRef =
    sizeRefOverride ?? (money?.bbSize && money.bbSize > 0 ? money.bbSize : 1);
  /* ---------------- ORDERED DATA  ----------------
   * Substitute the blank-cell fallback here (inside the memo) so every cell —
   * real or blank — keeps a stable object reference across re-renders. HandCell's
   * memo compares `data.actions`/`data.evs` by reference, so minting a fresh blank
   * cell on each render would force those cells to re-render needlessly. */
  const orderedGridData = useMemo(
    () =>
      HAND_ORDER.map(
        (hand) =>
          gridData.find((item) => item.hand === hand) ?? makeBlankCell(hand)
      ),
    [gridData]
  );

  /* ---------------- CELL HEIGHTS ----------------
   * "Normalized" scales the most-reached class to full height (GTO Wizard's
   * default); "range" uses the absolute reach fraction. Without reach data
   * (preflop, pre-schema-4 solves) every cell stays full height, so the
   * feature degrades to the old rendering instead of collapsing the grid. */
  const maxReach = useMemo(() => {
    if (!reachByHand || reachByHand.size === 0) return 0;
    let max = 0;
    for (const r of reachByHand.values()) if (r > max) max = r;
    return max;
  }, [reachByHand]);

  const heightFor = (hand: string): number => {
    if (heightMode === "full" || !reachByHand || maxReach <= 0) return 100;
    const reach = reachByHand.get(hand) ?? 0;
    return heightMode === "normalized"
      ? (reach / maxReach) * 100
      : reach * 100;
  };

  /* ---------------- DIMENSION TRACKING ---------------- */
  const containerRef = useRef<HTMLDivElement>(null);
  const [matrixWidth, setMatrixWidth] = useState(0);

  useEffect(() => {
    if (containerRef.current) {
      setMatrixWidth(containerRef.current.offsetWidth);
    }
  }, [gridData]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMatrixWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- HOVER STATE ---------------- */
  const [hoveredEVs, setHoveredEVs] =
    useState<Record<string, number> | null>(null);
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);

  /* ---------------- RENDER ---------------- */
  if (performant) {
    return (
      <div
        {...rest}
        ref={containerRef}
        onClick={onMatrixClick}
        className="relative w-full aspect-square rounded-md overflow-hidden"
      >
        <CanvasMatrix
          cells={orderedGridData}
          width={matrixWidth}
          heightFor={heightFor}
          sizeRef={sizeRef}
          sizeUnit={sizeUnit}
          selectedHand={selectedHand ?? null}
          onHandSelect={onHandSelect}
          onHandHover={onHandHover}
        />
      </div>
    );
  }
  return (
    <div
      {...rest}
      ref={containerRef}
      onClick={onMatrixClick}
      className="relative grid grid-cols-13 gap-0 w-full aspect-square rounded-md overflow-hidden"
    >
      {orderedGridData.map((cellData) => {
        return (
          <HandCell
            sizeRef={sizeRef}
            sizeUnit={sizeUnit}
            key={cellData.hand}
            data={cellData}
            randomFill={randomFill}
            matrixWidth={matrixWidth}
            heightPct={heightFor(cellData.hand)}
            stripes={displayData?.stripesByHand?.get(cellData.hand) ?? null}
            solidColor={displayData?.solidByHand?.get(cellData.hand) ?? null}
            selected={selectedHand === cellData.hand}
            onSelect={onHandSelect ? () => onHandSelect(cellData.hand) : undefined}
            onHover={(evs) => {
              setHoveredEVs(evs);
              setHoveredHand(cellData.hand);
              onHandHover?.(cellData.hand);
            }}
            onLeave={() => {
              setHoveredEVs(null);
              setHoveredHand(null);
            }}
          />
        );
      })}

      {/* ---------- EV TOOLTIP ---------- */}
      {hoveredEVs && hoveredHand && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 mb-1 z-50 bg-gray-800 text-white text-xs rounded px-2 py-1 pointer-events-none shadow-lg whitespace-nowrap">
          <div className="text-xs font-bold mb-1 text-center">
            EVs: {hoveredHand}
          </div>
          {Object.entries(hoveredEVs)
            .sort(([, a], [, b]) => (b ?? -Infinity) - (a ?? -Infinity))
            .map(([action, ev]) => {
              let display = "N/A";
              if (ev != null && !isNaN(ev)) {
                display = isICMSim ? `$${ev.toFixed(2)}` : fmtMoney(ev, money);
              }
              return (
                <div key={action}>
                  <span className="font-semibold">{action}</span>: {display}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

/* ---------- the one-canvas rendering ----------
 * Same colours as HandCell (orderActionKeys + buildActionPalette over the
 * grid's actions, so the legend still matches), same bottom-anchored bar
 * scaled to reach, same hairlines and pair diagonal, same selection ring.
 * Redrawn only when its inputs change; a redraw is 169 cells of fillRect. */
const CELL_GROUND = "#1e293b";

const CanvasMatrix: FC<{
  cells: HandCellData[];
  width: number;
  heightFor: (hand: string) => number;
  sizeRef: number;
  sizeUnit: BetUnit;
  selectedHand: string | null;
  onHandSelect?: (hand: string) => void;
  onHandHover?: (hand: string) => void;
}> = ({ cells, width, heightFor, sizeRef, sizeUnit, selectedHand, onHandSelect, onHandHover }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastHover = useRef<string | null>(null);

  const palette = useMemo(() => {
    const keys = new Set<string>();
    for (const c of cells) for (const a of Object.keys(c.actions)) keys.add(a);
    const ordered = orderActionKeys([...keys]);
    return { ordered, colors: buildActionPalette(ordered, sizeRef, sizeUnit) };
  }, [cells, sizeRef, sizeUnit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const side = Math.round(width * dpr);
    if (canvas.width !== side || canvas.height !== side) {
      canvas.width = side;
      canvas.height = side;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cw = side / 13;
    ctx.fillStyle = CELL_GROUND;
    ctx.fillRect(0, 0, side, side);
    cells.forEach((cell, i) => {
      const col = i % 13;
      const row = Math.floor(i / 13);
      const x0 = col * cw;
      const y0 = row * cw;
      const barH = (cw * heightFor(cell.hand)) / 100;
      let x = x0;
      for (const action of palette.ordered) {
        const w = (cell.actions[action] || 0) * cw;
        if (w <= 0) continue;
        ctx.fillStyle = palette.colors[action];
        ctx.fillRect(x, y0 + cw - barH, w, barH);
        x += w;
      }
    });
    // Hairlines, the pair diagonal a shade heavier, then the selection ring.
    ctx.strokeStyle = "rgba(203, 213, 224, 0.28)";
    ctx.lineWidth = Math.max(0.5, dpr * 0.35);
    ctx.beginPath();
    for (let k = 1; k < 13; k += 1) {
      ctx.moveTo(k * cw, 0);
      ctx.lineTo(k * cw, side);
      ctx.moveTo(0, k * cw);
      ctx.lineTo(side, k * cw);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(203, 213, 224, 0.22)";
    ctx.lineWidth = Math.max(0.7, dpr * 0.7);
    for (let k = 0; k < 13; k += 1) ctx.strokeRect(k * cw, k * cw, cw, cw);
    if (selectedHand) {
      const i = cells.findIndex((c) => c.hand === selectedHand);
      if (i >= 0) {
        const col = i % 13;
        const row = Math.floor(i / 13);
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.strokeRect(col * cw + dpr, row * cw + dpr, cw - 2 * dpr, cw - 2 * dpr);
        ctx.lineWidth = dpr;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.strokeRect(col * cw + 3 * dpr, row * cw + 3 * dpr, cw - 6 * dpr, cw - 6 * dpr);
      }
    }
    // Labels only where they can be read.
    if (cw / dpr >= 18) {
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.round(cw * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 2 * dpr;
      cells.forEach((cell, i) => {
        ctx.fillText(cell.hand, (i % 13) * cw + cw / 2, Math.floor(i / 13) * cw + cw / 2);
      });
      ctx.shadowBlur = 0;
    }
  }, [cells, width, heightFor, palette, selectedHand]);

  const handAt = (e: React.MouseEvent<HTMLCanvasElement>): string | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const col = Math.min(12, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 13)));
    const row = Math.min(12, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * 13)));
    return cells[row * 13 + col]?.hand ?? null;
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="decision-matrix-canvas"
      className={`block h-full w-full ${onHandSelect ? "cursor-pointer" : ""}`}
      onClick={
        onHandSelect
          ? (e) => {
              const hand = handAt(e);
              if (hand) onHandSelect(hand);
            }
          : undefined
      }
      onMouseMove={
        onHandHover
          ? (e) => {
              const hand = handAt(e);
              if (hand && hand !== lastHover.current) {
                lastHover.current = hand;
                onHandHover(hand);
              }
            }
          : undefined
      }
      onMouseLeave={
        onHandHover
          ? () => {
              lastHover.current = null;
            }
          : undefined
      }
    />
  );
};

export default DecisionMatrix;
