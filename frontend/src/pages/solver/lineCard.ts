// One geometry for the solver's line strip, shared by the preflop Line and the
// postflop PostflopLine.
//
// The cards used to size themselves from their content, so a seat with four
// options made the whole strip taller than a seat with two and the header
// jumped as you walked the tree. Every card is now a fixed box: the option
// list scrolls inside it instead of growing it, and the strip's height is the
// same at every node of every sim.
//
// PostflopLine renders preflop cards of its own, so both files have to agree on
// the preflop width - hence one module rather than two sets of literals.

/** The one card height, both strips. Fits a header plus five option rows. */
export const LINE_CARD_H = "h-28";

/** Seat cards: "Raise 2.5", "Allin 80". */
export const LINE_CARD_W_PREFLOP = "w-[5.5rem]";

/** Postflop decision cards. Wider than the preflop ones because their rows
 *  carry both halves of a size: "Raise to 525.2" is 67px at the option font
 *  and its "(180%)" another 32px, which 7.5rem could not hold. */
export const LINE_CARD_W_POSTFLOP = "w-[8.5rem]";

/** Option row text. Board tiles and headers keep their own sizes. */
export const LINE_OPTION_TEXT = "text-[0.625rem]";

/** The percent beside a bet's amount: secondary to the label, so a size down
 *  and dimmer - and narrow enough to leave the label room to be read whole. */
export const LINE_PCT_TEXT = "text-[0.55rem]";

/** The option list inside a card: takes the leftover height and scrolls,
 *  rather than pushing the card taller. */
export const LINE_OPTIONS_COL =
  "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto no-scrollbar";
