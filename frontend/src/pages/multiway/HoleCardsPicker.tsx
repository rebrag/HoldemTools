// src/pages/multiway/HoleCardsPicker.tsx
//
// "This seat holds these two cards": one seat's hole cards in a deal. On
// /multiway a hand-sharing team's charts are conditioned on the PARTNER's
// cards, and the natural way to state a deal is seat by seat - SB types
// SB's cards on SB's plate, BB types BB's - so the picker belongs to the
// seat whose cards they are, and the view that owns the deal decides what
// each seat's cards do to whose chart.
//
// The primary input is TYPED - "AsQd" - because the people conditioning a
// chart are at a keyboard and two cards are four keystrokes; the card slots
// and keypad stay in the wide form for touch, and the dense form below lg
// offers a button that opens a keypad the owner supplies. One card narrows
// the partner's chart to every hand holding it; two pin it. A card another
// seat already holds is an error that names the holder.
//
// On the page, Tab is for these inputs: every card input carries
// `data-card-input`, Tab / Shift+Tab / Enter move between them in DOM
// order with wrap-around, and the second card typed moves on by itself, so
// a whole group's deals can be typed without touching the mouse (the travel
// itself is cardInputFocus.ts). Everything else the picker renders is kept
// out of the tab order.
import { useEffect, useRef, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { focusCardInput } from "./cardInputFocus";
import { formatCardsText, parseCardsText } from "./cardText";

/** The dense form's height with its label line, so a plate without a
 *  picker can reserve the same and keep the matrices in a card level. */
export const DENSE_PICKER_HEIGHT_PX = 50;
/** The dense form without the label line (compact plate sidebars, where the
 *  seat header right above already names the seat). */
export const COMPACT_PICKER_HEIGHT_PX = 36;

const NO_TAKEN: ReadonlySet<string> = new Set();

const Slot = ({
  code,
  width,
  next,
  onClick,
  title,
  tabIndex,
}: {
  code: string | null;
  width: number;
  next: boolean;
  onClick: () => void;
  title: string;
  tabIndex?: number;
}) =>
  code ? (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      tabIndex={tabIndex}
      className="rounded-md transition-transform hover:-translate-y-px active:scale-95"
    >
      <PlayingCard code={code} size="sm" width={width} />
    </button>
  ) : (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      tabIndex={tabIndex}
      style={{ width }}
      className={`flex aspect-[3/4] items-center justify-center rounded-md border border-dashed text-[10px] transition-colors ${
        next
          ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
          : "border-white/25 bg-black/20 text-slate-400 hover:border-white/50"
      }`}
    >
      ?
    </button>
  );

/** The typed form of the cards. Local text so a half-typed hand is not
 *  fought over; committed on every keystroke that parses, re-synced when the
 *  cards change from outside (a slot removed, cleared, the keypad). */
const CardsInput = ({
  cards,
  onChange,
  dense,
  label,
  taken,
  holderOf,
  inputKey,
  inputRef,
}: {
  cards: string[];
  onChange: (cards: string[]) => void;
  dense: boolean;
  label: string;
  taken: ReadonlySet<string>;
  holderOf?: (card: string) => string | undefined;
  inputKey?: string;
  inputRef: React.RefObject<HTMLInputElement>;
}) => {
  const [text, setText] = useState(() => formatCardsText(cards));
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  /* Set when a keystroke completes the second card: focus moves on once
   * the commit has come back around as `cards`, not inside the change
   * handler - moving focus there fires this input's own blur with the
   * commit still pending, and the two fight over the text. */
  const advanceRef = useRef(false);
  const external = formatCardsText(cards);
  useEffect(() => {
    // Only when the outside disagrees with what the text already means, so
    // typing is never interrupted by its own echo.
    setText((cur) => (parseCardsText(cur).cards.join("") === external ? cur : external));
    setError(false);
    setConflict(null);
    if (advanceRef.current) {
      advanceRef.current = false;
      focusCardInput(inputRef.current, 1);
    }
  }, [external, inputRef]);
  const problem = conflict
    ? `${conflict} is held by ${holderOf?.(conflict) ?? "another seat"}.`
    : error
      ? "That is not two cards."
      : "One card narrows the partner's chart, two pin it. Tab or Enter moves to the next seat.";
  return (
    <input
      ref={inputRef}
      data-card-input={inputKey ?? ""}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parseCardsText(next, taken);
        setError(parsed.error);
        setConflict(parsed.conflict);
        if (!parsed.error && !parsed.incomplete && parsed.cards.join("") !== external) {
          advanceRef.current = parsed.cards.length === 2;
          onChange(parsed.cards);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          focusCardInput(e.currentTarget, e.shiftKey ? -1 : 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          focusCardInput(e.currentTarget, 1);
        }
      }}
      onBlur={() => {
        if (!error) setText(external);
      }}
      placeholder="AsQd"
      spellCheck={false}
      autoComplete="off"
      enterKeyHint="next"
      maxLength={9}
      aria-label={`${label} holds`}
      title={`Type ${label}'s cards, e.g. AsQd or Th 9h. ${problem}`}
      aria-invalid={error || undefined}
      className={`min-w-0 rounded border bg-slate-800/80 font-mono tabular-nums leading-tight text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
        dense ? "w-full px-1.5 py-1 text-[11px]" : "w-20 px-1.5 py-1 text-[11px]"
      } ${
        error
          ? "border-red-500/80 focus:border-red-400 focus:ring-red-400/60"
          : "border-slate-700 focus:border-emerald-400 focus:ring-emerald-400/70"
      }`}
    />
  );
};

