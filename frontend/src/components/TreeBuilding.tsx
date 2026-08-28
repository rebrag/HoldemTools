// src/components/TreeBuilding.tsx
//
// The one "Tree building parameters" screen, laid out like PioViewer's: two
// starting-range thumbnails with a swap between them, board / pot / stacks,
// then six sizing cards (IP's three streets, then OOP's), and the thresholds.
//
// This renders CONTENT ONLY - no card chrome, no title, no action buttons.
// Both callers already own a drawer, a header and a footer whose buttons mean
// different things (/compare solves and publishes; the solver uploads a game
// tree), so putting any of that here would just have to be flagged back off.
//
// It is fully controlled. The solver's modal used to hold ten separate drafts
// and assemble them on confirm; it now holds one view object, which is also
// what keeps fields the modal cannot represent from being erased keystroke by
// keystroke (see lib/solver/treeParamsView.ts).
//
// Feature flags below are all genuine behavioural differences between the two
// entry points, not styling preferences. Anything page-specific that is not a
// difference in this screen belongs in headerSlot/footerSlot instead - and
// nothing in src/components may import from src/pages.
import { useMemo, useRef, useState, type ReactNode } from "react";
import CardPicker from "@/components/CardPicker";
import PlayingCard from "@/components/PlayingCard";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { RangeMiniGrid, weightedComboCount } from "@/components/RangeEditorGrid";
import RangeSelector, { type RangeTokenCodec } from "@/components/RangeSelector";
import { copyText } from "@/lib/clipboard";
import {
  TREE_STREETS,
  emptySeatView,
  parseBoardCards,
  parseBoardInputStrict,
  randomBoard,
  sizeOk,
  streetHasLead,
  type TreeBuildingView,
  type TreeClipboardCodec,
  type TreeSeat,
  type TreeSeatView,
  type TreeStreet,
  type TreeStreetView,
} from "@/components/treeBuildingView";

/** Style tokens shared with the pages that host this panel, so a solve-settings
 *  fieldset sitting directly beneath it matches without re-deriving them. */
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

const STREET_LABEL: Record<TreeStreet, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

/** Streets a board length actually puts in the tree. A 5-card board is a river
 *  solve, so flop and turn are inert - their boxes stay on screen and editable,
 *  they just do not reach the solver. */
const activeStreetsFor = (cardCount: number): Set<TreeStreet> => {
  const active = new Set<TreeStreet>(["river"]);
  if (cardCount <= 4) active.add("turn");
  if (cardCount <= 3) active.add("flop");
  return active;
};

const SizeField = ({
  label,
  value,
  placeholder,
  invalid,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) => (
  <label className="flex items-center gap-1.5">
    <span className="w-9 shrink-0 text-[10px] text-slate-400">{label}</span>
    <input
      type="text"
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      /* Raw value, never trimmed: both serializers gate their output on plain
         truthiness of the untrimmed string, so normalising here would change
         what PioSOLVER receives. */
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid}
      aria-label={`${label} sizes, percent of pot`}
      className={`${inputCls} tabular-nums ${
        invalid ? "border-red-500/70 focus:border-red-500 focus:ring-red-500/40" : ""
      }`}
    />
  </label>
);

/** Exported alongside inputCls/buttonCls for the same reason: a solve-settings
 *  fieldset sitting beneath this panel should match it. Purely presentational,
 *  so this does not put page-specific behaviour in the shared panel. */
