// src/components/PokerTableSeat.tsx
// One seat cluster on the oval poker table: hole cards + dealer button, the
// name/stack plate with an optional avatar peeking from behind it, status
// tags, and the caller's `extra` node. Every pixel dimension derives from the
// table's shared `scale`, so the whole cluster grows and shrinks with the
// rendered table instead of staying fixed-px while the felt resizes.
import React from "react";
import PlayingCard from "@/components/PlayingCard";
import PlayerAvatar from "@/components/PlayerAvatar";
import type { Player } from "@/lib/playersApi";
import type { SeatCoord } from "@/lib/pokerGeometry";

/** Back of a playing card (unknown / face-down). */
export const CardBack: React.FC<{ w?: number }> = ({ w = 30 }) => (
  <div
    className="aspect-[3/4] rounded-[5px] border border-rose-950/60 bg-gradient-to-br from-rose-600 to-rose-800 shadow-md ring-1 ring-white/10"
    style={{ width: w }}
    aria-hidden="true"
  />
);

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

export interface PokerTableSeatData {
  key: string | number;
  label: string; // position name or player name
  stackText?: string; // preformatted, e.g. "22 BB"
  committedText?: string; // preformatted bet label, e.g. "2 bb" / "SB 0.5"
  /** Numeric bet (real chip amount). When set, the bet renders as a chip row
   *  on the table's bet ring with committedText as its label. */
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
  /** Linked-player identity for the avatar overlapping the plate's top-left
   *  corner (GGPoker-style). Carried as data, not a node, so the avatar sizes
   *  with the table. undefined = seat has no linked player, no avatar; null =
   *  linked player whose roster row hasn't resolved (renders initials from
   *  `label`). No layout shift when absent. */
  avatarPlayer?: Player | null;
}

export interface PokerTableSeatProps {
  seat: PokerTableSeatData;
  coord: SeatCoord;
  /** Shared table scale (1 = the 360px-wide reference table). */
  scale: number;
  /** Hole-card width in px, pre-scaled by the table. */
  cardWidth: number;
  clickable: boolean;
  onClick?: () => void;
  onDealerBadgeClick?: () => void;
  dealerBadgeArmed?: boolean;
  pageVisible: boolean;
}

const PokerTableSeat: React.FC<PokerTableSeatProps> = ({
  seat,
  coord,
  scale,
  cardWidth,
  clickable,
  onClick,
  onDealerBadgeClick,
  dealerBadgeArmed,
  pageVisible,
}) => {
  const px = (n: number) => Math.round(n * scale);
  const gap = Math.max(1, px(2));

  // Folded/sitting-out dimming is applied to the seat's contents, never to
  // the dealer badge: the button marker stays fully visible for the whole
  // hand even after that player folds.
  const dimClass = seat.folded || seat.sittingOut ? "opacity-40 grayscale" : "";

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      title={seat.title}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-lg transition ${
        // A clickable seat lifts slightly on hover: the seat is a cluster of
        // badges rather than one surface, so a background tint would only
        // light part of it.
        clickable
          ? "cursor-pointer hover:-translate-y-[calc(50%+2px)] active:scale-95"
          : "cursor-default"
      } ${
        seat.highlighted
          ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-transparent"
          : ""
      }`}
      style={{ left: `${coord.x}%`, top: `${coord.y}%`, gap }}
      aria-label={`Seat ${seat.label}`}
    >
      {/* To-act indicator: a pulsing emerald halo around the whole seat
          cluster. */}
      {seat.isActive && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-1.5 rounded-xl ring-2 ring-emerald-300 shadow-[0_0_18px_5px_rgba(52,211,153,0.45)] ${
            pageVisible ? "animate-pulse motion-reduce:animate-none" : ""
          }`}
        />
      )}
      {/* Card row also renders (empty) for a card-less button seat, so the D
          badge keeps an anchor after the player folds. */}
      {(seat.holeCards || seat.isButton) && (
        <div className="relative flex" style={{ gap }}>
          {seat.holeCards && (
            <div className={`flex ${dimClass}`}>
              {seat.holeCards.map((c, h) => {
                // Shrink cards a little for 4-5 card (PLO) hands so the row
                // still fits the seat footprint.
                const w =
                  seat.holeCards!.length >= 4
                    ? Math.round(cardWidth * 0.72)
                    : cardWidth;
                // Cards are dealt fanned, each tucked under the next, so a
                // hand takes ~16% less width per extra card and stops
                // crowding the neighbouring seats. The offset is a fraction
                // of the card so it holds at any size, and stops short of the
                // centred rank+suit the card is identified by (see
                // PlayingCard) - overlap much past this and the fan starts
                // hiding the "10" it exists to keep legible.
                const overlap = h === 0 ? 0 : Math.round(w * 0.16);
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
            /* The seat root is a <button>, so the badge stays a span (nested
               buttons are invalid HTML). When interactive it gets
               role="button" + stopPropagation so tapping it never also opens
               the seat editor; keyboard users keep the "Dealer button here"
               checkbox in the seat editor. The outer padding + negative
               margin widens the tap target to ~32px without changing the
               visual size. */
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
              className={`absolute z-10 ${
                onDealerBadgeClick ? "-m-1.5 cursor-pointer p-1.5" : ""
              }`}
              style={{ right: -px(12), bottom: -px(4) }}
            >
              <span
                className={`inline-flex items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 font-bold text-amber-950 shadow-md transition-transform ${
                  dealerBadgeArmed
                    ? "animate-pulse ring-2 ring-emerald-300"
                    : onDealerBadgeClick
                    ? "ring-1 ring-amber-700/70 shadow-[0_0_0_2px_rgba(255,255,255,0.35)] hover:scale-110 active:scale-95"
                    : "ring-1 ring-amber-700/70"
                }`}
                style={{ width: px(20), height: px(20), fontSize: px(10) }}
              >
                D
              </span>
            </span>
          )}
        </div>
      )}

      <div
        className={`relative flex flex-col items-center ${dimClass}`}
        style={{ gap }}
      >
        {seat.avatarPlayer !== undefined && (
          /* Peeks out from BEHIND the name+stack card's top-left corner so it
             reads as the player's face on the plate without moving anything. */
          <span
            className="pointer-events-none absolute"
            style={{ left: -px(16), top: -px(14) }}
          >
            <PlayerAvatar
              player={seat.avatarPlayer}
              name={seat.label}
              size={px(28)}
              className="ring-white/40 shadow-md"
            />
          </span>
        )}
        {/* Name + stack on one card. */}
        <span
          className={`relative z-10 flex flex-col items-center rounded-md shadow-md ${
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
          style={{
            maxWidth: px(88),
            padding: `${Math.max(1, px(1))}px ${px(6)}px`,
          }}
        >
          <span
            className="w-full truncate text-center font-semibold leading-tight"
            style={{ fontSize: px(10) }}
          >
            {seat.label}
          </span>
          {seat.stackText && (
            <span
              className={`w-full truncate text-center font-semibold leading-tight ${
                seat.isActive || seat.isHero ? "text-white/90" : "text-emerald-100"
              }`}
              style={{ fontSize: px(9) }}
            >
              {seat.stackText}
            </span>
          )}
        </span>

        {seat.sittingOut && seat.label.toLowerCase() !== "sitting out" && (
          <span
            className="rounded-full bg-black/50 px-1.5 font-semibold uppercase tracking-wide text-white/60"
            style={{ fontSize: px(8) }}
          >
            sitting out
          </span>
        )}

        {seat.extra}
      </div>
    </button>
  );
};

export default PokerTableSeat;