/** The keypad sheet's contents: slots, Clear, Done and the rank/suit keypad.
 *  The wide picker opens it in its own drawer; the group view keeps ONE
 *  drawer for all its plates and mounts this in it. Its controls stay in
 *  the tab order: it is a dialog, and Tab is how a keyboard reaches Done. */
export const HoleCardsKeypad = ({
  cards,
  onChange,
  label,
  taken = NO_TAKEN,
  onDone,
}: {
  cards: string[];
  onChange: (cards: string[]) => void;
  label: string;
  taken?: ReadonlySet<string>;
  onDone: () => void;
}) => {
  const used = new Set([...cards, ...taken]);
  const remove = (code: string) => onChange(cards.filter((c) => c !== code));
  return (
    <>
      <h3 className="text-sm font-semibold text-slate-100">{label} holds</h3>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Tap a rank then a suit. One card narrows the partner{"'"}s chart to every hand with it;
        two pin the exact hand. Tap a placed card to take it back.
      </p>
      <div className="my-3 flex items-center gap-2">
        {[0, 1].map((i) => (
          <Slot
            key={i}
            code={cards[i] ?? null}
            width={44}
            next={i === cards.length}
            onClick={() => cards[i] && remove(cards[i])}
            title={cards[i] ? `Remove ${cards[i]}` : "Next card goes here"}
          />
        ))}
        <button
          type="button"
          disabled={cards.length === 0}
          onClick={() => onChange([])}
          className="ml-2 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
        >
          Done
        </button>
      </div>
      <RankSuitKeypad
        used={used}
        onPick={(code) => {
          if (cards.length >= 2 || used.has(code)) return;
          const next = [...cards, code];
          onChange(next);
          if (next.length === 2) onDone();
        }}
        compact
        targetLabel={
          cards.length < 2 ? `${label}'s ${cards.length === 0 ? "first" : "second"} card` : undefined
        }
        className="rounded-xl border border-slate-700 bg-slate-900 p-2"
      />
    </>
  );
};

