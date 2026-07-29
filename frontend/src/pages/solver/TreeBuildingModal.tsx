// TreeBuildingModal.tsx
//
// The tree-building panel (styled after PioSOLVER's "Tree building parameters"
// screen) shown before a game tree is uploaded for solving. Shared by two
// entry points:
//   - Solver: opens when a heads-up preflop call closes the action, prefilled
//     from the preflop sim (ranges from plates, pot/stacks from the line).
//   - Hand history: opens when a recorded hand that saw a heads-up flop
//     completes, prefilled from the recorded hand (pot, stacks, flop, bet
//     sizes derived from the actual bets, ranges from canned charts).
// Unlike the old FlopPickerModal it owns all of its draft state; parents pass
// a TreeBuildingInit and receive the edited params + flop on confirm.
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import CardPicker from "@/components/CardPicker";
import PlayingCard from "@/components/PlayingCard";
import RangeEditorGrid, { RangeMiniGrid, weightedComboCount } from "@/components/RangeEditorGrid";
import { boardToCards } from "@/lib/solver/postflopNode";
import type { PostflopIndexEntry } from "@/lib/solver/postflopLibrary";
import {
  cloneTreeSizes,
  type StreetSizes,
  type TreeParams,
  type TreeSizes,
} from "@/lib/solver/treeConfig";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = ["h", "d", "c", "s"] as const;
const ALL_CARDS: string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

/** Parse a typed flop like "AhKd9c" / "Ah Kd 9c" into card codes. */
export function parseFlopInputString(raw: string): { cards: string[]; error: string | null } {
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, "").trim();
  if (!stripped) return { cards: [], error: null };

  const upper = stripped.toUpperCase();

  if (upper.length > 6) {
    return { cards: [], error: 'Please enter at most 3 cards, e.g. "AhKd9c" or "Ah Kd 9c".' };
  }
  if (upper.length % 2 !== 0) {
    return { cards: [], error: 'Finish the card you\'re typing, e.g. "9c".' };
  }

  const parsed: string[] = [];
  for (let i = 0; i < upper.length; i += 2) {
    const rank = upper[i];
    const suitChar = upper[i + 1];
    if (!RANKS.includes(rank as (typeof RANKS)[number])) {
      return { cards: [], error: `Unknown rank "${rank}". Use A,K,Q,J,T,9..2.` };
    }
    const suitLower = suitChar.toLowerCase();
    if (!SUITS.includes(suitLower as (typeof SUITS)[number])) {
      return { cards: [], error: `Unknown suit "${suitChar}". Use h,d,c,s.` };
    }
    const code = `${rank}${suitLower}`;
    if (parsed.includes(code)) {
      return { cards: [], error: "Cards must be unique." };
    }
    parsed.push(code);
  }
  return { cards: parsed, error: null };
}

/** Pio size syntax: percent numbers and/or "a" (all-in), space-separated. */
const SIZE_RE = /^(a|\d+(\.\d+)?)( (a|\d+(\.\d+)?))*$/;
const sizeOk = (v: string | undefined) => !v || SIZE_RE.test(v.trim());

export interface TreeBuildingInit {
  params: TreeParams;
  flopCards: string[];
  oopLabel: string;
  ipLabel: string;
  /** Unit shown beside the pot and stacks. Sims are in big blinds; a recorded
   *  hand is in its own chips. */
  moneyLabel?: string;
}

interface TreeBuildingModalProps {
  init: TreeBuildingInit;
  /** Boards already solved for this line - offered as instant opens. */
  solvedForLine: PostflopIndexEntry[];
  busy: boolean;
  /** Success message shown after the upload lands (parent closes shortly after). */
  notice?: string | null;
  error?: string | null;
  onConfirm: (result: { params: TreeParams; flopCards: string[] }) => void;
  onClose: () => void;
  onOpenSolvedBoard?: (entry: PostflopIndexEntry) => void;
}

