// src/pages/compare/TreeBuilderPanel.tsx
//
// The /compare tree builder's body, laid out like PioViewer's "Tree building
// parameters" screen: two starting-range thumbnails with a swap between them,
// board / pot / stacks, then six sizing cards (IP's three streets, then
// OOP's), plus Copy to clipboard / Paste / Clear all.
//
// This renders CONTENT ONLY - no card chrome, no title, no action buttons.
// It lives inside a modal (SolverCompare) so that opening the builder does
// not push the comparison further down the page.
//
// Three deliberate departures from PioViewer:
//   - "Add to the Job Queue" is not here. Solving is driven by the modal's
//     footer, which goes through the compare-job pipeline.
//   - Street cards for streets the board length excludes stay on screen.
//     Editing the board must not reflow the panel under the cursor, so those
//     cards are marked unused rather than unmounted.
//   - The range grids are thumbnails, not editors. Clicking one opens the
//     full 13x13 editor, so the inline copy only has to be recognisable.
import { useMemo, useRef, useState } from "react";
import CardPicker from "@/components/CardPicker";
import PlayingCard from "@/components/PlayingCard";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import RangeEditorGrid, {
  RangeMiniGrid,
  weightedComboCount,
} from "@/components/RangeEditorGrid";
import { copyText } from "@/lib/clipboard";
import { activeStreets, type BuilderState } from "./builderState";
import {
  emptySeat,
  parseBoardCards,
  parseTreeConfigText,
  serializeTreeConfigText,
  STREET_KEYS,
  type SeatBoxes,
  type StreetBoxes,
  type StreetKey,
} from "./treeConfigText";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = ["h", "d", "c", "s"] as const;
const ALL_CARDS: string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

const STREET_LABEL: Record<StreetKey, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

export const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 " +
  "placeholder:text-slate-600 transition-colors " +
  "hover:border-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40";

export const buttonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 " +
  "bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors " +
  "hover:border-slate-500 hover:bg-slate-700/70 active:bg-slate-700 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

const labelCls = "text-[10px] font-medium uppercase tracking-wide text-slate-500";

/** Percent-of-pot list, or Pio's "a" for all-in. */
const SIZE_RE = /^(a|\d+(\.\d+)?)([\s,]+(a|\d+(\.\d+)?))*$/i;
const sizeOk = (v: string) => !v.trim() || SIZE_RE.test(v.trim());

const SizeField = ({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) => {
  const invalid = !sizeOk(value);
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-9 shrink-0 text-[10px] text-slate-400">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-label={`${label} sizes, percent of pot`}
        className={`${inputCls} tabular-nums ${
          invalid ? "border-red-500/70 focus:border-red-500 focus:ring-red-500/40" : ""
        }`}
      />
    </label>
  );
};

const Check = ({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) => (
  <label
    title={title}
    className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300 transition-colors hover:text-slate-100"
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3 w-3 rounded accent-emerald-500"
    />
    {label}
  </label>
);

/** One street's boxes for one seat, matching a PioViewer sizing card. */
const StreetCard = ({
  street,
  seat,
  boxes,
  inTree,
  onChange,
}: {
  street: StreetKey;
  seat: "oop" | "ip";
  boxes: StreetBoxes;
  inTree: boolean;
  onChange: (next: StreetBoxes) => void;
}) => {
  const set = <K extends keyof StreetBoxes>(key: K, value: StreetBoxes[K]) =>
    onChange({ ...boxes, [key]: value });
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-2 transition-colors ${
        inTree ? "border-slate-700/80 bg-slate-800/40" : "border-slate-800/60 bg-slate-900/30"
      }`}
    >
      {/* Fixed height: the "unused" badge is taller than the title text, and
          the whole point of keeping excluded streets on screen is that
          editing the board does not shift anything under the cursor. */}
      <div className="flex h-4 items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold ${inTree ? "text-slate-200" : "text-slate-500"}`}>
          {STREET_LABEL[street]} {seat.toUpperCase()}
        </span>
        {!inTree && (
          <span
            className="rounded-full bg-slate-800 px-1.5 text-[8px] font-medium uppercase tracking-wide text-slate-500"
            title="The board already includes this street's card, so the solve starts later. Kept on screen so the layout does not move while you edit the board."
          >
            unused
          </span>
        )}
      </div>
      <SizeField label="Bet" value={boxes.bet} placeholder="50 100" onChange={(v) => set("bet", v)} />
      {seat === "oop" && street !== "flop" && (
        <SizeField label="Donk" value={boxes.donk} placeholder="none" onChange={(v) => set("donk", v)} />
      )}
      <SizeField label="Raise" value={boxes.raise} placeholder="none" onChange={(v) => set("raise", v)} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Check
          label="Add allin"
          checked={boxes.addAllin}
          onChange={(v) => set("addAllin", v)}
          title="Also offer a jam wherever this seat can bet or raise on this street."
        />
        {seat === "ip" && (
          <Check
            label="No 3-bet"
            checked={boxes.noThreeBet}
            onChange={(v) => set("noThreeBet", v)}
            title="PioViewer's Don't 3-bet: IP never makes the third aggressive action of the street. It can open, and it can raise OOP's bet, but it cannot re-raise a raise."
          />
        )}
      </div>
    </div>
  );
};

