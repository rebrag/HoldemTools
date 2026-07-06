// src/components/PokerTable.tsx
// Reusable oval poker table: elliptical felt with seats placed around the rim
// and a caller-supplied center slot (board + pot for the hand recorder, a pot
// badge for the solver's single-range view).
import React from "react";
import PlayingCard from "@/components/PlayingCard";
import PokerTableSurface from "@/components/PokerTableSurface";
import ChipStack from "@/components/ChipStack";
import { seatCoords, type SeatCoord } from "@/lib/pokerGeometry";

/** Back of a playing card (unknown / face-down). */
export const CardBack: React.FC<{ w?: number }> = ({ w = 30 }) => (
  <div
    className="aspect-[3/4] rounded-[5px] border border-rose-950/60 bg-gradient-to-br from-rose-600 to-rose-800 shadow-md ring-1 ring-white/10"
    style={{ width: w }}
    aria-hidden="true"
  />
);

export interface PokerTableSeat {
  key: string | number;
  label: string; // position name or player name
  stackText?: string; // preformatted, e.g. "22 BB"
  committedText?: string; // preformatted bet label, e.g. "2 bb" / "SB 0.5"
  /** Numeric bet (real chip amount). When set, the bet renders as a ChipStack
   *  pushed toward the table center with committedText as a small label under
   *  it. When omitted, committedText falls back to a badge below the seat. */
  committedAmount?: number;
  /** omit = no card row; a null slot renders a CardBack. Length varies by game. */
  holeCards?: (string | null)[];
  isButton?: boolean;
  isActive?: boolean;
  isHero?: boolean;
  folded?: boolean;
  /** skip rendering entirely (e.g. an empty seat during a live hand). */
  hidden?: boolean;
  /** render null holeCards slots as dashed empty placeholders instead of face-down CardBacks. */
  emptySlotsAsPlaceholders?: boolean;
  /** index into holeCards to decorate with the pulsing "NEXT" ring (card-picker target). */
  nextSlotIndex?: number;
  /** emerald ring around the whole seat: marks the seat selected for editing. */
  highlighted?: boolean;
  /** extra node rendered below the badges (e.g. an equity readout).
   *  Must not contain interactive elements: the seat root is a <button>. */
  extra?: React.ReactNode;
}

export interface PokerTableProps {
  size: number; // seat count -> seatCoords(size)
  seats: PokerTableSeat[];
  center?: React.ReactNode; // caller injects center content (board/pot/etc.)
  /** Pot chip amount rendered as its own movable stack above the table center.
   *  Omit (or <1) to show no pot. */
  potAmount?: number;
  /** Text label shown under the pot chips, e.g. "Flop · Pot 22 BB". */
  potLabel?: string;
  /** When set, the pot slides partway toward this seat index (winner award). */
  potWinnerSeatIndex?: number | null;
  onSeatClick?: (index: number) => void;
  feltStyle?: React.CSSProperties; // override the default teal gradient
  aspectClassName?: string; // default "aspect-[7/5]" (landscape oval)
  maxWidthClassName?: string; // default "max-w-sm"
  cardBackWidth?: number; // hole-card width, default 22
  className?: string;
  /** override seatCoords(size), e.g. to pull side seats inward. */
  coordsOverride?: SeatCoord[];
}

/** Pulsing ring + "NEXT" chip marking the slot the card picker will fill. */
export const NextSlotHighlight: React.FC = () => (
  <>
    <div className="pointer-events-none absolute -inset-1 rounded-[9px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-10" />
    <div className="absolute -top-3 -right-1 z-20">
      <span className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5 shadow">
        NEXT
      </span>
    </div>
  </>
);