/** One street's size inputs for one seat. */
const StreetFields = ({
  title,
  sizes,
  showDonk,
  disabled,
  onChange,
}: {
  title: string;
  sizes: StreetSizes;
  showDonk: boolean;
  disabled: boolean;
  onChange: (next: StreetSizes) => void;
}) => {
  const field = (
    label: string,
    key: "betSize" | "raiseSize" | "donkBetSize"
  ) => {
    const value = sizes[key] ?? "";
    const invalid = !sizeOk(value);
    return (
      <label className="flex items-center gap-1.5 text-[11px] text-gray-300">
        <span className="w-14 shrink-0">{label}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...sizes, [key]: e.target.value || undefined })
          }
          className={`w-full min-w-0 rounded-md bg-slate-800 border px-1.5 py-0.5 text-[11px] text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/80
            ${invalid ? "border-red-500/70" : "border-slate-600"}`}
        />
        <span className="text-gray-500">%</span>
      </label>
    );
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold text-gray-200">{title}</div>
      {field("Bet", "betSize")}
      {showDonk && field("Donk", "donkBetSize")}
      {field("Raise", "raiseSize")}
      <label className="flex items-center gap-1.5 text-[11px] text-gray-300">
        <input
          type="checkbox"
          checked={sizes.addAllin}
          disabled={disabled}
          onChange={(e) => onChange({ ...sizes, addAllin: e.target.checked })}
          className="h-3 w-3 accent-emerald-500"
        />
        Add all-in
      </label>
    </div>
  );
};

