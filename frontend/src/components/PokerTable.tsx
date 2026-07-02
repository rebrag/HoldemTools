// src/components/PokerTable.tsx
// Reusable oval poker table: elliptical felt with seats placed around the rim
// and a caller-supplied center slot (board + pot for the hand recorder, a pot
// badge for the solver's single-range view).
import React from "react";
import PlayingCard from "@/components/PlayingCard";
import { seatCoords } from "@/lib/pokerGeometry";

/** Back of a playing card (unknown / face-down). */
export const CardBack: React.FC<{ w?: number }> = ({ w = 22 }) => (
  <div
    className="aspect-[3/4] rounded-[4px] border border-rose-900/50 bg-gradient-to-br from-rose-600 to-rose-800 shadow-sm"
    style={{ width: w }}
    aria-hidden="true"
  />
);

export interface PokerTableSeat {
  key: string | number;
  label: string; // position name or player name
  stackText?: string; // preformatted, e.g. "22 BB"
  committedText?: string; // preformatted bet badge, e.g. "2 bb"
  /** omit = no card row; a null slot renders a CardBack. Length varies by game. */
  holeCards?: (string | null)[];
  isButton?: boolean;
  isActive?: boolean;
  isHero?: boolean;
  folded?: boolean;
  /** skip rendering entirely (e.g. an empty seat during a live hand). */
  hidden?: boolean;
}

export interface PokerTableProps {
  size: number; // seat count -> seatCoords(size)
  seats: PokerTableSeat[];
  center?: React.ReactNode; // caller injects center content (board/pot/etc.)
  onSeatClick?: (index: number) => void;
  feltStyle?: React.CSSProperties; // override the default teal gradient
  aspectClassName?: string; // default "aspect-[4/5]"
  maxWidthClassName?: string; // default "max-w-sm"
  cardBackWidth?: number; // hole-card width, default 22
  className?: string;
}

const DEFAULT_FELT: React.CSSProperties = {
  background:
    "radial-gradient(ellipse at 50% 42%, #0e7490 0%, #0c5566 55%, #083344 100%)",
  boxShadow: "inset 0 6px 30px rgba(0,0,0,0.45)",
};

const PokerTable: React.FC<PokerTableProps> = ({
  size,
  seats,
  center,
  onSeatClick,
  feltStyle,
  aspectClassName = "aspect-[4/5]",
  maxWidthClassName = "max-w-sm",
  cardBackWidth = 22,
  className,
}) => {
  const coords = seatCoords(size);

  return (
    <div className={`rounded-3xl bg-slate-950/70 p-2 shadow-2xl shadow-emerald-900/40 ${className ?? ""}`}>
      <div className="rounded-[40px] bg-gradient-to-b from-slate-800 to-slate-900 p-2">
        <div className={`relative mx-auto w-full ${aspectClassName} ${maxWidthClassName}`}>
          {/* felt */}
          <div
            className="absolute inset-[6%] rounded-[46%] ring-4 ring-slate-950/60"
            style={feltStyle ?? DEFAULT_FELT}
          />

          {/* center slot */}
          {center != null && (
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
              {center}
            </div>
          )}

          {/* seats */}
          {seats.map((seat, i) => {
            if (seat.hidden) return null;
            const coord = coords[i];
            if (!coord) return null;
            const clickable = !!onSeatClick;

            return (
              <button
                key={seat.key}
                type="button"
                onClick={clickable ? () => onSeatClick!(i) : undefined}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${
                  clickable ? "cursor-pointer" : "cursor-default"
                } ${seat.folded ? "opacity-40 grayscale" : ""}`}
                style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                aria-label={`Seat ${seat.label}`}
              >
                {seat.holeCards && (
                  <div className="relative flex gap-0.5">
                    {seat.holeCards.map((c, h) => {
                      // Shrink cards a little for 4-5 card (PLO) hands so the
                      // row still fits the seat footprint.
                      const w =
                        seat.holeCards!.length >= 4
                          ? Math.round(cardBackWidth * 0.72)
                          : cardBackWidth;
                      return c ? (
                        <PlayingCard key={h} code={c} size="sm" width={w} />
                      ) : (
                        <CardBack key={h} w={w} />
                      );
                    })}
                    {seat.isButton && (
                      <span className="absolute -right-3 -bottom-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-gray-800 shadow ring-1 ring-gray-300">
                        D
                      </span>
                    )}
                  </div>
                )}

                <span
                  className={`max-w-[80px] truncate rounded px-1.5 py-[1px] text-[10px] font-semibold ring-1 ${
                    seat.isActive
                      ? "bg-emerald-500 text-white ring-emerald-200"
                      : seat.isHero
                      ? "bg-amber-500/90 text-white ring-amber-200"
                      : "bg-slate-900/80 text-sky-100 ring-slate-700"
                  }`}
                >
                  {seat.label}
                </span>

                {seat.stackText && (
                  <span className="rounded bg-black/50 px-1.5 text-[10px] font-semibold text-emerald-100">
                    {seat.stackText}
                  </span>
                )}

                {seat.committedText && (
                  <span className="mt-0.5 rounded-full bg-amber-400/90 px-1.5 text-[9px] font-bold text-amber-950">
                    {seat.committedText}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PokerTable;