const HoleCardsPicker = ({
  cards,
  onChange,
  label,
  dense = false,
  compact = false,
  note,
  noteTone = "warn",
  taken = NO_TAKEN,
  holderOf,
  onOpenKeypad,
  inputKey,
}: {
  /** Zero to two card codes ("Ah"): what this seat holds. */
  cards: string[];
  onChange: (cards: string[]) => void;
  /** The seat whose cards these are. */
  label: string;
  /** The plate-sidebar form: a typed input and one note line, fixed height,
   *  nothing else - it has to fit a 76px column. */
  dense?: boolean;
  /** Dense without its label line or keypad button: the lg+ sidebar, where
   *  the seat header right above already says whose cards these are and
   *  the keyboard is the way in. */
  compact?: boolean;
  /** A line about what these cards do here: never reached, the exact
   *  answer, a collision. Always given a line in the dense form so the
   *  height never moves. */
  note?: string | null;
  noteTone?: "warn" | "info";
  /** Cards other seats hold; typing one is an error. */
  taken?: ReadonlySet<string>;
  /** Names the seat holding a card, for the error's wording. */
  holderOf?: (card: string) => string | undefined;
  /** Dense form below lg: a keypad button, for touch. The owner shows the
   *  keypad and hands focus back through `focusCardInputByKey`. */
  onOpenKeypad?: () => void;
  /** Names this input on the page (`data-card-input`), so the owner can
   *  focus it again after a keypad drawer closes. */
  inputKey?: string;
}) => {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const remove = (code: string) => onChange(cards.filter((c) => c !== code));
  /* A press anywhere on the picker lands the caret in its input - without
   * the default mousedown, which would blur and re-focus the input and
   * re-select its text on every click in the padding. */
  const focusOnPress = (e: React.MouseEvent) => {
    if (e.target === inputRef.current) return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  if (dense) {
    const noteCls = noteTone === "info" ? "text-emerald-300" : "text-amber-300";
    return (
      <div
        className="flex w-full min-w-0 cursor-text flex-col items-stretch gap-0.5 text-[9px]"
        style={{ height: compact ? COMPACT_PICKER_HEIGHT_PX : DENSE_PICKER_HEIGHT_PX }}
        onMouseDown={focusOnPress}
      >
        {!compact && (
          <span className="truncate text-center uppercase tracking-wide text-slate-400">
            {label} holds
          </span>
        )}
        <div className="flex min-w-0 items-center gap-0.5">
          <CardsInput
            cards={cards}
            onChange={onChange}
            dense
            label={label}
            taken={taken}
            holderOf={holderOf}
            inputKey={inputKey}
            inputRef={inputRef}
          />
          {onOpenKeypad && !compact && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onOpenKeypad}
              className="shrink-0 rounded border border-slate-700 bg-slate-800/80 px-1.5 py-1 text-[11px] leading-tight text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
              title={`Pick ${label}'s cards on a keypad`}
              aria-label={`Pick ${label}'s cards on a keypad`}
            >
              ♠
            </button>
          )}
        </div>
        <span
          className={`h-[10px] truncate text-center text-[8px] leading-tight ${noteCls}`}
          title={note ?? undefined}
        >
          {note ?? ""}
        </span>
      </div>
    );
  }

  const slots = [0, 1].map((i) => (
    <Slot
      key={i}
      code={cards[i] ?? null}
      width={30}
      next={i === cards.length}
      tabIndex={-1}
      onClick={() => (cards[i] ? remove(cards[i]) : setOpen(true))}
      title={cards[i] ? `Remove ${cards[i]}` : `Pick ${label}'s card`}
    />
  ));

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span
        className="cursor-text text-[10px] uppercase tracking-wide text-slate-500"
        onMouseDown={focusOnPress}
      >
        {label} holds
      </span>
      <CardsInput
        cards={cards}
        onChange={onChange}
        dense={false}
        label={label}
        taken={taken}
        holderOf={holderOf}
        inputKey={inputKey}
        inputRef={inputRef}
      />
      <div className="flex items-center gap-1">{slots}</div>
      {cards.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange([])}
          className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
          title={`Forget ${label}'s cards`}
        >
          Clear
        </button>
      )}
      {note && (
        <span className={`text-[10px] ${noteTone === "info" ? "text-emerald-300" : "text-slate-500"}`}>
          {note}
        </span>
      )}
      <ResponsiveDrawer
        open={open}
        onClose={() => setOpen(false)}
        zClassName="z-[80]"
        ariaLabel={`${label}'s cards`}
      >
        <HoleCardsKeypad
          cards={cards}
          onChange={onChange}
          label={label}
          taken={taken}
          onDone={() => setOpen(false)}
        />
      </ResponsiveDrawer>
    </div>
  );
};

export default HoleCardsPicker;
