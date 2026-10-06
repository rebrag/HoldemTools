// src/components/PokerTable.tsx
// Reusable oval poker table: elliptical felt with seats placed around the rim
// and a caller-supplied center slot (board + pot for the hand recorder, a pot
// badge for the solver's single-range view).
//
// Sizing model: seat/bet/pot COORDINATES are percentages of the oval's own
// box (the "surface", see pokerGeometry), so placement is resolution-
// independent; every child SIZE (cards, plates, chips, fonts, gaps) derives
// from one `scale` measured off the rendered surface width, so the whole
// scene grows and shrinks together. Scale 1 = the 360px-wide phone reference
// at which the base sizes were tuned. The surface sits inside a gutter (the
// "scene", see the box-model note below) so that the seats, which straddle
// the rim, never leave the element the caller sized.
import React from "react";
import PokerTableSurface from "@/components/PokerTableSurface";
import PokerTableSeat, {
  CardBack,
  NextSlotHighlight,
  type PokerTableSeatData,
} from "@/components/PokerTableSeat";
import ChipStack from "@/components/ChipStack";
import MoneyToggle, { type MoneyToggleMoney } from "@/components/MoneyToggle";
import { seatCoords, betCoords, type SeatCoord } from "@/lib/pokerGeometry";
import { usePageVisible } from "@/hooks/usePageVisible";
import useElementSize from "@/hooks/useElementSize";

// Re-exported for the callers that import these from here (BoardRow,
// HandPreview, FlyingCards, EquityCalc).
export { CardBack, NextSlotHighlight };
export type { PokerTableSeatData };

// Width at which scale = 1. The base sizes were tuned at ~360px phone widths;
// 400 renders everything ~10% smaller than that tuning at every width, which
// keeps the table from feeling cramped. The clamp keeps desktop from going
// cartoonish (extra width past ~640px becomes breathing room between seats)
// and keeps the solver's smallest mobile dock legible.
const REF_WIDTH = 400;
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.6;

// ── Box model: scene = gutter + surface ─────────────────────────────────────
// The SURFACE is the oval itself (rail + felt), a fixed 7/5 box that every
// seat / bet / pot coordinate is a percentage of. Seats sit on its rim, so
// their clusters overhang it: up to ~60·scale px sideways (plate half-width
// + avatar), more below the hero (plate + `extra` badge + to-act halo). The
// SCENE is the element callers size: the surface plus a gutter on each side
// big enough for that overhang, so everything the table renders stays inside
// the caller's box - no caller needs overflow clipping, and none grows a
// scrollbar. Gutters are fractions of the surface; the resulting CSS padding
// is a percentage of the scene width (CSS resolves % padding against the
// containing block's WIDTH on all four sides), derived here rather than
// typed, so the two can never drift.
// Below SCALE_MIN (surface < 300px) clusters are fixed-px and a percentage
// gutter cannot cover them by construction; the solver's smallest dock fits
// to within a pixel there, with only the halo's glow reaching the edge.
const SURFACE_ASPECT = 7 / 5;
const GUTTER_X = 0.08; // of surface width, each side
const GUTTER_TOP = 0.1; // of surface height
const GUTTER_BOTTOM = 0.13; // of surface height: the hero's badge + halo
/** Surface width as a fraction of the scene width. */
export const TABLE_SURFACE_FRACTION = 1 / (1 + 2 * GUTTER_X);
const PAD_X = GUTTER_X * TABLE_SURFACE_FRACTION;
const PAD_TOP = (GUTTER_TOP * TABLE_SURFACE_FRACTION) / SURFACE_ASPECT;
const PAD_BOTTOM = (GUTTER_BOTTOM * TABLE_SURFACE_FRACTION) / SURFACE_ASPECT;
/** Scene width / height: what a caller fitting the table to a height budget
 *  multiplies by (the scene has no aspect-ratio of its own - its height is
 *  the padding plus the surface, which this equals). */
export const TABLE_ASPECT =
  (SURFACE_ASPECT * (1 + 2 * GUTTER_X)) / (1 + GUTTER_TOP + GUTTER_BOTTOM);
const SCENE_PADDING = `${PAD_TOP * 100}% ${PAD_X * 100}% ${PAD_BOTTOM * 100}% ${PAD_X * 100}%`;

// Amount pills beside the chip rows: the same white-on-dark language as the
// seat plates, for pots and bets alike.
const POT_PILL = "rounded-full bg-black/50 px-3 py-0.5 text-white shadow";
const BET_PILL = "rounded-full bg-black/60 px-1.5 py-[1px] text-white shadow";

