// Postflop line, GTO Wizard style: one card per visited node of the game
// tree. Preflop cards show each seat's options with the taken action
// highlighted, and clicking one leaves the board for that preflop node; a root
// card carries the pot + the board as it stood there (FLOP by default, see
// rootLabel); postflop decision cards let you jump along the line or branch to
// a different action; the node to act renders as the active (emerald) card.
//
// Two callers: the solver's postflop session, and /compare, which feeds it
// synthesized line nodes built straight from a .htc node directory (see
// pages/compare/compareLineNodes.ts). Both speak the same Pio colon node ids,
// which is what lets one component serve them.
import React from "react";
import { X } from "lucide-react";
import PlayingCard from "@/components/PlayingCard";
import type { PostflopSessionLineNode } from "@/hooks/usePostflopSession";
import type { PreflopLineNode } from "./usePreflopLineNodes";
import { fmtMoneyValue, type MoneyOpts } from "./boardDisplay";
import {
  LINE_CARD_H,
  LINE_CARD_W_POSTFLOP,
  LINE_CARD_W_PREFLOP,
  LINE_OPTION_TEXT,
  LINE_OPTIONS_COL,
  LINE_PCT_TEXT,
} from "./lineCard";

export interface PostflopLineProps {
  /** Raw preflop line; fallback summary when preflopNodes are unavailable. */
  preflopLine: string[] | null;
  /** Reconstructed preflop nodes (seat, stack, options, taken). */
  preflopNodes?: PreflopLineNode[] | null;
  /** Full board at the current node; the root card shows `rootCards`, which
   *  defaults to the first three. */
  board: string[];
  /** Pot at the root, in the solve's display money. */
  potMoney?: number | null;
  /** Chips/bb display; absent for sims, which always read as big blinds. */
  money?: MoneyOpts | null;
  lineNodes: PostflopSessionLineNode[];
  notice: string | null;
  onJump: (nodeId: string) => void;
  /** Branch: take `display` at the decision node `parentId`. */
  onPickAction?: (parentId: string, display: string) => void;
  /**
   * Leave the board and go back into the preflop tree at preflop node
   * `index`. Clicking the action the line took returns to that decision;
   * clicking any other option takes it instead, branching the preflop line.
   */
  onPreflopJump?: (index: number, action: string) => void;
  onExit: () => void;
  /**
   * True for a solve of a recorded hand (manifest carries seat_meta). Its
   * preflop line belongs to the hand, not to a navigable sim tree - the
   * synthetic {stacks} id has no plate files - so the strip renders neither
   * the preflop summary text nor the exit control, and starts at the FLOP
   * card. Leaving the session happens by opening another board or sim.
   */
  handSolve?: boolean;
  /** Seat to act at the current node (the active card). */
  actorSeat?: string;
  actorStackMoney?: number | null;
  /** `pct` (percent of the pot the bet goes into) prints beside the label;
   *  omit it and the row shows the label alone, which is what /compare does. */
  actions?: { display: string; pct?: number | null }[];
  onActionClick?: (display: string) => void;
  /** Display label of the action taken in the recorded hand at THIS node, when
   *  the viewer is still walking that hand's line. Marked "Played". */
  playedAction?: string | null;
  /** Disable all action buttons (e.g. while a street extraction is pending). */
  actionsDisabled?: boolean;
  /**
   * Label and cards on the root card. Defaults to "FLOP" and the first three
   * board cards, which is right for the solver: its trees are always rooted at
   * a flop. /compare solves a 3, 4 or 5 card board, so a turn- or river-rooted
   * tree has to say so and show every card that was already out at the root -
   * otherwise the strip claims a flop decision that is not in the tree.
   */
  rootLabel?: string;
  rootCards?: string[];
  /**
   * Show the "Preflop" exit control when there are no preflop cards to click.
   * Defaults on, preserving the solver's behaviour. /compare turns it off: its
   * trees have no preflop half at all, so there is nowhere to exit to.
   *
   * Deliberately NOT folded into `handSolve`, which means something else
   * entirely (see above) and happens to suppress the same control.
   */
  showExit?: boolean;
}

/* Shared card shell, mirroring the preflop Line's seat cards. Every card is
 * the same fixed height whatever it holds; `width` is the seat-card width for
 * a decision and empty for the board tiles, which are as wide as the cards
 * they show. `clickable` cards take a click anywhere on their body, not just
 * on an option row. */
const cardClass = (width: string, active = false, clickable = false) =>
  `flex flex-shrink-0 flex-col rounded-md border px-1.5 py-1 ${width} ${LINE_CARD_H} transition-colors ${
    active
      ? "border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
      : "border-white/15 bg-white/5"
  } ${clickable ? "cursor-pointer hover:bg-white/[0.07]" : ""}`;

/* The cards are too narrow for a unit suffix, so `stack` shows a bare number:
 * big blinds on a sim, the hand's own chips on a recorded hand. */