const TreeBuildingModal = ({
  init,
  solvedForLine,
  busy,
  notice,
  error,
  onConfirm,
  onClose,
  onOpenSolvedBoard,
}: TreeBuildingModalProps) => {
  // ---- draft state (initialized once per mount; parents mount fresh) ----
  const [rangeOOP, setRangeOOP] = useState<Record<string, number>>(init.params.rangeOOP);
  const [rangeIP, setRangeIP] = useState<Record<string, number>>(init.params.rangeIP);
  const [editingRange, setEditingRange] = useState<"oop" | "ip" | null>(null);

  const [flopCards, setFlopCards] = useState<string[]>(init.flopCards);
  const [flopInput, setFlopInput] = useState<string>(init.flopCards.join(" "));
  const [flopInputError, setFlopInputError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<boolean>(init.flopCards.length < 3);

  /* Pio needs whole chips, so the amounts were scaled on the way in. The
   * scale is frozen: the seat stacks and the ICM literal were scaled with it
   * and are not editable here, so re-deriving it would desync them. */
  const scale = init.params.chipScale || 100;
  const moneyLabel = init.moneyLabel ?? "bb";
  const [potMoney, setPotMoney] = useState<string>(String(init.params.potChips / scale));
  const [effMoney, setEffMoney] = useState<string>(
    String(init.params.effectiveStackChips / scale)
  );
  const [allinThreshold, setAllinThreshold] = useState<string>(String(init.params.allinThreshold));
  const [addAllinCap, setAddAllinCap] = useState<string>(
    String(init.params.addAllinOnlyIfLessThanThisTimesThePot)
  );
  const [oopSizes, setOopSizes] = useState<TreeSizes>(cloneTreeSizes(init.params.oop));
  const [ipSizes, setIpSizes] = useState<TreeSizes>(cloneTreeSizes(init.params.ip));

  const setCards = (cards: string[]) => {
    setFlopCards(cards);
    setFlopInput(cards.join(" "));
    setFlopInputError(null);
  };

  const onPickCard = (code: string) => {
    if (flopCards.includes(code)) return setCards(flopCards.filter((c) => c !== code));
    if (flopCards.length >= 3) return;
    setCards([...flopCards, code]);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFlopInput(value);
    const { cards, error: parseError } = parseFlopInputString(value);
    setFlopInputError(parseError);
    if (!parseError) setFlopCards(cards);
  };

  const randomizeFlop = () => {
    const deck = [...ALL_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    setCards(deck.slice(0, 3));
  };

  const usedCards = useMemo(() => new Set(flopCards), [flopCards]);

  const potChips = Math.round(Number(potMoney) * scale);
  const effChips = Math.round(Number(effMoney) * scale);

  const sizesOk = (s: TreeSizes) =>
    [s.flop, s.turn, s.river].every(
      (st) => sizeOk(st.betSize) && sizeOk(st.raiseSize) && sizeOk(st.donkBetSize)
    );

  const canConfirm =
    !busy &&
    !notice &&
    flopCards.length === 3 &&
    Object.keys(rangeOOP).length > 0 &&
    Object.keys(rangeIP).length > 0 &&
    Number.isFinite(potChips) &&
    potChips > 0 &&
    Number.isFinite(effChips) &&
    effChips > 0 &&
    sizesOk(oopSizes) &&
    sizesOk(ipSizes);

  const confirm = () => {
    if (!canConfirm) return;
    const params: TreeParams = {
      ...init.params,
      rangeOOP,
      rangeIP,
      potChips,
      effectiveStackChips: effChips,
      allinThreshold: Number(allinThreshold) || init.params.allinThreshold,
      addAllinOnlyIfLessThanThisTimesThePot:
        Number(addAllinCap) || init.params.addAllinOnlyIfLessThanThisTimesThePot,
      oop: oopSizes,
      ip: ipSizes,
    };
    onConfirm({ params, flopCards });
  };

  const rangeButton = (which: "oop" | "ip") => {
    const weights = which === "oop" ? rangeOOP : rangeIP;
    const label = which === "oop" ? init.oopLabel : init.ipLabel;
    const pct = (weightedComboCount(weights) / 1326) * 100;
    return (
      <button
        type="button"
        onClick={() => setEditingRange(which)}
        className="flex-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-2 text-left transition-colors"
        title="Click to edit this starting range"
      >
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-semibold text-gray-200">{label}</span>
          <span className="text-[10px] tabular-nums text-emerald-300">{pct.toFixed(1)}%</span>
        </div>
        <RangeMiniGrid weights={weights} />
      </button>
    );
  };

  const numField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    suffix?: string
  ) => (
    <label className="flex items-center gap-2 text-xs text-gray-300">
      <span className="w-32 shrink-0">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 rounded-md bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/80"
      />
      {suffix && <span className="text-gray-500 text-[11px]">{suffix}</span>}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3"
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl text-gray-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white border border-white/10 shadow-sm"
          aria-label="Close"
        >
          ×
        </button>

        <div className="px-4 pt-4">
          <h2 className="text-base font-semibold">Tree building parameters</h2>
          <p className="text-xs text-gray-400 mb-2">
            Review the game tree before it's sent off to be solved. Every field is editable.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2 flex flex-col gap-3">
          {/* Already solved shortcuts */}
          {solvedForLine.length > 0 && onOpenSolvedBoard && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
              <div className="mb-1 text-[11px] font-semibold text-emerald-200">
                Already solved for this line - open instantly:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {solvedForLine.map((entry) => (
                  <button
                    key={`${entry.node_name}-${entry.board}`}
                    type="button"
                    onClick={() => onOpenSolvedBoard(entry)}
                    className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 hover:bg-emerald-500/20 px-1.5 py-1 transition-colors"
                    title={`Open ${entry.board}`}
                  >
                    {boardToCards(entry.board).map((code) => (
                      <PlayingCard key={code} code={code} width="clamp(22px, 4vw, 30px)" />
                    ))}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Starting ranges */}
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-400">
              Starting ranges (click to edit)
            </div>
            <div className="flex gap-2">
              {rangeButton("oop")}
              {rangeButton("ip")}
            </div>
          </div>

          {/* Board */}
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-400">Flop</div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {Array.from({ length: 3 }).map((_, idx) => {
                  const code = flopCards[idx];
                  if (code) {
                    return (
                      <button
                        key={`flop-${idx}-${code}`}
                        type="button"
                        onClick={() => setCards(flopCards.filter((_c, i) => i !== idx))}
                        className="rounded-xl focus:outline-none"
                        title={`Remove ${code}`}
                      >
                        <PlayingCard code={code} width="clamp(36px, 7vw, 56px)" />
                      </button>
                    );
                  }
                  const isNext = idx === flopCards.length;
                  return (
                    <button
                      key={`flop-slot-${idx}`}
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/10
                        ${isNext ? "border-emerald-400 ring-2 ring-emerald-400/70 animate-pulse" : "border-gray-500"}`}
                      style={{ width: "clamp(36px, 7vw, 56px)" }}
                      title={isNext ? "Next flop card will go here" : "Empty flop slot"}
                    >
                      <span className={`text-sm ${isNext ? "text-emerald-300" : "text-gray-300"}`}>+</span>
                      {isNext && (
                        <span className="absolute -top-1 -right-1 text-[9px] bg-emerald-600 text-white rounded px-1 shadow">
                          NEXT
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={randomizeFlop}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 shadow"
                title="Generate a random flop"
              >
                <span>Random</span>
                <span aria-hidden="true">🎲</span>
              </button>

              <div className="flex-1 min-w-[90px]">
                <input
                  type="text"
                  value={flopInput}
                  onChange={onInputChange}
                  placeholder="Ah Kd 9c"
                  className="w-full rounded-md bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/80"
                />
              </div>
            </div>
            {flopInputError && (
              <p className="mt-1 text-[10px] text-red-400">{flopInputError}</p>
            )}
            {pickerOpen ? (
              <div className="mt-2 max-h-[240px] overflow-y-auto">
                <CardPicker
                  used={usedCards}
                  onPick={onPickCard}
                  size="sm"
                  fitToWidth
                  cardWidth="100%"
                  gapPx={4}
                  className="w-full inline-grid mx-auto rounded-xl border border-gray-300 bg-slate-700/80 p-2"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="mt-1 text-[11px] text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
              >
                Show card picker
              </button>
            )}
          </div>

          {/* Pot / stacks */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {numField("Starting pot", potMoney, setPotMoney, moneyLabel)}
            {numField("Effective stacks", effMoney, setEffMoney, moneyLabel)}
          </div>
          {potChips > 0 && potChips < 500 && (
            <p className="text-[11px] text-amber-300">
              This pot is only {potChips} solver chips, so percentage bet sizes
              round coarsely - a 33% bet could land a few percent off.
            </p>
          )}
          {(potChips > 65535 || effChips > 65535) && (
            <p className="text-[11px] text-amber-300">
              PioSOLVER refuses a pot or stack above 65535 chips, and this tree is
              at {Math.max(potChips, effChips)}. Lower the effective stack, or the
              solve will come back empty.
            </p>
          )}

          {/* IP sizes */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-400">
                Bet sizing - {init.ipLabel}
              </span>
              <button
                type="button"
                onClick={() => {
                  // Copy IP -> OOP but keep OOP-only donk fields.
                  setOopSizes((prev) => ({
                    flop: { ...ipSizes.flop, donkBetSize: prev.flop.donkBetSize },
                    turn: { ...ipSizes.turn, donkBetSize: prev.turn.donkBetSize },
                    river: { ...ipSizes.river, donkBetSize: prev.river.donkBetSize },
                  }));
                }}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium bg-slate-800 border border-white/10 text-gray-300 hover:bg-slate-700"
              >
                Copy IP → OOP
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StreetFields title="Flop IP" sizes={ipSizes.flop} showDonk={false} disabled={busy}
                onChange={(s) => setIpSizes((p) => ({ ...p, flop: s }))} />
              <StreetFields title="Turn IP" sizes={ipSizes.turn} showDonk={false} disabled={busy}
                onChange={(s) => setIpSizes((p) => ({ ...p, turn: s }))} />
              <StreetFields title="River IP" sizes={ipSizes.river} showDonk={false} disabled={busy}
                onChange={(s) => setIpSizes((p) => ({ ...p, river: s }))} />
            </div>
          </div>

          {/* OOP sizes */}
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-400">
              Bet sizing - {init.oopLabel}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StreetFields title="Flop OOP" sizes={oopSizes.flop} showDonk={false} disabled={busy}
                onChange={(s) => setOopSizes((p) => ({ ...p, flop: s }))} />
              <StreetFields title="Turn OOP" sizes={oopSizes.turn} showDonk disabled={busy}
                onChange={(s) => setOopSizes((p) => ({ ...p, turn: s }))} />
              <StreetFields title="River OOP" sizes={oopSizes.river} showDonk disabled={busy}
                onChange={(s) => setOopSizes((p) => ({ ...p, river: s }))} />
            </div>
          </div>

          {/* Thresholds */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {numField("All-in threshold", allinThreshold, setAllinThreshold, "% of eff. stack")}
            {numField("Add all-in only if <", addAllinCap, setAddAllinCap, "% of pot")}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-3">
          {notice && (
            <div className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}
          {error && (
            <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow
                ${
                  canConfirm
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-emerald-600/50 text-white/70 cursor-not-allowed"
                }`}
            >
              <span>{busy ? "Uploading…" : "Upload & solve"}</span>
              {!busy && <span aria-hidden="true">✓</span>}
            </button>
          </div>
        </div>

        {/* Range editor sheet */}
        {editingRange && (
          <div
            className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-slate-900/98 p-4 animate-[treeSheetIn_160ms_ease-out]"
            style={{ backdropFilter: "blur(2px)" }}
          >
            <style>{`@keyframes treeSheetIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }`}</style>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Edit range - {editingRange === "oop" ? init.oopLabel : init.ipLabel}
              </h3>
              <button
                type="button"
                onClick={() => setEditingRange(null)}
                className="rounded-lg px-3 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow"
              >
                Done
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <RangeEditorGrid
                weights={editingRange === "oop" ? rangeOOP : rangeIP}
                onChange={editingRange === "oop" ? setRangeOOP : setRangeIP}
                disabled={busy}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TreeBuildingModal;
