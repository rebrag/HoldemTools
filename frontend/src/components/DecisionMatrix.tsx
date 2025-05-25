// src/components/DecisionMatrix.tsx
import {
  useMemo,
  useState,
  useRef,
  useEffect,
  FC,
  HTMLAttributes,
} from "react";
import HandCell from "./HandCell";
import { HandCellData } from "../utils/utils";

interface DecisionMatrixProps extends HTMLAttributes<HTMLDivElement> {
  gridData: HandCellData[];
  randomFillEnabled?: boolean;
  isICMSim?: boolean;
}

/** Canonical 13×13 “standard grid” ordering */
const HAND_ORDER = [
  "AA","AKs","AQs","AJs","ATs","A9s","A8s","A7s","A6s","A5s","A4s","A3s","A2s",
  "AKo","KK","KQs","KJs","KTs","K9s","K8s","K7s","K6s","K5s","K4s","K3s","K2s",
  "AQo","KQo","QQ","QJs","QTs","Q9s","Q8s","Q7s","Q6s","Q5s","Q4s","Q3s","Q2s",
  "AJo","KJo","QJo","JJ","JTs","J9s","J8s","J7s","J6s","J5s","J4s","J3s","J2s",
  "ATo","KTo","QTo","JTo","TT","T9s","T8s","T7s","T6s","T5s","T4s","T3s","T2s",
  "A9o","K9o","Q9o","J9o","T9o","99","98s","97s","96s","95s","94s","93s","92s",
  "A8o","K8o","Q8o","J8o","T8o","98o","88","87s","86s","85s","84s","83s","82s",
  "A7o","K7o","Q7o","J7o","T7o","97o","87o","77","76s","75s","74s","73s","72s",
  "A6o","K6o","Q6o","J6o","T6o","96o","86o","76o","66","65s","64s","63s","62s",
  "A5o","K5o","Q5o","J5o","T5o","95o","85o","75o","65o","55","54s","53s","52s",
  "A4o","K4o","Q4o","J4o","T4o","94o","84o","74o","64o","54o","44","43s","42s",
  "A3o","K3o","Q3o","J3o","T3o","93o","83o","73o","63o","53o","43o","33","32s",
  "A2o","K2o","Q2o","J2o","T2o","92o","82o","72o","62o","52o","42o","32o","22",
];

const DecisionMatrix: FC<DecisionMatrixProps> = ({
  gridData,
  randomFillEnabled: randomFill,
  isICMSim = false,
  ...rest
}) => {
  /* ---------------- LIFECYCLE DEBUG (optional) ---------------- */
  // useEffect(() => { console.log("DecisionMatrix mounted"); return () => console.log("…unmounted"); }, []);

  /* ---------------- ORDERED DATA  ---------------- */
  const orderedGridData = useMemo(
    () =>
      HAND_ORDER.map(
        (hand) => gridData.find((item) => item.hand === hand) || null
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

  /* ---------------- HOVER STATE ---------------- */
  const [hoveredEVs, setHoveredEVs] =
    useState<Record<string, number> | null>(null);
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);

  /* ---------------- RENDER ---------------- */
  return (
    <div
      {...rest}
      ref={containerRef}
      className="relative grid grid-cols-13 gap-0 w-full aspect-square rounded-md overflow-hidden"
    >
      {orderedGridData.map((handData, idx) =>
        handData ? (
          <HandCell
            key={handData.hand}
            data={handData}
            randomFill={randomFill}
            matrixWidth={matrixWidth}
            onHover={(evs) => {
              setHoveredEVs(evs);
              setHoveredHand(handData.hand);
            }}
            onLeave={() => {
              setHoveredEVs(null);
              setHoveredHand(null);
            }}
          />
        ) : (
          <div key={idx} className="empty-cell" />
        )
      )}

      {/* ---------- EV TOOLTIP ---------- */}
      {hoveredEVs && hoveredHand && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 mb-1 z-50 bg-gray-800 text-white text-xs rounded px-2 py-1 pointer-events-none shadow-lg whitespace-nowrap">
          <div className="text-xs font-bold mb-1 text-center">{hoveredHand}</div>
          {Object.entries(hoveredEVs)
            .sort(([, a], [, b]) => (b ?? -Infinity) - (a ?? -Infinity))
            .map(([action, ev]) => {
              let display = "N/A";
              if (ev != null && !isNaN(ev)) {
                display = isICMSim
                  ? `$${(ev).toFixed(2)}`
                  : `${ev.toFixed(2)} bb`;
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
