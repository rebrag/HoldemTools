// views/MultiRangeFrame.tsx
//
// Shared chrome around both multi-range layouts: the table backdrop, the
// framer-motion LayoutGroup that animates plate zoom, the zoom overlay, the
// loading overlay, and the pot/ante badge. The plate layout itself comes in
// as children; zoom state lives in each view (their width math differs).
import type { CSSProperties, ReactNode, RefCallback } from "react";
import { LayoutGroup } from "framer-motion";
import LoadingOverlay from "@/components/LoadingOverlay";
import { PokerTableBackdrop } from "@/components/PokerTableSurface";
import type { MatrixHeightMode } from "@/lib/solver/matrixHeight";
import DecisionMatrix from "../DecisionMatrix";
import type { PlateZoomPayload } from "../Plate";
import { fmtMoney, type MoneyOpts } from "../boardDisplay";

interface MultiRangeFrameProps {
  /** Narrow (mobile) styling: tighter padding, smaller badge, fixed height. */
  compact: boolean;
  /** The view's useElementSize ref, so it can measure the content width. */
  containerRef: RefCallback<HTMLDivElement>;
  /** Fixed height + padding for the compact layout. */
  containerStyle?: CSSProperties;
  zoom: PlateZoomPayload | null;
  zoomWidth: number;
  onClearZoom: () => void;
  loading: boolean;
  /** Chips actually in the pot (excludes bets still in front of players). */
  actualPot?: number;
  /** Chips/bb display; absent for sims, which always read as big blinds. */
  money?: MoneyOpts | null;
  /** Matrix cell-height mode, carried into the zoom overlay's matrix. */
  heightMode?: MatrixHeightMode;
  children: ReactNode;
}

const MultiRangeFrame = ({
  compact,
  containerRef,
  containerStyle,
  zoom,
  zoomWidth,
  onClearZoom,
  loading,
  actualPot,
  money,
  heightMode,
  children,
}: MultiRangeFrameProps) => {
  const badgeClass =
    "backdrop-blur-sm rounded-md shadow text-center " +
    (compact
      ? "bg-white/60 px-0.5 py-0.5 text-[8px]"
      : "bg-white/60 px-2 py-0 text-xs");

  return (
    <div
      className={`border-0 relative flex justify-center ${
        compact ? "items-start py-0 px-0.5" : "items-center py-2"
      } overflow-visible`}
    >
      <PokerTableBackdrop className="z-10" />

      <LayoutGroup id="plate-zoom">
        <div
          ref={containerRef}
          className={`relative z-10 w-full select-none ${
            compact ? "" : "min-h-[300px]"
          }`}
          style={containerStyle}
        >
          {/* Zoom overlay backdrop */}
          {zoom && (
            <div
              className="fixed inset-0 bg-black/40 z-[55]"
              onClick={onClearZoom}
            />
          )}

          {/* Zoom overlay: ONLY DecisionMatrix */}
          {zoom && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center"
              onClick={onClearZoom}
            >
              <div
                className="relative"
                style={{ width: zoomWidth, maxWidth: "95vw" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-black/60 rounded-xl shadow-xl p-2 sm:p-3">
                  <div
                    className="relative w-full"
                    style={{ aspectRatio: "1 / 1" }}
                  >
                    <DecisionMatrix
                      gridData={zoom.grid}
                      randomFillEnabled={false}
                      isICMSim={zoom.isICMSim}
                      heightMode={heightMode}
                      reachByHand={zoom.reachByHand}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Loading */}
          <LoadingOverlay active={loading} />

          {/* Pot badge (center of table): only once chips are actually pooled */}
          {actualPot != null && actualPot > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className={badgeClass}>
                <strong>Pot:</strong> {fmtMoney(Math.max(0, actualPot), money)}
              </div>
            </div>
          )}

          {children}
        </div>
      </LayoutGroup>
    </div>
  );
};

export default MultiRangeFrame;