export interface PokerTableProps {
  size: number; // seat count -> seatCoords(size)
  seats: PokerTableSeatData[];
  /** Center content (board/pot/etc.). The function form receives the table's
   *  current scale and the hole-card width so callers can size board cards
   *  identically to the players' cards. */
  center?:
    | React.ReactNode
    | ((ctx: { scale: number; cardWidth: number }) => React.ReactNode);
  /** Pot chip amount rendered as its own movable row above the table center.
   *  The MAIN pot when side pots exist. Omit (or <1) to show no pot. */
  potAmount?: number;
  /** Text label shown beside the pot chips, e.g. "Pot 22 BB" / "Main 1900". */
  potLabel?: string;
  /** Side pots (an all-in split the pot): each renders as its own chip row +
   *  label under the main pot's row. */
  sidePots?: { amount: number; label: string }[];
  /** When set, the pot slides partway toward this seat index (winner award). */
  potWinnerSeatIndex?: number | null;
  onSeatClick?: (index: number) => void;
  feltStyle?: React.CSSProperties; // override the default teal gradient
  /** Width cap on the scene (the whole table box), default "max-w-sm". Pass
   *  every max-w-* the table needs here, not split with `className`: both
   *  land on the same element, where two max-w utilities fight. */
  maxWidthClassName?: string;
  cardBackWidth?: number; // hole-card width at scale 1, default 30
  className?: string;
  /** override seatCoords(size), e.g. to pull side seats inward. Bets keep
   *  using the standard bet ring for `size`. */
  coordsOverride?: SeatCoord[];
  /** When set, the dealer "D" badge becomes tappable (e.g. to arm a
   *  "move the button" flow). Only the recorder's setup phase passes this. */
  onDealerBadgeClick?: () => void;
  /** Pulsing cue on the D badge while the move-button flow is armed. */
  dealerBadgeArmed?: boolean;
  /** When set, a seat's player photo becomes its own target (opening that
   *  player's editor) instead of falling through to onSeatClick. Only wired
   *  where a resolved roster player exists, so there is never a live-looking
   *  affordance with nothing behind it. */
  onSeatAvatarClick?: (index: number) => void;
  /** Accessible name / tooltip for a clickable avatar, given the seat label.
   *  Defaults to the recorder's "Edit {name}"; the replayer, where the photo
   *  opens a lightbox, says what that click does instead. */
  seatAvatarLabel?: (seatLabel: string) => string;
  /** Chips/bb display toggle ("Show in BB") rendered in the table's top-right
   *  corner. Pass the money display to show it; omit (or null) to hide - the
   *  toggle belongs to the table, so each caller decides per use. */
  moneyToggle?: MoneyToggleMoney | null;
}