export const Check = ({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) => (
  <label
    title={title}
    className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300 transition-colors hover:text-slate-100"
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
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
  showDonk,
  showNoThreeBet,
  requireLead,
  disabled,
  onChange,
}: {
  street: TreeStreet;
  seat: TreeSeat;
  boxes: TreeStreetView;
  inTree: boolean;
  showDonk: boolean;
  showNoThreeBet: boolean;
  requireLead: boolean;
  disabled?: boolean;
  onChange: (next: TreeStreetView) => void;
}) => {
  const set = <K extends keyof TreeStreetView>(key: K, value: TreeStreetView[K]) =>
    onChange({ ...boxes, [key]: value });

  const missingLead = requireLead && !streetHasLead(boxes);

  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border p-1.5 transition-colors ${
        inTree ? "border-slate-700/80 bg-slate-800/40" : "border-slate-800/60 bg-slate-900/30"
      }`}
    >
      {/* Fixed height: the "unused" badge is taller than the title text, and
          the whole point of keeping excluded streets on screen is that
          editing the board does not shift anything under the cursor. */}
      <div className="flex h-4 items-center justify-between gap-2">
        <span
          className={`text-[11px] font-semibold ${inTree ? "text-slate-200" : "text-slate-500"}`}
        >
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
      <SizeField
        label="Bet"
        value={boxes.bet}
        placeholder="50 100"
        invalid={!sizeOk(boxes.bet) || missingLead}
        disabled={disabled}
        onChange={(v) => set("bet", v)}
      />
      {showDonk && (
        <SizeField
          label="Donk"
          value={boxes.donk}
          placeholder="none"
          invalid={!sizeOk(boxes.donk)}
          disabled={disabled}
          onChange={(v) => set("donk", v)}
        />
      )}
      <SizeField
        label="Raise"
        value={boxes.raise}
        placeholder="none"
        invalid={!sizeOk(boxes.raise)}
        disabled={disabled}
        onChange={(v) => set("raise", v)}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Check
          label="Add allin"
          checked={boxes.addAllin}
          disabled={disabled}
          onChange={(v) => set("addAllin", v)}
          title="Also offer a jam wherever this seat can bet or raise on this street."
        />
        {showNoThreeBet && seat === "ip" && (
          <Check
            label="No 3-bet"
            checked={boxes.noThreeBet}
            disabled={disabled}
            onChange={(v) => set("noThreeBet", v)}
            title="PioViewer's Don't 3-bet: IP never makes the third aggressive action of the street. It can open, and it can raise OOP's bet, but it cannot re-raise a raise."
          />
        )}
      </div>
    </div>
  );
};

export interface TreeBuildingProps {
  /* ---- controlled value ---- */
  value: TreeBuildingView;
  onChange: (next: TreeBuildingView) => void;
  /** Read-only while a solve or upload is in flight. */
  disabled?: boolean;

  /* ---- board ---- */
  /** 3 = flop-only (solver / hand history), 5 = flop through river (/compare). */
  boardMaxCards?: 3 | 5;
  /** "inline" - text field + Select/Rand + a small card strip.
   *  "slots"  - three big tappable card slots + Random + a text field. */
  boardVariant?: "inline" | "slots";
  /** "strict" surfaces a per-keystroke parse error; "loose" ignores garbage. */
  boardParse?: "loose" | "strict";

  /* ---- labels ---- */
  oopLabel?: string;
  ipLabel?: string;
  /** Suffix beside Pot and Effective stacks: "bb", "chips". Omitted on /compare,
   *  whose numbers are unitless by construction. */
  moneyLabel?: string;

  /* ---- feature flags ---- */
  showNoThreeBet?: boolean;
  showMaxRaises?: boolean;
  showPreflopAggressor?: boolean;
  /** Present => render the Copy / Paste row. Injected rather than imported so
   *  this component never depends on src/pages, where the PioViewer clipboard
   *  codec lives. */
  clipboard?: TreeClipboardCodec | null;
  /** Range <-> Pio token string, for the saved-range library. Injected for the
   *  same reason as `clipboard`. */
  rangeCodec: RangeTokenCodec;
  showClearAllSizes?: boolean;
  /** Mark the Bet box invalid when a street has neither a bet nor a donk. */
  requireLeadSizePerStreet?: boolean;
  /** Present => render Pio's two chip-limit warnings under pot/stacks. The
   *  scale is frozen by the caller and must never be re-derived here. */
  pioChipLimits?: { chipScale: number } | null;

  /* ---- page-owned content, rendered in flow ---- */
  headerSlot?: ReactNode;
  footerSlot?: ReactNode;
}

const TreeBuilding = ({
  value,
  onChange,
  disabled,
  boardMaxCards = 5,
  boardVariant = "inline",
  boardParse = "loose",
  oopLabel = "OOP",
  ipLabel = "IP",
  moneyLabel,
  showNoThreeBet = false,
  showMaxRaises = false,
  showPreflopAggressor = false,
  clipboard = null,
  rangeCodec,
  showClearAllSizes = false,
  requireLeadSizePerStreet = false,
  pioChipLimits = null,
  headerSlot,
  footerSlot,
}: TreeBuildingProps) => {
  const [editingRange, setEditingRange] = useState<TreeSeat | null>(null);
  const [pickerOpen, setPickerOpen] = useState(
    () => boardVariant === "slots" && parseBoardCards(value.board).length < boardMaxCards
  );
  const [copied, setCopied] = useState(false);
  /* Shown when the browser refuses clipboard reads (Firefox has no readText
   * for ordinary pages, and Chrome needs the tab focused). Without it Paste
   * is simply unusable there. */
  const [pasteBox, setPasteBox] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const set = <K extends keyof TreeBuildingView>(key: K, next: TreeBuildingView[K]) =>
    onChange({ ...value, [key]: next });

  const flash = (kind: "ok" | "error", text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  };

  const board = useMemo(() => parseBoardCards(value.board), [value.board]);
  const active = useMemo(() => activeStreetsFor(board.length), [board.length]);
  const usedCards = useMemo(() => new Set(board), [board]);
  const anyNoThreeBet =
    showNoThreeBet && TREE_STREETS.some((s) => value.ip[s].noThreeBet);

  const setSeatStreet = (seat: TreeSeat, street: TreeStreet, next: TreeStreetView) =>
    onChange({ ...value, [seat]: { ...value[seat], [street]: next } });

  const setBoardCards = (cards: string[]) => {
    setBoardError(null);
    set("board", cards.join(" "));
  };

  const onBoardText = (text: string) => {
    if (boardParse === "strict") {
      const { error } = parseBoardInputStrict(text, boardMaxCards);
      setBoardError(error);
    }
    set("board", text);
  };

  const onPickCard = (code: string) => {
    if (board.includes(code)) {
      setBoardCards(board.filter((c) => c !== code));
      return;
    }
    if (board.length >= boardMaxCards) return;
    setBoardCards([...board, code]);
  };

  const onRandomBoard = () => {
    // Keep the street: a random board that turned a river solve into a flop
    // solve would silently rebuild a much bigger tree.
    const count =
      boardMaxCards === 3 ? 3 : Math.min(5, Math.max(3, board.length || 5));
    setBoardCards(randomBoard(count));
  };

  const onCopy = async () => {
    const ok = await copyText(clipboard!.serialize(value));
    if (!ok) {
      flash("error", "The browser refused clipboard access.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const loadConfigText = (text: string) => {
    try {
      const parsed = clipboard!.parse(text);
      const next: TreeBuildingView = { ...value, oop: parsed.oop, ip: parsed.ip };
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
    onChange({ ...value, oop: emptySeatView(), ip: emptySeatView() });
    flash("ok", "Cleared every bet size. The board and ranges are untouched.");
  };

  const copyIpToOop = () => {
    const next: TreeSeatView = {
      flop: { ...value.ip.flop, donk: value.oop.flop.donk, noThreeBet: false },
      turn: { ...value.ip.turn, donk: value.oop.turn.donk, noThreeBet: false },
      river: { ...value.ip.river, donk: value.oop.river.donk, noThreeBet: false },
    };
    set("oop", next);
  };

  /** Thumbnail, not an editor - clicking opens the real 13x13 grid, so this
   *  only has to be big enough to recognise the shape of a range. */
  const rangeCard = (which: TreeSeat) => {
    const weights = which === "oop" ? value.oopRange : value.ipRange;
    const label = which === "oop" ? oopLabel : ipLabel;
    const pct = (weightedComboCount(weights) / 1326) * 100;
    return (
      <button
        type="button"
        onClick={() => setEditingRange(which)}
        disabled={disabled}
        className="group rounded-lg border border-slate-700/80 bg-slate-800/40 p-1.5 transition-colors hover:border-emerald-600/70 hover:bg-slate-800/80 disabled:opacity-50"
        title={`${label} starting range - click to edit`}
      >
        <div className="w-16">
          <RangeMiniGrid weights={weights} />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-1">
          <span className="max-w-[7rem] truncate text-[10px] font-semibold text-slate-300">
            {label}
          </span>
          <span className="text-[10px] tabular-nums text-emerald-400">{pct.toFixed(0)}%</span>
        </div>
      </button>
    );
  };

  const potChips = pioChipLimits ? Math.round(Number(value.pot) * pioChipLimits.chipScale) : 0;
  const effChips = pioChipLimits
    ? Math.round(Number(value.effectiveStacks) * pioChipLimits.chipScale)
    : 0;

  const seatBlock = (seat: TreeSeat, trailing?: ReactNode) => (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={labelCls}>{seat === "ip" ? "In position" : "Out of position"}</span>
        {trailing}
      </div>
      {/* items-start: the flop card has no donk box, and stretching it to its
          neighbours would leave a band of dead space. */}
      <div className="grid items-start gap-2 sm:grid-cols-3">
        {TREE_STREETS.map((street) => (
          <StreetCard
            key={`${seat}-${street}`}
            street={street}
            seat={seat}
            boxes={value[seat][street]}
            inTree={active.has(street)}
            showDonk={seat === "oop" && street !== "flop"}
            showNoThreeBet={showNoThreeBet}
            requireLead={requireLeadSizePerStreet}
            disabled={disabled}
            onChange={(next) => setSeatStreet(seat, street, next)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {headerSlot}

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
          <span className={labelCls}>{boardMaxCards === 3 ? "Flop" : "Board"}</span>

          {boardVariant === "slots" ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                {Array.from({ length: boardMaxCards }).map((_, idx) => {
                  const code = board[idx];
                  if (code) {
                    return (
                      <button
                        key={`slot-${idx}-${code}`}
                        type="button"
                        disabled={disabled}
                        onClick={() => setBoardCards(board.filter((_c, i) => i !== idx))}
                        className="rounded-xl focus:outline-none"
                        title={`Remove ${code}`}
                      >
                        <PlayingCard code={code} width="clamp(32px, 6vw, 48px)" />
                      </button>
                    );
                  }
                  const isNext = idx === board.length;
                  return (
                    <button
                      key={`slot-${idx}`}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPickerOpen(true)}
                      className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/10 ${
                        isNext ? "border-emerald-400 ring-2 ring-emerald-400/70" : "border-gray-500"
                      }`}
                      style={{ width: "clamp(32px, 6vw, 48px)" }}
                      title={isNext ? "Next card goes here" : "Empty slot"}
                    >
                      <span className={`text-sm ${isNext ? "text-emerald-300" : "text-gray-300"}`}>
                        +
                      </span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={onRandomBoard} className={buttonCls} disabled={disabled}>
                Random
              </button>
              <input
                type="text"
                value={value.board}
                onChange={(e) => onBoardText(e.target.value)}
                placeholder="Ah Kd 9c"
                aria-label="Board"
                disabled={disabled}
                className={`${inputCls} min-w-[7rem] flex-1`}
              />
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className={buttonCls}
                aria-expanded={pickerOpen}
              >
                {pickerOpen ? "Hide picker" : "Select"}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  value={value.board}
                  onChange={(e) => onBoardText(e.target.value)}
                  placeholder="9c 5d Jc 7s 9h"
                  aria-label="Board"
                  disabled={disabled}
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
                <button type="button" onClick={onRandomBoard} className={buttonCls}>
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
            </>
          )}

          {boardError && <p className="text-[10px] text-red-400">{boardError}</p>}
        </div>

        <div className="flex gap-2">
          <label className="flex w-24 flex-col gap-1">
            <span className={labelCls}>Pot{moneyLabel ? ` (${moneyLabel})` : ""}</span>
            <input
              type="text"
              inputMode="decimal"
              value={value.pot}
              disabled={disabled}
              onChange={(e) => set("pot", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
          </label>
          <label className="flex w-24 flex-col gap-1">
            <span className={labelCls}>Stacks{moneyLabel ? ` (${moneyLabel})` : ""}</span>
            <input
              type="text"
              inputMode="decimal"
              value={value.effectiveStacks}
              disabled={disabled}
              onChange={(e) => set("effectiveStacks", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
          </label>
        </div>
      </div>

      {/* Pio rounds each bet to a whole chip, so the error on a size is about
          half a chip. That only becomes visible in a small pot, and a deep hand
          routinely lands near 300 chips once the 65535 ceiling caps the scale -
          which is fine, so only speak up under ~1%. */}
      {pioChipLimits && potChips > 0 && potChips < 150 && (
        <p className="text-[11px] text-amber-300">
          This pot is only {potChips} solver chips, so a percentage bet size can land
          about {((1.5 / potChips) * 100).toFixed(1)}% off what you asked for.
        </p>
      )}
      {pioChipLimits && (potChips > 65535 || effChips > 65535) && (
        <p className="text-[11px] text-amber-300">
          PioSOLVER refuses a pot or stack above 65535 chips, and this tree is at{" "}
          {Math.max(potChips, effChips)}. Lower the effective stack, or the solve will
          come back empty.
        </p>
      )}

      {pickerOpen && (
        <div className="max-h-[160px] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
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

      {/* Sizing - IP first, matching PioViewer.
          Side by side from xl up, which puts all six street cards on one row
          and roughly halves the panel's height on a desktop workbench; the two
          stacked blocks of three come back below that for phones. */}
      <div className="grid gap-2 xl:grid-cols-2">
        {seatBlock(
          "ip",
          <button type="button" onClick={copyIpToOop} className={buttonCls} disabled={disabled}>
            Copy IP → OOP
          </button>
        )}
        {seatBlock(
          "oop",
          showClearAllSizes ? (
            <button type="button" onClick={clearAll} className={buttonCls} disabled={disabled}>
              Clear all sizes
            </button>
          ) : undefined
        )}
      </div>

      {/* Thresholds, and the clipboard controls on the same line when there is
          room for them - together they were two full-width rows for six short
          fields. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="flex w-32 flex-col gap-1">
          <span
            className={labelCls}
            title="A bet computed at or above this share of the effective stack becomes a jam instead."
          >
            All-in threshold
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={value.allinThresholdPct}
              disabled={disabled}
              onChange={(e) => set("allinThresholdPct", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
            <span className="shrink-0 text-[10px] text-slate-500">% stack</span>
          </div>
        </label>
        <label className="flex w-32 flex-col gap-1">
          <span
            className={labelCls}
            title="Carried in the copied config for PioViewer, which applies it per node."
          >
            Add all-in only if &lt;
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={value.addAllinCapPct}
              disabled={disabled}
              onChange={(e) => set("addAllinCapPct", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
            <span className="shrink-0 text-[10px] text-slate-500">% pot</span>
          </div>
        </label>
        {showMaxRaises && (
          <label className="flex w-24 flex-col gap-1">
            <span
              className={labelCls}
              title="Bets plus raises allowed on one street, counted across both seats."
            >
              Max raises
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={value.maxRaises}
              disabled={disabled}
              onChange={(e) => set("maxRaises", e.target.value)}
              className={`${inputCls} tabular-nums`}
            />
          </label>
        )}
        {showPreflopAggressor && (
          <label className="flex w-32 flex-col gap-1">
            <span
              className={labelCls}
              title="Aggressor on the street before the root; gates whether OOP's first-in uses donk sizes."
            >
              Aggressor before root
            </span>
            <select
              value={value.preflopAggressor}
              disabled={disabled}
              onChange={(e) =>
                set("preflopAggressor", e.target.value as TreeBuildingView["preflopAggressor"])
              }
              className={inputCls}
            >
              <option value="none">none</option>
              <option value="ip">IP</option>
              <option value="oop">OOP</option>
            </select>
          </label>
        )}

        {/* Clipboard interop, sharing the thresholds' row. */}
        {clipboard && (
          <div className="flex flex-wrap items-center gap-2 border-l border-slate-800 pl-3">
            <button type="button" onClick={onCopy} className={buttonCls} disabled={disabled}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={onPaste} className={buttonCls} disabled={disabled}>
              Paste
            </button>
            <Check
              label="Betting structure only"
              checked={value.betStructureOnly}
              disabled={disabled}
              onChange={(v) => set("betStructureOnly", v)}
              title="With this on, Paste replaces the six sizing cards and leaves ranges, board, pot and stacks as they are."
            />
            <span
              className="text-[10px] text-slate-600"
              title="Copy and Paste speak PioViewer's own tree-config clipboard format, so a spot moves between the two without retyping."
            >
              PioViewer format
            </span>
          </div>
        )}
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
          "No 3-bet" is applied by htsolver but is not part of PioViewer's config text -
          re-tick it by hand after pasting there.
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

      {footerSlot}

      {/* Range editor - a second layer over whatever modal hosts this panel. */}
      {editingRange && (
        <ResponsiveDrawer
          open
          onClose={() => setEditingRange(null)}
          scrollMode="custom"
          desktopMaxWidthClassName="sm:max-w-3xl"
          zClassName="z-[90]"
          ariaLabel="Edit starting range"
        >
          <div className="flex h-full flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Starting range - {editingRange === "oop" ? oopLabel : ipLabel}
              </h3>
              <button
                type="button"
                onClick={() => setEditingRange(null)}
                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <RangeSelector
                weights={editingRange === "oop" ? value.oopRange : value.ipRange}
                onChange={(next) => set(editingRange === "oop" ? "oopRange" : "ipRange", next)}
                codec={rangeCodec}
                disabled={disabled}
              />
            </div>
          </div>
        </ResponsiveDrawer>
      )}
    </div>
  );
};

export default TreeBuilding;
