// src/pages/solver/PlateHeader.tsx
//
// The seat strip across the top of a Plate: position, dealer button, live
// bet, pot odds and stack, in the same visual language as the name+stack
// card on PokerTableSeat (dark slate plate; emerald when the seat is on the
// spot; amber for a hero seat). One component for both Plate layouts so the
// wide row and the compact stacked column can never drift apart in tone.
import React from "react";
import AutoFitText from "@/components/AutoFitText";

export interface PlateHeaderProps {
  position: string;
  stackText: string;
  /** The seat's live bet, already formatted; omitted when nothing is out. */
  betText?: string;
  /** Pot odds the seat faces, already formatted; only while it is to act. */
  potOddsText?: string;
  isActive: boolean;
  isHero: boolean;
  isButton: boolean;
  /** Stacked column for the narrow sidebar layout (down to 40px wide). */
  compact: boolean;
}

/* Lifted from PokerTableSeat so a plate's header and a table's seat card read
 * as the same object. */
const tone = (isActive: boolean, isHero: boolean) =>
  isActive
    ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white ring-emerald-300/70"
    : isHero
    ? "bg-gradient-to-b from-amber-400 to-amber-600 text-white ring-amber-300/70"
    : "bg-gradient-to-b from-slate-800 to-slate-950 text-sky-100 ring-slate-600/70";

const stackTone = (isActive: boolean, isHero: boolean) =>
  isActive || isHero ? "text-white/90" : "text-emerald-100";

/* Same pill the table draws beside a bet's chips. */
const PILL = "rounded-full bg-black/60 px-1.5 py-px text-[10px] tabular-nums text-white shadow";

const DealerBadge: React.FC<{ small?: boolean }> = ({ small = false }) => (
  <span
    title="Dealer button"
    aria-label="Dealer button"
    className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 font-bold leading-none text-amber-950 shadow ring-1 ring-amber-700/70 ${
      small ? "h-3 w-3 text-[7px]" : "h-4 w-4 text-[9px]"
    }`}
  >
    D
  </span>
);

const PlateHeader: React.FC<PlateHeaderProps> = ({
  position,
  stackText,
  betText,
  potOddsText,
  isActive,
  isHero,
  isButton,
  compact,
}) => {
  if (compact) {
    /* Every line auto-fits: the sidebar this sits in can be 40px wide, and a
       fixed font would push the colour key below it out of the plate. */
    /* shrink-0 throughout: this sits in a flex column whose height is pinned
       to the matrix, and flex children shrink below their content height by
       default - which drew the stack over the bet on a phone. */
    return (
      <div
        className={`flex w-full shrink-0 flex-col items-center gap-px rounded-md px-0.5 py-0.5 text-center ring-1 ring-inset ${tone(
          isActive,
          isHero
        )}`}
      >
        {/* Position and stack on one line, as the seat card on the table
            does: the sidebar's height is the matrix's, and every extra line
            here is a line the colour key below cannot have. */}
        <AutoFitText minPx={6} maxPx={11} title="Position and stack" className="shrink-0">
          <span className="inline-flex items-center gap-1">
            <strong>{position}</strong>
            {isButton && <DealerBadge small />}
            <span className={`font-semibold ${stackTone(isActive, isHero)}`}>{stackText}</span>
          </span>
        </AutoFitText>
        {betText && (
          <AutoFitText minPx={6} maxPx={9} title="Bet" className="shrink-0">
            <span className="rounded-full bg-black/60 px-1 text-white">Bet {betText}</span>
          </AutoFitText>
        )}
        {potOddsText && (
          <AutoFitText minPx={6} maxPx={9} title="Pot odds" className="shrink-0">
            <span className="rounded-full bg-black/60 px-1 text-white">{potOddsText}</span>
          </AutoFitText>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-1.5 rounded-t-[11px] px-2 py-1 text-[11px] ring-1 ring-inset ${tone(
        isActive,
        isHero
      )}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate font-bold leading-tight" title="Position">
          {position}
        </span>
        {isButton && <DealerBadge />}
      </span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        {betText && (
          <span className={PILL} title="Bet">
            {betText}
          </span>
        )}
        {potOddsText && (
          <span className={PILL} title="Pot odds">
            {potOddsText}
          </span>
        )}
        <span className={`font-semibold leading-tight ${stackTone(isActive, isHero)}`} title="Stack">
          {stackText}
        </span>
      </span>
    </div>
  );
};

export default PlateHeader;