const PokerTable: React.FC<PokerTableProps> = ({
  size,
  seats,
  center,
  potAmount,
  potLabel,
  sidePots,
  potWinnerSeatIndex,
  onSeatClick,
  feltStyle,
  maxWidthClassName = "max-w-sm",
  cardBackWidth = 30,
  className,
  coordsOverride,
  onDealerBadgeClick,
  onSeatAvatarClick,
  seatAvatarLabel = (label) => `Edit ${label}`,
  dealerBadgeArmed,
  moneyToggle,
}) => {
  const coords = coordsOverride ?? seatCoords(size);
  const bets = betCoords(size);
  // The to-act glow's pulse stops while the tab is hidden — a live-hand table
  // can sit open for hours, and `motion-reduce:animate-none` on the element
  // handles the reduced-motion side without JS.
  const pageVisible = usePageVisible();

  // Measure the rendered table (hysteresis keeps resize re-renders rare) and
  // derive the shared scale. First frame before the observer delivers falls
  // back to scale 1.
  const { ref: innerRef, width: tableWidth } = useElementSize<HTMLDivElement>();
  const scale =
    tableWidth > 0
      ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, tableWidth / REF_WIDTH))
      : 1;
  const px = (n: number) => Math.round(n * scale);
  const cardWidth = px(cardBackWidth);
  // One chip size everywhere: real layout boxes (no transform:scale hacks),
  // and the pot's chips match the players' bet chips.
  const chipRadius = Math.max(7, px(10.5));

  // Pot layer: a single row (chip spread + street/pot pill) so the pot never
  // grows upward into the board. The presentation is owned here, not by
  // callers, so every table (recorder, replayer, solver) shows the pot
  // identically. When a winner is set the pot slides ~45% of the way toward
  // that seat; animating left/top gives a smooth "chips pushed to the winner"
  // motion.
  const showPot = potAmount != null && Math.round(potAmount) >= 1;
  const potWinnerCoord =
    potWinnerSeatIndex != null ? coords[potWinnerSeatIndex] : null;
  const POT_BASE_X = 50;
  // The block's TOP edge: just below the board, so a second row (side pot)
  // grows downward into the bottom band — which is free whenever side pots
  // exist, since an all-in swept every bet.
  const POT_BASE_Y = 60;
  // The pot is a wide row now, so a shorter slide keeps its label pill from
  // reaching into the winner's cards - and, for a side-seat winner, clear of
  // that seat's plate, whose inner edge sits at ~21% with the 40% seat ring.
  const POT_SLIDE = 0.3;
  const potX = potWinnerCoord
    ? POT_BASE_X + (potWinnerCoord.x - POT_BASE_X) * POT_SLIDE
    : POT_BASE_X;
  const potY = potWinnerCoord
    ? POT_BASE_Y + (potWinnerCoord.y - POT_BASE_Y) * POT_SLIDE
    : POT_BASE_Y;

  return (
    /* The scene: what the caller sizes. `overflow-clip` is a safety net for
       the sub-SCALE_MIN case described above - it makes no scroll container
       and no stacking context, it just keeps a degenerate overhang inside
       the component instead of handing it to the caller's layout. */
    <div
      data-testid="poker-table"
      className={`relative mx-auto w-full overflow-clip ${maxWidthClassName} ${className ?? ""}`}
      style={{ padding: SCENE_PADDING }}
    >
      {/* chips/bb toggle, riding the scene's top-right corner: in the gutter,
          clear of the top-right seat on every table size */}
      {moneyToggle && (
        <MoneyToggle money={moneyToggle} className="absolute right-0 top-0 z-40" />
      )}

    <PokerTableSurface
      feltStyle={feltStyle}
      innerRef={innerRef}
      innerClassName="relative w-full aspect-[7/5]"
    >
      {/* center slot */}
      {center != null && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
          {typeof center === "function" ? center({ scale, cardWidth }) : center}
        </div>
      )}

      {/* pot layer — its own positioned element so it can slide to the winner. */}
      {showPot && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2"
          style={{
            left: `${potX}%`,
            top: `${potY}%`,
            transition: "left 0.6s ease, top 0.6s ease",
          }}
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-0.5">
            <ChipStack
              amount={potAmount!}
              chipRadius={chipRadius}
              horizontal
              showAmount={!!potLabel}
              amountText={potLabel}
              amountPlacement="right"
              amountClassName={POT_PILL}
            />
            {/* Each side pot is its own chip row, stacked under the main pot. */}
            {sidePots?.map((sp, k) => (
              <ChipStack
                key={k}
                amount={sp.amount}
                chipRadius={chipRadius}
                horizontal
                showAmount
                amountText={sp.label}
                amountPlacement="right"
                amountClassName={POT_PILL}
              />
            ))}
          </div>
        </div>
      )}

      {/* seats + their bets */}
      {seats.map((seat, i) => {
        if (seat.hidden) return null;
        const coord = coords[i];
        if (!coord) return null;
        const clickable = !!onSeatClick && seat.interactive !== false;

        // Bet row on the bet ring: strictly between this seat's cluster and
        // the center content (board + pot row), see betCoords.
        const bet = bets[i];
        const hasBet = seat.committedAmount != null && seat.committedAmount > 0;

        return (
          <React.Fragment key={seat.key}>
            {hasBet && bet && (
              <div
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${bet.x}%`, top: `${bet.y}%` }}
                aria-hidden="true"
              >
                <ChipStack
                  amount={seat.committedAmount!}
                  chipRadius={chipRadius}
                  horizontal={!bet.vertical}
                  showAmount={!!seat.committedText}
                  amountText={seat.committedText}
                  amountPlacement={bet.labelBelow ? "below" : "right"}
                  amountClassName={BET_PILL}
                />
              </div>
            )}
            <PokerTableSeat
              seat={seat}
              coord={coord}
              scale={scale}
              cardWidth={cardWidth}
              clickable={clickable}
              onClick={clickable ? () => onSeatClick!(i) : undefined}
              onDealerBadgeClick={onDealerBadgeClick}
              dealerBadgeArmed={dealerBadgeArmed}
              onAvatarClick={
                onSeatAvatarClick && seat.avatarPlayer && seat.avatarInteractive !== false
                  ? () => onSeatAvatarClick(i)
                  : undefined
              }
              avatarLabel={seatAvatarLabel(seat.label)}
              pageVisible={pageVisible}
            />
          </React.Fragment>
        );
      })}
    </PokerTableSurface>
    </div>
  );
};

export default PokerTable;