const CardHeader: React.FC<{
  label: string;
  active?: boolean;
  stack?: number | null;
  money?: MoneyOpts | null;
}> = ({ label, active, stack, money }) => (
  <div className="flex items-baseline justify-between gap-1 mb-0.5">
    <span
      className={`text-[0.7rem] font-bold leading-none ${
        active ? "text-emerald-300" : "text-gray-100"
      }`}
    >
      {label}
    </span>
    {stack != null && (
      <span className="text-[0.6rem] text-gray-300 tabular-nums leading-none">
        {fmtMoneyValue(stack, money)}
      </span>
    )}
  </div>
);

/** One option row: label, then the bet's size as a percent of the pot; the
 *  taken action gets a highlight pill. */
const OptionRow: React.FC<{
  action: string;
  /** Percent of pot for a bet or raise; null/absent for the rest. */
  pct?: number | null;
  taken?: boolean;
  /** This is the action the player actually took in the recorded hand. */
  played?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}> = ({ action, pct, taken, played, disabled, onClick, title }) => (
  <button
    type="button"
    /* The card body is clickable too, so a row click must not also count as
     * one on the card behind it. */
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    disabled={disabled || !onClick}
    title={title}
    className={`flex flex-shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left transition-colors ${
      taken ? "bg-white/15" : ""
    } ${
      onClick && !disabled
        ? "hover:bg-white/10 cursor-pointer"
        : "cursor-default"
    } ${disabled ? "opacity-60" : ""}`}
  >
    {/* The card is a fixed width, so the label clips before it widens it; the
        percent is the shorter half and stays whole. */}
    <span
      className={`${LINE_OPTION_TEXT} min-w-0 truncate leading-tight ${
        taken ? "text-gray-100 font-semibold" : "text-gray-300"
      }`}
    >
      {action}
    </span>
    {pct != null && (
      <span
        className={`${LINE_PCT_TEXT} flex-shrink-0 leading-tight tabular-nums text-gray-500`}
      >
        ({pct}%)
      </span>
    )}
    {played && (
      <span
        className="ml-auto flex-shrink-0 rounded-sm bg-amber-400/20 px-0.5 text-[0.45rem] font-semibold uppercase leading-tight tracking-wide text-amber-200"
        title="What you did in this hand"
      >
        Played
      </span>
    )}
  </button>
);

