// src/components/PokerTable.tsx
// Reusable oval poker table: elliptical felt with seats placed around the rim
// and a caller-supplied center slot (board + pot for the hand recorder, a pot
// badge for the solver's single-range view).
import React from "react";
import PlayingCard from "@/components/PlayingCard";
import PokerTableSurface from "@/components/PokerTableSurface";
import ChipStack from "@/components/ChipStack";
import MoneyToggle, { type MoneyToggleMoney } from "@/components/MoneyToggle";
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
  /** Seated but not dealt in: grayed out with a "sitting out" tag. */
  sittingOut?: boolean;
  /** skip rendering entirely (e.g. an empty seat during a live hand). */
  hidden?: boolean;
  /** render as a muted "empty" placeholder (no cards; tap to seat a player). */
  isEmpty?: boolean;
  /** render null holeCards slots as dashed empty placeholders instead of face-down CardBacks. */
  emptySlotsAsPlaceholders?: boolean;
  /** index into holeCards to decorate with the pulsing "NEXT" ring (card-picker target). */
  nextSlotIndex?: number;
  /** emerald ring around the whole seat: marks the seat selected for editing. */
  highlighted?: boolean;
  /** Opt this seat out of `onSeatClick` (no handler, no pointer cursor, no
   *  hover cue) while its neighbours stay clickable. Defaults to true, so a
   *  table that passes onSeatClick keeps every seat live unless told otherwise. */
  interactive?: boolean;
  /** Tooltip on the seat, e.g. what clicking it will do. */
  title?: string;
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
  /** Where the pot sits relative to the board in the center slot.
   *  - "above" (default): chips tower upward above the board, label beneath them.
   *  - "below": chips spread horizontally under the board, label beneath.
   *    Reads like a real table (the pot is pushed in front of the board) and
   *    keeps a growing pot from creeping over the cards, which an upward tower
   *    does once the stack is tall. */
  potPlacement?: "above" | "below";
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
  /** When set, the dealer "D" badge becomes tappable (e.g. to arm a
   *  "move the button" flow). Only the recorder's setup phase passes this. */
  onDealerBadgeClick?: () => void;
  /** Pulsing cue on the D badge while the move-button flow is armed. */
  dealerBadgeArmed?: boolean;
  /** Chips/bb display toggle ("Show in BB") rendered in the table's top-right
   *  corner. Pass the money display to show it; omit (or null) to hide - the
   *  toggle belongs to the table, so each caller decides per use. */
  moneyToggle?: MoneyToggleMoney | null;
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
  potPlacement = "above",
  potWinnerSeatIndex,
  onSeatClick,
  feltStyle,
  aspectClassName = "aspect-[7/5]",
  maxWidthClassName = "max-w-sm",
  cardBackWidth = 30,
  className,
  coordsOverride,
  onDealerBadgeClick,
  dealerBadgeArmed,
  moneyToggle,
}) => {
  const coords = coordsOverride ?? seatCoords(size);

  // Pot layer: the label is centered at (POT_BASE_X, POT_BASE_Y) with the chip
  // stack floating just above it ("above") or spread below the board with the
  // label under it ("below"). Either way the base Y clears the board cards so
  // neither the label nor the chips cover them. When a winner is set the pot
  // slides ~45% of the way toward that seat; animating left/top gives a smooth
  // "chips pushed to the winner" motion.
  const showPot = potAmount != null && Math.round(potAmount) >= 1;
  const potBelow = potPlacement === "below";
  const potWinnerCoord =
    potWinnerSeatIndex != null ? coords[potWinnerSeatIndex] : null;
  const POT_BASE_X = 50;
  // "above": label center just above the board. "below": center of the
  // chips+label block, low enough to clear the board on a phone (where the
  // cards take the largest share of the table's height) and still well short
  // of the bottom seat's bet, which lands at ~80% for a bottom-center seat.
  const POT_BASE_Y = potBelow ? 65 : 36;
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
      {/* chips/bb toggle, riding the table's top-right corner */}
          {moneyToggle && (
            <MoneyToggle
              money={moneyToggle}
              className="absolute right-0 top-0 z-40"
            />
          )}

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
                {potBelow ? (
                  /* Spread sits in normal flow above the label, so the layer's
                     anchor grows downward from the board instead of upward
                     into it. A horizontal spread is short enough that it does
                     not need to be lifted out of the box the way the tower is. */
                  <div
                    className="flex justify-center"
                    style={{ transform: "scale(0.6)", transformOrigin: "center bottom" }}
                  >
                    <ChipStack
                      amount={potAmount!}
                      horizontal
                      showLabel={false}
                      showBreakdown={false}
                      showAmount={false}
                    />
                  </div>
                ) : (
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
                )}
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
            const clickable = !!onSeatClick && seat.interactive !== false;

            // Bet pushed toward the table center: interpolate ~30% from the
            // seat's rim position toward the middle (50,50).
            const t = 0.3;
            const betX = coord.x + (50 - coord.x) * t;
            const betY = coord.y + (50 - coord.y) * t;
            const hasBet = seat.committedAmount != null && seat.committedAmount > 0;
            const showChips = hasBet && Math.round(seat.committedAmount!) >= 1;

            // Folded/sitting-out dimming is applied to the seat's contents,
            // never to the dealer badge: the button marker stays fully
            // visible for the whole hand even after that player folds.
            const dimClass =
              seat.folded || seat.sittingOut ? "opacity-40 grayscale" : "";

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
                title={seat.title}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-lg transition-transform ${
                  // A clickable seat lifts slightly on hover: the seat is a
                  // cluster of badges rather than one surface, so a background
                  // tint would only light part of it.
                  clickable
                    ? "cursor-pointer hover:-translate-y-[calc(50%+2px)] active:scale-95"
                    : "cursor-default"
                } ${
                  seat.highlighted
                    ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-transparent"
                    : ""
                }`}
                style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                aria-label={`Seat ${seat.label}`}
              >
                {/* Card row also renders (empty) for a card-less button seat,
                    so the D badge keeps an anchor after the player folds. */}
                {(seat.holeCards || seat.isButton) && (
                  <div className="relative flex gap-0.5">
                    {seat.holeCards && (
                      <div className={`flex ${dimClass}`}>
                        {seat.holeCards.map((c, h) => {
                          // Shrink cards a little for 4-5 card (PLO) hands so the
                          // row still fits the seat footprint.
                          const w =
                            seat.holeCards!.length >= 4
                              ? Math.round(cardBackWidth * 0.72)
                              : cardBackWidth;
                          // Cards are dealt fanned, each tucked under the next,
                          // so a hand takes ~20% less width per extra card and
                          // stops crowding the neighbouring seats. The offset is
                          // a fraction of the card so it holds at any size, and
                          // z-index rises left to right so the part that
                          // identifies a card - its top-left index - is the part
                          // that stays uncovered.
                          const overlap = h === 0 ? 0 : Math.round(w * 0.22);
                          return (
                            <div
                              key={h}
                              className="relative shrink-0"
                              style={{ width: w, marginLeft: -overlap, zIndex: h }}
                            >
                              {c ? (
                                <PlayingCard code={c} size="sm" width={w} />
                              ) : !seat.emptySlotsAsPlaceholders ? (
                                <CardBack w={w} />
                              ) : (
                                <>
                                  <div className="aspect-[3/4] rounded-[4px] border border-dashed border-white/30 bg-black/15" />
                                  {seat.nextSlotIndex === h && <NextSlotHighlight />}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {seat.isButton && (
                      /* The seat root is a <button>, so the badge stays a span
                         (nested buttons are invalid HTML). When interactive it
                         gets role="button" + stopPropagation so tapping it never
                         also opens the seat editor; keyboard users keep the
                         "Dealer button here" checkbox in the seat editor. The
                         outer padding + negative margin widens the tap target
                         to ~32px without changing the visual size. */
                      <span
                        role={onDealerBadgeClick ? "button" : undefined}
                        aria-label={onDealerBadgeClick ? "Move dealer button" : undefined}
                        onClick={
                          onDealerBadgeClick
                            ? (e) => {
                                e.stopPropagation();
                                onDealerBadgeClick();
                              }
                            : undefined
                        }
                        className={`absolute -right-3 -bottom-1 z-10 ${
                          onDealerBadgeClick ? "-m-1.5 cursor-pointer p-1.5" : ""
                        }`}
                      >
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 text-[10px] font-bold text-amber-950 shadow-md transition-transform ${
                            dealerBadgeArmed
                              ? "animate-pulse ring-2 ring-emerald-300"
                              : onDealerBadgeClick
                              ? "ring-1 ring-amber-700/70 shadow-[0_0_0_2px_rgba(255,255,255,0.35)] hover:scale-110 active:scale-95"
                              : "ring-1 ring-amber-700/70"
                          }`}
                        >
                          D
                        </span>
                      </span>
                    )}
                  </div>
                )}

                <div className={`flex flex-col items-center gap-0.5 ${dimClass}`}>
                  <span
                    className={`max-w-[88px] truncate rounded-md px-1.5 py-[1px] text-[10px] font-semibold shadow-md ${
                      seat.isEmpty
                        ? "border border-dashed border-white/40 bg-black/25 text-white/60"
                        : `ring-1 ${
                            seat.isActive
                              ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white ring-emerald-300/70"
                              : seat.isHero
                              ? "bg-gradient-to-b from-amber-400 to-amber-600 text-white ring-amber-300/70"
                              : "bg-gradient-to-b from-slate-800 to-slate-950 text-sky-100 ring-slate-600/70"
                          }`
                    }`}
                  >
                    {seat.label}
                  </span>

                  {seat.stackText && (
                    <span className="-mt-px rounded-b-md bg-black/60 px-1.5 text-[10px] font-semibold text-emerald-100 shadow-sm ring-1 ring-black/40">
                      {seat.stackText}
                    </span>
                  )}

                  {seat.sittingOut && seat.label.toLowerCase() !== "sitting out" && (
                    <span className="mt-0.5 rounded-full bg-black/50 px-1.5 text-[8px] font-semibold uppercase tracking-wide text-white/60">
                      sitting out
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
                </div>
              </button>
              </React.Fragment>
            );
          })}
    </PokerTableSurface>
  );
};

export default PokerTable;
