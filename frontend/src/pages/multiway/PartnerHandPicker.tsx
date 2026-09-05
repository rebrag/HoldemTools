// src/pages/multiway/PartnerHandPicker.tsx
//
// "The partner holds these two cards": the conditioning control for a
// hand-sharing team's chart when the payload carries the exact joint rows.
// The primary input is TYPED - "AsQd" - because the people conditioning a
// chart are at a keyboard and two cards are four keystrokes; the card slots
// and keypad stay in the wide form for touch. One card narrows the chart to
// every partner hand holding it; two pin it, and the combo breakdown under
// the chart then shows how the partner's suits block yours. Empty is the
// partner-averaged marginal, the same chart as a no-team seat's.
import { useEffect, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { formatCardsText, parseCardsText } from "./cardText";

const Slot = ({
  code,
  width,
  next,
  onClick,
  title,
}: {
  code: string | null;
  width: number;
  next: boolean;
  onClick: () => void;
  title: string;
}) =>
  code ? (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
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
 *  cards change from outside (a slot removed, "any hand"). */
const CardsInput = ({
  cards,
  onChange,
  dense,
  label,
}: {
  cards: string[];
  onChange: (cards: string[]) => void;
  dense: boolean;
  label: string;
}) => {
  const [text, setText] = useState(() => formatCardsText(cards));
  const [error, setError] = useState(false);
  const external = formatCardsText(cards);
  useEffect(() => {
    // Only when the outside disagrees with what the text already means, so
    // typing is never interrupted by its own echo.
    setText((cur) => (parseCardsText(cur).cards.join("") === external ? cur : external));
    setError(false);
  }, [external]);
  return (
    <input
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const parsed = parseCardsText(next);
        setError(parsed.error);
        if (!parsed.error && !parsed.incomplete && parsed.cards.join("") !== external) {
          onChange(parsed.cards);
        }
      }}
      onBlur={() => {
        if (!error) setText(external);
      }}
      placeholder="AsQd"
      spellCheck={false}
      autoComplete="off"
      maxLength={9}
      aria-label={label}
      title={`Type the partner's cards, e.g. AsQd or Th 9h. ${
        error ? "That is not two cards." : "One card narrows, two pin."
      }`}
      aria-invalid={error || undefined}
      className={`min-w-0 rounded border bg-slate-800/80 font-mono tabular-nums text-slate-100 placeholder:text-slate-500 focus:outline-none ${
        dense ? "w-full px-1 py-px text-[10px]" : "w-20 px-1.5 py-0.5 text-[11px]"
      } ${
        error
          ? "border-red-500/80 focus:border-red-400"
          : "border-slate-700 focus:border-emerald-500"
      }`}
    />
  );
};

const PartnerHandPicker = ({
  cards,
  onChange,
  partnerLabel,
  dense = false,
  note,
}: {
  /** Zero to two card codes ("Ah"), the partner's known cards. */
  cards: string[];
  onChange: (cards: string[]) => void;
  partnerLabel: string;
  /** The plate-sidebar form: label above a typed input, nothing else - it
   *  has to fit a 76px column. */
  dense?: boolean;
  /** A line about the conditioning shown, e.g. that it is never reached. */
  note?: string | null;
}) => {
  const [open, setOpen] = useState(false);
  const remove = (code: string) => onChange(cards.filter((c) => c !== code));

  if (dense) {
    return (
      <div className="flex w-full min-w-0 flex-col items-stretch gap-0.5 text-[9px]">
        <span
          className="truncate text-center uppercase tracking-wide text-slate-400"
          title={note ?? undefined}
        >
          {partnerLabel} holds
        </span>
        <CardsInput cards={cards} onChange={onChange} dense label={`${partnerLabel} holds`} />
        {note && (
          <span className="truncate text-center text-[8px] leading-tight text-amber-300" title={note}>
            {note}
          </span>
        )}
      </div>
    );
  }

  const slots = [0, 1].map((i) => (
    <Slot
      key={i}
      code={cards[i] ?? null}
      width={30}
      next={i === cards.length}
      onClick={() => (cards[i] ? remove(cards[i]) : setOpen(true))}
      title={cards[i] ? `Remove ${cards[i]}` : `Pick ${partnerLabel}'s card`}
    />
  ));

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{partnerLabel} holds</span>
      <CardsInput cards={cards} onChange={onChange} dense={false} label={`${partnerLabel} holds`} />
      <div className="flex items-center gap-1">{slots}</div>
      {cards.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
          title="Back to the partner-averaged chart"
        >
          Any hand
        </button>
      )}
      {note && <span className="text-[10px] text-slate-500">{note}</span>}
      <ResponsiveDrawer
        open={open}
        onClose={() => setOpen(false)}
        zClassName="z-[80]"
        ariaLabel={`${partnerLabel}'s cards`}
      >
        <h3 className="text-sm font-semibold text-slate-100">{partnerLabel} holds</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Tap a rank then a suit. One card narrows the chart to every hand with it; two pin the
          exact hand. Tap a placed card to take it back.
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
            Any hand
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
          >
            Done
          </button>
        </div>
        <RankSuitKeypad
          used={new Set(cards)}
          onPick={(code) => {
            if (cards.length >= 2 || cards.includes(code)) return;
            const next = [...cards, code];
            onChange(next);
            if (next.length === 2) setOpen(false);
          }}
          compact
          targetLabel={
            cards.length < 2
              ? `${partnerLabel}'s ${cards.length === 0 ? "first" : "second"} card`
              : undefined
          }
          className="rounded-xl border border-slate-700 bg-slate-900 p-2"
        />
      </ResponsiveDrawer>
    </div>
  );
};

export default PartnerHandPicker;