const PostflopLine: React.FC<PostflopLineProps> = ({
  preflopLine,
  preflopNodes,
  board,
  potMoney,
  money,
  lineNodes,
  notice,
  onJump,
  onPickAction,
  onPreflopJump,
  onExit,
  handSolve,
  actorSeat,
  actorStackMoney,
  actions,
  onActionClick,
  actionsDisabled,
  playedAction,
  rootLabel = "FLOP",
  rootCards,
  showExit = true,
}) => {
  const preflopSummary =
    !handSolve && preflopLine && preflopLine.length > 1
      ? preflopLine.slice(1).join(" · ")
      : null;
  /* The cards already out at the root. Defaults to the flop, which is where
   * every solver tree starts; /compare passes the whole pre-root board. */
  const rootBoard = rootCards ?? board.slice(0, 3);
  /* Every preflop card leaves the board, so no separate exit control is
   * needed. The button only comes back when a sim line could not be rebuilt
   * into cards; hand solves never show it (see handSolve above), and neither
   * does a screen that has no preflop tree behind it (see showExit). */
  const preflopCards = !!preflopNodes && preflopNodes.length > 0 && !!onPreflopJump;
  const exitButton = showExit && !preflopCards && !handSolve;

  return (
    <div className="mx-auto w-full select-none">
      <div className="w-full overflow-x-auto no-scrollbar animate-[fadeSlideIn_0.25s_ease-out]">
        {/* Fixed-size cards, left-aligned; the strip scrolls once the line
            outgrows the viewport. */}
        <div className="flex flex-nowrap items-stretch gap-1">
          {exitButton && (
            <button
              type="button"
              onClick={onExit}
              className={`flex flex-shrink-0 flex-col items-center justify-center rounded-md border border-white/15 bg-white/5 px-1.5 text-gray-300 transition-colors hover:bg-white/10 ${LINE_CARD_H}`}
              title="Exit postflop view"
            >
              <X size={14} />
              <span className="text-[0.5rem] mt-0.5 leading-none">Preflop</span>
            </button>
          )}

          {/* Preflop nodes: GTO Wizard style cards, else a summary chip */}
          {preflopNodes && preflopNodes.length > 0 ? (
            preflopNodes.map((node, i) => (
              <div
                key={`pre-${i}-${node.seat}`}
                onClick={
                  onPreflopJump ? () => onPreflopJump(i, node.taken) : undefined
                }
                title={
                  onPreflopJump
                    ? `Back to ${node.seat}'s preflop decision`
                    : undefined
                }
                className={cardClass(LINE_CARD_W_PREFLOP, false, !!onPreflopJump)}
              >
                {/* Preflop nodes are replayed from the sim, so their stacks
                    are big blinds whatever unit the postflop solve uses. */}
                <CardHeader label={node.seat} stack={node.stackBB} />
                <div className={LINE_OPTIONS_COL}>
                  {node.options.map((action) => (
                    <OptionRow
                      key={action}
                      action={action}
                      taken={action === node.taken}
                      onClick={
                        onPreflopJump ? () => onPreflopJump(i, action) : undefined
                      }
                      title={
                        action === node.taken
                          ? `Back to ${node.seat}'s preflop decision`
                          : `${node.seat}: switch to ${action} preflop`
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            preflopSummary && (
              <span
                className="flex-shrink-0 self-center max-w-[10rem] truncate text-[0.6rem] text-gray-400 px-1"
                title={preflopSummary}
              >
                {preflopSummary}
              </span>
            )
          )}

          {/* FLOP card: pot + board; clicking returns to the flop decision */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onJump("r:0")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onJump("r:0");
            }}
            className={`${cardClass("")} cursor-pointer hover:bg-white/10`}
            title={`Back to the ${rootLabel.toLowerCase()} decision`}
          >
            <CardHeader label={rootLabel} stack={potMoney ?? undefined} money={money} />
            <div className="flex items-center gap-0.5 mt-auto">
              {rootBoard.map((code) => (
                <PlayingCard key={code} code={code} width="clamp(20px, 3.6vw, 30px)" />
              ))}
            </div>
          </div>

          {/* Visited postflop nodes */}
          {lineNodes.map((node, i) => {
            if (node.kind === "card") {
              /* Which street this card opened, from its position in the line:
                 the n-th dealt card puts rootBoard.length + n + 1 cards out.
                 Derived rather than passed so a flop-, turn- or river-rooted
                 tree all label correctly without the caller saying which. */
              const cardsOut =
                rootBoard.length +
                lineNodes.slice(0, i + 1).filter((n) => n.kind === "card").length;
              const streetLabel = cardsOut === 4 ? "TURN" : "RIVER";
              return (
                <button
                  key={node.nodeId}
                  type="button"
                  onClick={() => onJump(node.nodeId)}
                  className={`${cardClass("")} cursor-pointer hover:bg-white/10`}
                  title={`Jump to the ${node.label} deal`}
                >
                  {/* Same header as the root tile: a dealt card should say
                      which street it opened and what was in the middle, not
                      float on its own. */}
                  <CardHeader
                    label={streetLabel}
                    stack={node.potMoney ?? undefined}
                    money={money}
                  />
                  <div className="mt-auto flex items-center justify-center gap-0.5">
                    <PlayingCard code={node.label} width="clamp(20px, 3.6vw, 30px)" />
                  </div>
                </button>
              );
            }
            return (
              <div
                key={node.nodeId}
                onClick={() => onJump(node.parentId)}
                title={`Back to ${node.seat}'s decision`}
                className={cardClass(LINE_CARD_W_POSTFLOP, false, true)}
              >
                <CardHeader label={node.seat} stack={node.stackMoney} money={money} />
                <div className={LINE_OPTIONS_COL}>
                  {node.options.map(({ label, pct }) => (
                    <OptionRow
                      key={label}
                      action={label}
                      pct={pct}
                      taken={label === node.taken}
                      disabled={actionsDisabled}
                      onClick={
                        onPickAction
                          ? () =>
                              label === node.taken
                                ? onJump(node.nodeId)
                                : onPickAction(node.parentId, label)
                          : undefined
                      }
                      title={
                        label === node.taken
                          ? `Jump to ${node.seat}'s ${label}`
                          : `${node.seat}: switch to ${label}`
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Current node: the seat to act (active card) */}
          {actions && actions.length > 0 && (
            <div className={cardClass(LINE_CARD_W_POSTFLOP, true)}>
              <CardHeader label={actorSeat ?? "To act"} active stack={actorStackMoney} money={money} />
              <div className={LINE_OPTIONS_COL}>
                {actions.map((a) => (
                  <OptionRow
                    key={a.display}
                    action={a.display}
                    pct={a.pct}
                    played={!!playedAction && a.display === playedAction}
                    disabled={actionsDisabled}
                    onClick={onActionClick ? () => onActionClick(a.display) : undefined}
                    title={
                      playedAction && a.display === playedAction
                        ? `${actorSeat ?? "To act"}: ${a.display} - what you did in this hand`
                        : `${actorSeat ?? "To act"}: ${a.display}`
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {notice && (
            <span className="flex-shrink-0 self-center rounded-md bg-amber-500/15 border border-amber-400/40 px-2 py-1 text-[0.6rem] text-amber-200">
              {notice}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostflopLine;