interface TreeBuilderPanelProps {
  value: BuilderState;
  onChange: (next: BuilderState) => void;
  disabled?: boolean;
}

const TreeBuilderPanel = ({ value, onChange, disabled }: TreeBuilderPanelProps) => {
  const [editingRange, setEditingRange] = useState<"oop" | "ip" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Shown when the browser refuses clipboard reads (Firefox has no readText
   *  for ordinary pages, and Chrome needs the tab focused). Without it Paste
   *  is simply unusable there. */
  const [pasteBox, setPasteBox] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const set = <K extends keyof BuilderState>(key: K, next: BuilderState[K]) =>
    onChange({ ...value, [key]: next });

  const flash = (kind: "ok" | "error", text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };

  const board = useMemo(() => parseBoardCards(value.board), [value.board]);
  const active = useMemo(() => activeStreets(value.board), [value.board]);
  const usedCards = useMemo(() => new Set(board), [board]);
  const anyNoThreeBet = STREET_KEYS.some((s) => value.ip[s].noThreeBet);

  const setSeatStreet = (seat: "oop" | "ip", street: StreetKey, next: StreetBoxes) =>
    onChange({ ...value, [seat]: { ...value[seat], [street]: next } });

  const onPickCard = (code: string) => {
    if (board.includes(code)) {
      set("board", board.filter((c) => c !== code).join(" "));
      return;
    }
    if (board.length >= 5) return;
    set("board", [...board, code].join(" "));
  };

  const randomBoard = () => {
    const deck = [...ALL_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // Keep the street: a random board that turned a river solve into a flop
    // solve would silently rebuild a much bigger tree.
    const count = Math.min(5, Math.max(3, board.length || 5));
    set("board", deck.slice(0, count).join(" "));
  };

  const onCopy = async () => {
    const ok = await copyText(serializeTreeConfigText(value));
    if (!ok) {
      flash("error", "The browser refused clipboard access.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const loadConfigText = (text: string) => {
    try {
      const parsed = parseTreeConfigText(text);
      const next: BuilderState = { ...value, oop: parsed.oop, ip: parsed.ip };
      if (!value.betStructureOnly) Object.assign(next, parsed.spot);
      onChange(next);
      setPasteBox(null);
      flash(
        "ok",
        value.betStructureOnly
          ? "Loaded the betting structure; ranges, board, pot and stacks kept."
          : "Loaded the tree configuration."
      );
    } catch (e) {
      flash("error", e instanceof Error ? e.message : String(e));
    }
  };

  const onPaste = async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setPasteBox("");
      flash("error", "This browser will not hand over the clipboard - paste the config below.");
      return;
    }
    loadConfigText(text);
  };

  const clearAll = () => {
    onChange({ ...value, oop: emptySeat(), ip: emptySeat() });
    flash("ok", "Cleared every bet size. The board and ranges are untouched.");
  };

  const copyIpToOop = () => {
    const next: SeatBoxes = {
      flop: { ...value.ip.flop, donk: value.oop.flop.donk, noThreeBet: false },
      turn: { ...value.ip.turn, donk: value.oop.turn.donk, noThreeBet: false },
      river: { ...value.ip.river, donk: value.oop.river.donk, noThreeBet: false },
    };
    set("oop", next);
  };

  /** Thumbnail, not an editor - clicking opens the real 13x13 grid, so this
   *  only has to be big enough to recognise the shape of a range. */
  const rangeCard = (which: "oop" | "ip") => {
    const weights = which === "oop" ? value.oopRange : value.ipRange;
    const pct = (weightedComboCount(weights) / 1326) * 100;
    return (
      <button
        type="button"
        onClick={() => setEditingRange(which)}
        disabled={disabled}
        className="group rounded-lg border border-slate-700/80 bg-slate-800/40 p-1.5 transition-colors hover:border-emerald-600/70 hover:bg-slate-800/80 disabled:opacity-50"
        title={`${which.toUpperCase()} starting range - click to edit`}
      >
        <div className="w-16">
          <RangeMiniGrid weights={weights} />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-1">
          <span className="text-[10px] font-semibold text-slate-300">{which.toUpperCase()}</span>
          <span className="text-[10px] tabular-nums text-emerald-400">{pct.toFixed(0)}%</span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: ranges, board, pot, stacks */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-1">
          {rangeCard("oop")}
          <button
            type="button"
            onClick={() => onChange({ ...value, oopRange: value.ipRange, ipRange: value.oopRange })}
            disabled={disabled}
            className={`${buttonCls} px-1.5 py-2`}
            title="Swap the two starting ranges"
            aria-label="Swap OOP and IP starting ranges"
          >
            <span aria-hidden="true" className="leading-none">
              ⇄
            </span>
          </button>
          {rangeCard("ip")}
        </div>

        <div className="flex min-w-[15rem] flex-1 flex-col gap-1">
          <span className={labelCls}>Board</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={value.board}
              onChange={(e) => set("board", e.target.value)}
              placeholder="9c 5d Jc 7s 9h"
              aria-label="Board"
              className={`${inputCls} min-w-[9rem] flex-1`}
            />
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className={buttonCls}
              aria-expanded={pickerOpen}
            >
              Select
            </button>
            <button type="button" onClick={randomBoard} className={buttonCls}>
              Rand
            </button>
          </div>
          <div className="flex min-h-[26px] flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex items-center gap-0.5">
              {board.map((code) => (
                <PlayingCard key={code} code={code} width={20} />
              ))}
            </div>
            <span
              className={`text-[10px] ${board.length < 3 ? "text-amber-400" : "text-slate-500"}`}
            >
              {board.length < 3
                ? "Needs at least 3 cards"
                : board.length === 5
                  ? "River solve"
                  : board.length === 4
                    ? "Turn solve · river runs out in the tree"
                    : "Flop solve · turn and river run out in the tree"}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <label className="flex w-20 flex-col gap-1">
            <span className={labelCls}>Pot</span>
            <input
              type="text"
              inputMode="decimal"
              value={value.pot}
              onChange={(e) => set("pot", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
          </label>
          <label className="flex w-20 flex-col gap-1">
            <span className={labelCls}>Stacks</span>
            <input
              type="text"
              inputMode="decimal"
              value={value.effectiveStacks}
              onChange={(e) => set("effectiveStacks", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
          </label>
        </div>
      </div>

      {pickerOpen && (
        <div className="max-h-[200px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
          <CardPicker
            used={usedCards}
            onPick={onPickCard}
            size="sm"
            fitToWidth
            cardWidth="100%"
            gapPx={3}
            className="mx-auto inline-grid w-full"
          />
        </div>
      )}

      {/* Sizing - IP first, matching PioViewer */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={labelCls}>In position</span>
            <button type="button" onClick={copyIpToOop} className={buttonCls}>
              Copy IP → OOP
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {STREET_KEYS.map((street) => (
              <StreetCard
                key={`ip-${street}`}
                street={street}
                seat="ip"
                boxes={value.ip[street]}
                inTree={active.has(street)}
                onChange={(next) => setSeatStreet("ip", street, next)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={labelCls}>Out of position</span>
            <button type="button" onClick={clearAll} className={buttonCls}>
              Clear all sizes
            </button>
          </div>
          {/* items-start: the flop card has no donk box, and stretching it to
              its neighbours would leave a band of dead space. */}
          <div className="grid items-start gap-2 sm:grid-cols-3">
            {STREET_KEYS.map((street) => (
              <StreetCard
                key={`oop-${street}`}
                street={street}
                seat="oop"
                boxes={value.oop[street]}
                inTree={active.has(street)}
                onChange={(next) => setSeatStreet("oop", street, next)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Thresholds */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls} title="A bet computed at or above this share of the effective stack becomes a jam instead.">
            All-in threshold
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={value.allinThresholdPct}
              onChange={(e) => set("allinThresholdPct", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
            <span className="shrink-0 text-[10px] text-slate-500">% stack</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span
            className={labelCls}
            title="Carried in the copied config for PioViewer, which applies it per node. htsolver adds the jam wherever Add allin is ticked."
          >
            Add all-in only if &lt;
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={value.addAllinCapPct}
              onChange={(e) => set("addAllinCapPct", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
            <span className="shrink-0 text-[10px] text-slate-500">% pot · Pio</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls} title="Bets plus raises allowed on one street, counted across both seats.">
            Max raises
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={value.maxRaises}
            onChange={(e) => set("maxRaises", e.target.value)}
            className={`${inputCls} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls} title="Aggressor on the street before the root; gates whether OOP's first-in uses donk sizes.">
            Aggressor before root
          </span>
          <select
            value={value.preflopAggressor}
            onChange={(e) =>
              set("preflopAggressor", e.target.value as BuilderState["preflopAggressor"])
            }
            className={inputCls}
          >
            <option value="none">none</option>
            <option value="ip">IP</option>
            <option value="oop">OOP</option>
          </select>
        </label>
      </div>

      {/* Clipboard interop */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <button type="button" onClick={onCopy} className={buttonCls} disabled={disabled}>
          {copied ? "Copied" : "Copy to clipboard"}
        </button>
        <button type="button" onClick={onPaste} className={buttonCls} disabled={disabled}>
          Paste
        </button>
        <Check
          label="Change only betting structure when loading"
          checked={value.betStructureOnly}
          onChange={(v) => set("betStructureOnly", v)}
          title="With this on, Paste replaces the six sizing cards and leaves ranges, board, pot and stacks as they are."
        />
        <span className="ml-auto text-[10px] text-slate-600">PioViewer tree-config format</span>
      </div>

      {notice && (
        <p
          className={`rounded-md px-2 py-1 text-[10px] ${
            notice.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
          }`}
        >
          {notice.text}
        </p>
      )}
      {anyNoThreeBet && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          "No 3-bet" is applied by htsolver but is not part of PioViewer's config
          text - re-tick it by hand after pasting there.
        </p>
      )}
      {pasteBox !== null && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
          <textarea
            value={pasteBox}
            onChange={(e) => setPasteBox(e.target.value)}
            rows={4}
            autoFocus
            placeholder="#Type#NoLimit&#10;#Range0#..."
            className={`${inputCls} font-mono leading-snug`}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadConfigText(pasteBox)}
              disabled={!pasteBox.trim()}
              className={buttonCls}
            >
              Load config
            </button>
            <button type="button" onClick={() => setPasteBox(null)} className={buttonCls}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Range editor - a second layer over the builder modal. */}
      {editingRange && (
        <ResponsiveDrawer
          open
          onClose={() => setEditingRange(null)}
          scrollMode="custom"
          desktopMaxWidthClassName="sm:max-w-lg"
          zClassName="z-[90]"
          ariaLabel="Edit starting range"
        >
          <div className="flex h-full flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Starting range - {editingRange.toUpperCase()}
              </h3>
              <button
                type="button"
                onClick={() => setEditingRange(null)}
                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RangeEditorGrid
                weights={editingRange === "oop" ? value.oopRange : value.ipRange}
                onChange={(next) => set(editingRange === "oop" ? "oopRange" : "ipRange", next)}
                disabled={disabled}
              />
            </div>
          </div>
        </ResponsiveDrawer>
      )}
    </div>
  );
};

export default TreeBuilderPanel;
