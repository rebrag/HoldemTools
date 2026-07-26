import {
  useMemo,
  useState,
  useRef,
  useEffect,
  FC,
  HTMLAttributes,
} from "react";
import HandCell from "./HandCell";
import { HandCellData } from "@/lib/solver/utils";
import { ALL_ACTIONS } from "@/lib/solver/constants";
import { HAND_ORDER } from "@/lib/solver/handOrder";

/* ---------- props ---------- */
interface DecisionMatrixProps extends HTMLAttributes<HTMLDivElement> {
  gridData: HandCellData[];          // may be empty when JSON not loaded yet
  randomFillEnabled?: boolean;
  isICMSim?: boolean;
  onMatrixClick?: () => void;
  /** Fires as the pointer moves across cells (study view's hand breakdown). */
  onHandHover?: (hand: string) => void;
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
  onMatrixClick,
  onHandHover,
  ...rest
}) => {
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
            key={cellData.hand}
            data={cellData}
            randomFill={randomFill}
            matrixWidth={matrixWidth}
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
                display = isICMSim ? `$${ev.toFixed(2)}` : `${ev.toFixed(2)} bb`;
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

export default DecisionMatrix;