const PokerTable: React.FC<PokerTableProps> = ({
  size,
  seats,
  center,
  potAmount,
  potLabel,
  potWinnerSeatIndex,
  onSeatClick,
  feltStyle,
  aspectClassName = "aspect-[7/5]",
  maxWidthClassName = "max-w-sm",
  cardBackWidth = 30,
  className,
  coordsOverride,
}) => {
  const coords = coordsOverride ?? seatCoords(size);

  // Pot layer: the label is centered at (POT_BASE_X, POT_BASE_Y) with the chip
  // stack floating just above it. POT_BASE_Y sits above the board cards (~41% of
  // the table height) so neither the label nor the chips cover them. When a
  // winner is set the pot slides ~45% of the way toward that seat; animating
  // left/top gives a smooth "chips pushed to the winner" motion.
  const showPot = potAmount != null && Math.round(potAmount) >= 1;
  const potWinnerCoord =
    potWinnerSeatIndex != null ? coords[potWinnerSeatIndex] : null;
  const POT_BASE_X = 50;
  const POT_BASE_Y = 36; // label center, just above the board
  const POT_SLIDE = 0.45;
  const potX = potWinnerCoord
    ? POT_BASE_X + (potWinnerCoord.x - POT_BASE_X) * POT_SLIDE
    : POT_BASE_X;
  const potY = potWinnerCoord
    ? POT_BASE_Y + (potWinnerCoord.y - POT_BASE_Y) * POT_SLIDE
    : POT_BASE_Y;

  return (
    <PokerTableSurface
      className={className}
      feltStyle={feltStyle}
      innerClassName={`relative mx-auto w-full ${aspectClassName} ${maxWidthClassName}`}
    >
      {/* center slot */}
          {center != null && (
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
              {center}
            </div>
          )}

          {/* pot layer — its own positioned element so it can slide to the winner.
              The layer is anchored on the small label; the chip stack floats
              absolutely ABOVE it so its (transform-scaled) box never inflates the
              anchor or covers the board below. */}
          {showPot && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${potX}%`,
                top: `${potY}%`,
                transition: "left 0.6s ease, top 0.6s ease",
              }}
              aria-hidden="true"
            >
              <div className="relative flex flex-col items-center">
                <div className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2">
                  <div style={{ transform: "scale(0.6)", transformOrigin: "center bottom" }}>
                    <ChipStack
                      amount={potAmount!}
                      showLabel={false}
                      showBreakdown={false}
                      showAmount={false}
                    />
                  </div>
                </div>
                {potLabel && (
                  <span className="whitespace-nowrap rounded-full bg-black/50 px-3 py-0.5 text-[11px] font-semibold text-white shadow">
                    {potLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* seats */}
          {seats.map((seat, i) => {
            if (seat.hidden) return null;
            const coord = coords[i];
            if (!coord) return null;
            const clickable = !!onSeatClick;

            // Bet pushed toward the table center: interpolate ~30% from the
            // seat's rim position toward the middle (50,50).
            const t = 0.3;
            const betX = coord.x + (50 - coord.x) * t;
            const betY = coord.y + (50 - coord.y) * t;
            const hasBet = seat.committedAmount != null && seat.committedAmount > 0;
            const showChips = hasBet && Math.round(seat.committedAmount!) >= 1;

            return (
              <React.Fragment key={seat.key}>
              {hasBet && (
                <div
                  className="pointer-events-none absolute z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                  style={{ left: `${betX}%`, top: `${betY}%` }}
                  aria-hidden="true"
                >
                  {showChips && (
                    <div style={{ transform: "scale(0.5)", transformOrigin: "center bottom" }}>
                      <ChipStack
                        amount={seat.committedAmount!}
                        showLabel={false}
                        showBreakdown={false}
                        showAmount={false}
                      />
                    </div>
                  )}
                  {seat.committedText && (
                    <span className="rounded-full bg-black/70 px-1.5 py-[1px] text-[9px] font-bold text-amber-200 shadow ring-1 ring-amber-500/40">
                      {seat.committedText}
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={clickable ? () => onSeatClick!(i) : undefined}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${
                  clickable ? "cursor-pointer" : "cursor-default"
                } ${seat.folded ? "opacity-40 grayscale" : ""} ${
                  seat.highlighted
                    ? "rounded-lg ring-2 ring-emerald-400 ring-offset-1 ring-offset-transparent"
                    : ""
                }`}
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
                      if (c) return <PlayingCard key={h} code={c} size="sm" width={w} />;
                      if (!seat.emptySlotsAsPlaceholders) return <CardBack key={h} w={w} />;
                      return (
                        <div key={h} className="relative" style={{ width: w }}>
                          <div className="aspect-[3/4] rounded-[4px] border border-dashed border-white/30 bg-black/15" />
                          {seat.nextSlotIndex === h && <NextSlotHighlight />}
                        </div>
                      );
                    })}
                    {seat.isButton && (
                      <span className="absolute -right-3 -bottom-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 text-[10px] font-bold text-amber-950 shadow-md ring-1 ring-amber-700/70">
                        D
                      </span>
                    )}
                  </div>
                )}

                <span
                  className={`max-w-[88px] truncate rounded-md px-1.5 py-[1px] text-[10px] font-semibold shadow-md ring-1 ${
                    seat.isActive
                      ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white ring-emerald-300/70"
                      : seat.isHero
                      ? "bg-gradient-to-b from-amber-400 to-amber-600 text-white ring-amber-300/70"
                      : "bg-gradient-to-b from-slate-800 to-slate-950 text-sky-100 ring-slate-600/70"
                  }`}
                >
                  {seat.label}
                </span>

                {seat.stackText && (
                  <span className="-mt-px rounded-b-md bg-black/60 px-1.5 text-[10px] font-semibold text-emerald-100 shadow-sm ring-1 ring-black/40">
                    {seat.stackText}
                  </span>
                )}

                {/* Legacy below-seat bet badge (used where no committedAmount is
                    supplied, e.g. the solver view). */}
                {seat.committedAmount == null && seat.committedText && (
                  <span className="mt-0.5 rounded-full bg-amber-400/90 px-1.5 text-[9px] font-bold text-amber-950">
                    {seat.committedText}
                  </span>
                )}

                {seat.extra}
              </button>
              </React.Fragment>
            );
          })}
    </PokerTableSurface>
  );
};

export default PokerTable;
