// src/pages/equity/EquityCalc.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { buildDeck, sampleN, tokenize, sortCardsDesc } from "@/lib/cards";
import { useEquitySimulation } from "@/hooks/useEquitySimulation";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import PlayingCard from "@/components/PlayingCard";
import { NextSlotHighlight } from "@/components/PokerTable";
import ploOpenRangeCSV from "@/data/ploOpenRangeCSV.txt?raw";
import ploCallRangeCSV from "@/data/ploCallRangeCSV.txt?raw";
import { SlidingNumber } from "@/components/ui/shadcn-io/sliding-number";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";

/* ===== Shared helpers & constants ===== */

type PloRangeEntry = {
  cards: string[];
  weight: number;
};

type PloRangeCache = {
  entries: PloRangeEntry[] | null;
  cum: number[] | null;
  total: number;
};

type Mode = "NLH" | "PLO4" | "PLO5";
const MODE_KEY = "ht_equity_mode_v1";

function parseModeOrDefault(raw: string): Mode {
  const v: unknown = JSON.parse(raw);
  if (v === "NLH" || v === "PLO4" || v === "PLO5") return v;
  return "NLH";
}

const splitPloHand = (hand: string): string[] => hand.match(/../g) ?? [];

const openRangeCache: PloRangeCache = { entries: null, cum: null, total: 0 };
const callRangeCache: PloRangeCache = { entries: null, cum: null, total: 0 };

const initPloRange = (raw: string, cache: PloRangeCache) => {
  if (cache.entries) return;

  const entries: PloRangeEntry[] = [];
  const cum: number[] = [];
  let total = 0;

  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const [handStr, probStr] = line.split(",");
      if (!handStr) return;

      const cards = splitPloHand(handStr);
      if (cards.length !== 4) return;

      const weight = parseFloat(probStr ?? "1");
      if (!isFinite(weight) || weight <= 0) return;

      total += weight;
      entries.push({ cards, weight });
      cum.push(total);
    });

  cache.entries = entries;
  cache.cum = cum;
  cache.total = total;
};

const pickRandomFromRange = (
  raw: string,
  cache: PloRangeCache,
  used: Set<string>
): string[] | null => {
  initPloRange(raw, cache);

  const entries = cache.entries;
  const cum = cache.cum;
  const total = cache.total;
  if (!entries || !cum || total <= 0) return null;

  const maxTries = 40;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const r = Math.random() * total;

    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (r < cum[mid]) hi = mid;
      else lo = mid + 1;
    }

    const entry = entries[lo];
    if (!entry) continue;
    if (entry.cards.some((c) => used.has(c))) continue;

    return entry.cards;
  }

  return null;
};

const calcStats = (res: any, handCount: number) => {
  if (!res || res.total <= 0 || res.wins.length !== handCount)
    return {
      winPcts: Array<number>(handCount).fill(0),
      tiePct: 0,
      evPcts: Array<number>(handCount).fill(0),
      ready: false,
    };
  const n = res.total;
  const tieShare = res.ties / handCount;
  return {
    winPcts: res.wins.map((w: number) => (w / n) * 100),
    tiePct: (res.ties / n) * 100,
    evPcts: res.wins.map((w: number) => ((w + tieShare) / n) * 100),
    ready: true,
  };
};

const encodeBoard = (cards: string[]) => {
  const n = Math.min(3, cards.length);
  const first = sortCardsDesc(cards.slice(0, n));
  const rest = cards.slice(n);
  return [...first, ...rest];
};

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    className={className ?? "h-5 w-5"}
  >
    <path d="M7.5 3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1h3a.75.75 0 1 1 0 1.5h-.69l-.77 10.01A2.5 2.5 0 0 1 11.55 17h-3.1a2.5 2.5 0 0 1-2.99-2.49L4.69 4.5H4a.75.75 0 0 1 0-1.5h3.5Zm-1.7 1.5.74 9.6a1 1 0 0 0 .99.9h3.14a1 1 0 0 0 .99-.9l.74-9.6H5.8Z" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className ?? "w-5 h-5"}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

/* ===== Panels (replace the oval poker table) — glass surfaces from the
   design-kit technique, wired to the app's emerald / slate / blue theme. ===== */

const panelBase =
  "group relative flex flex-col gap-2 rounded-lg border p-2.5 backdrop-blur-md transition-all cursor-pointer";
const panelClass = (selected: boolean) =>
  selected
    ? `${panelBase} border-accent bg-surface/80 shadow-glow ring-1 ring-accent`
    : `${panelBase} border-hairline bg-surface/60 hover:border-accent/40 hover:shadow-glow`;

const iconBtn =
  "p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-white/10 transition-colors";

/** Face-up cards + dashed empty slots, with the pulsing "NEXT" ring on the
 *  first empty slot when this panel is the active fill target. */
const CardSlots: React.FC<{
  cards: string[];
  max: number;
  cardW: number;
  isNext: boolean;
  onRemoveCard: (code: string) => void;
}> = ({ cards, max, cardW, isNext, onRemoveCard }) => (
  <div className="flex flex-wrap gap-1">
    {cards.map((c) => (
      <button
        key={c}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemoveCard(c);
        }}
        className="transition-transform hover:-translate-y-0.5"
      >
        <PlayingCard code={c} width={cardW} />
      </button>
    ))}
    {Array.from({ length: Math.max(0, max - cards.length) }).map((_, i) => (
      <div key={`slot-${i}`} className="relative" style={{ width: cardW }}>
        <div className="aspect-[3/4] rounded-[4px] border border-dashed border-white/25 bg-black/20" />
        {isNext && i === 0 && <NextSlotHighlight />}
      </div>
    ))}
  </div>
);

/* ===== PlayerPanel: one hand's cards, equity readout, and controls ===== */
const PlayerPanel: React.FC<{
  idx: number;
  tokens: string[];
  cap: number;
  value: string;
  selected: boolean;
  isNext: boolean;
  ev?: number;
  win1?: number;
  win2?: number;
  dual: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onChange: (v: string) => void;
  onRemoveCard: (code: string) => void;
  onRandomize: () => void;
  onClear: () => void;
  onRemoveSeat: () => void;
}> = React.memo((p) => {
  const holeW = p.cap >= 4 ? 34 : 44;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div onClick={p.onSelect} className={panelClass(p.selected)}>
      <span className="absolute left-0 top-0 h-0.5 w-0 bg-accent transition-all duration-300 group-hover:w-full" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
          Seat {p.idx + 1}
        </span>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={stop(p.onRandomize)} className={iconBtn} title="Randomize">
            <RefreshIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={stop(p.onClear)} className={iconBtn} title="Clear">
            <TrashIcon className="h-4 w-4" />
          </button>
          {p.canRemove && (
            <button
              type="button"
              onClick={stop(p.onRemoveSeat)}
              className="rounded p-1 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-red-400"
              title="Remove seat"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <CardSlots cards={p.tokens} max={p.cap} cardW={holeW} isNext={p.isNext} onRemoveCard={p.onRemoveCard} />

      <div className="flex items-baseline gap-2">
        <span className="inline-flex items-baseline text-2xl font-extrabold tabular-nums text-emerald-300">
          {p.ev === undefined ? (
            <span className="text-white/30">–</span>
          ) : (
            <>
              <SlidingNumber number={p.ev} decimalPlaces={1} inView />
              <span className="ml-0.5 text-sm">%</span>
            </>
          )}
        </span>
        {p.dual ? (
          <span className="text-[11px] text-sky-300">
            B1 {p.win1 === undefined ? "–" : p.win1.toFixed(1)} · B2{" "}
            {p.win2 === undefined ? "–" : p.win2.toFixed(1)}
          </span>
        ) : (
          p.win1 !== undefined && (
            <span className="text-[11px] text-sky-300">Win {p.win1.toFixed(1)}%</span>
          )
        )}
      </div>

      <input
        value={p.value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder="e.g. As Kd"
        className="w-full min-w-0 rounded border border-hairline bg-black/30 px-2 py-1 text-xs font-medium text-slate-100 placeholder-slate-500 outline-none focus:border-accent/60"
      />
    </div>
  );
});

/* ===== BoardPanel: community cards for one board ===== */
const BoardPanel: React.FC<{
  idx: number;
  cards: string[];
  value: string;
  selected: boolean;
  isNext: boolean;
  dual: boolean;
  onSelect: () => void;
  onChange: (v: string) => void;
  onRemoveCard: (code: string) => void;
  onRandomize: () => void;
  onClear: () => void;
}> = React.memo((p) => {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div onClick={p.onSelect} className={panelClass(p.selected)}>
      <span className="absolute left-0 top-0 h-0.5 w-0 bg-accent-2 transition-all duration-300 group-hover:w-full" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
          {p.dual ? `Board ${p.idx + 1}` : "Board"}
        </span>
        <div className="flex items-center gap-0.5">
          <span className="mr-1 text-[10px] font-semibold tabular-nums text-white/40">
            {p.cards.length}/5
          </span>
          <button type="button" onClick={stop(p.onRandomize)} className={iconBtn} title="Randomize">
            <RefreshIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={stop(p.onClear)} className={iconBtn} title="Clear">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CardSlots cards={p.cards} max={5} cardW={48} isNext={p.isNext} onRemoveCard={p.onRemoveCard} />

      <input
        value={p.value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder="e.g. Ah 7d 2c"
        className="w-full min-w-0 rounded border border-hairline bg-black/30 px-2 py-1 text-xs font-medium text-slate-100 placeholder-slate-500 outline-none focus:border-accent/60"
      />
    </div>
  );
});

type Selection = { type: "hand" | "board"; idx: number };

const EquityCalc: React.FC = () => {
  const [mode, setMode] = useLocalStorageState<Mode>(
    MODE_KEY,
    "NLH",
    parseModeOrDefault
  );
  const [board1, setBoard1] = useState("");
  const [board2, setBoard2] = useState("");
  const [hands, setHands] = useState<string[]>(["", ""]);
  const [boardsCount, setBoardsCount] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<Selection | null>(null);

  const sim1 = useEquitySimulation();
  const sim2 = useEquitySimulation();
  const computing = sim1.computing || (boardsCount === 2 && sim2.computing);
  const cap: 2 | 4 | 5 = mode === "NLH" ? 2 : mode === "PLO4" ? 4 : 5;
  const lastComputedKeyRef = useRef<string | null>(null);

  const [displayWinPcts1, setDisplayWinPcts1] = useState<number[]>([]);
  const [displayWinPcts2, setDisplayWinPcts2] = useState<number[]>([]);
  const [displayTotalEVs, setDisplayTotalEVs] = useState<number[]>([]);

  const resetDisplayed = useCallback(() => {
    setDisplayWinPcts1([]);
    setDisplayWinPcts2([]);
    setDisplayTotalEVs([]);
  }, []);

  /* --- Helpers --- */
  const usedSetFrom = useCallback(
    (skipBoardIdx: number | null, skipHandIdx: number | null) => {
      const used = new Set<string>();
      if (skipBoardIdx !== 0) tokenize(board1).forEach((c) => used.add(c));
      if (skipBoardIdx !== 1) tokenize(board2).forEach((c) => used.add(c));
      hands.forEach((h, idx) => {
        if (idx !== skipHandIdx) tokenize(h).forEach((c) => used.add(c));
      });
      return used;
    },
    [board1, board2, hands]
  );

  const pickRandomPloOpenHand = useCallback(
    (used: Set<string>): string[] | null =>
      pickRandomFromRange(ploOpenRangeCSV, openRangeCache, used),
    []
  );

  const pickRandomPloCallHand = useCallback(
    (used: Set<string>): string[] | null =>
      pickRandomFromRange(ploCallRangeCSV, callRangeCache, used),
    []
  );

  const randomizeBoard = useCallback(
    (idx: 0 | 1) => {
      const deck = buildDeck();
      const used = usedSetFrom(idx, null);
      const avail = deck.filter((c) => !used.has(c));
      const current = idx === 0 ? board1 : board2;
      const len = tokenize(current).length;
      const want = len === 4 ? 4 : len === 5 ? 5 : 3;
      const sample = sampleN(avail, want);
      const encoded = encodeBoard(sample).join(" ");
      if (idx === 0) setBoard1(encoded);
      else setBoard2(encoded);
    },
    [board1, board2, usedSetFrom]
  );

  const randomizeHand = useCallback(
    (seatIdx: number) => {
      const used = usedSetFrom(null, seatIdx);

      if (mode === "PLO4") {
        const cardsFromRange =
          seatIdx === 0 ? pickRandomPloOpenHand(used) : pickRandomPloCallHand(used);

        if (cardsFromRange && cardsFromRange.length === cap) {
          const sample = sortCardsDesc(cardsFromRange);
          setHands((p) => {
            const n = [...p];
            n[seatIdx] = sample.join(" ");
            return n;
          });
          return;
        }
      }

      const deck = buildDeck();
      const avail = deck.filter((c) => !used.has(c));
      const sample = sortCardsDesc(sampleN(avail, cap));
      setHands((p) => {
        const n = [...p];
        n[seatIdx] = sample.join(" ");
        return n;
      });
    },
    [usedSetFrom, cap, mode, pickRandomPloOpenHand, pickRandomPloCallHand]
  );

  /* --- Logic --- */
  const removeCode = (codes: string, code: string) =>
    sortCardsDesc(tokenize(codes).filter((c) => c !== code)).join(" ");

  const nextAddTarget = (
    boards: 1 | 2,
    capSize: number,
    handTokens: string[][],
    b1Len: number,
    b2Len: number
  ) => {
    for (let i = 0; i < handTokens.length; i++)
      if (handTokens[i].length < capSize) return { type: "hand", idx: i };
    if (b1Len < 3) return { type: "board", idx: 0 };
    if (boards === 2 && b2Len < 3) return { type: "board", idx: 1 };
    if (b1Len < 4) return { type: "board", idx: 0 };
    if (boards === 2 && b2Len < 4) return { type: "board", idx: 1 };
    if (b1Len < 5) return { type: "board", idx: 0 };
    if (boards === 2 && b2Len < 5) return { type: "board", idx: 1 };
    return null;
  };

  const handTokens = useMemo(
    () => hands.map((h) => sortCardsDesc(tokenize(h))),
    [hands]
  );
  const b1Cards = useMemo(() => tokenize(board1), [board1]);
  const b2Cards = useMemo(() => tokenize(board2), [board2]);

  /** The manually selected slot wins while it still has space; otherwise fall
   *  back to the automatic fill order. */
  const effectiveTarget = useMemo(() => {
    if (selected) {
      if (
        selected.type === "hand" &&
        (handTokens[selected.idx]?.length ?? cap) < cap
      )
        return selected;
      if (selected.type === "board") {
        const len = selected.idx === 0 ? b1Cards.length : b2Cards.length;
        if (len < 5 && (selected.idx === 0 || boardsCount === 2))
          return selected;
      }
    }
    return nextAddTarget(
      boardsCount,
      cap,
      handTokens,
      b1Cards.length,
      b2Cards.length
    );
  }, [selected, boardsCount, cap, handTokens, b1Cards.length, b2Cards.length]);

  /** All cards currently placed anywhere (for greying out keypad combos). */
  const usedSet = useMemo(() => {
    const s = new Set<string>();
    b1Cards.forEach((c) => s.add(c));
    b2Cards.forEach((c) => s.add(c));
    handTokens.forEach((t) => t.forEach((c) => s.add(c)));
    return s;
  }, [b1Cards, b2Cards, handTokens]);

  /** Human label for the slot the next picked card will fill. */
  const targetLabel = useMemo(() => {
    const t = effectiveTarget;
    if (!t) return undefined;
    if (t.type === "hand") return `Seat ${t.idx + 1}`;
    return boardsCount === 2 ? `Board ${t.idx + 1}` : "Board";
  }, [effectiveTarget, boardsCount]);

  const onPickCard = (code: string) => {
    const hT = hands.map((h) => tokenize(h));
    const b1T = tokenize(board1);
    const b2T = tokenize(board2);

    for (let i = 0; i < hands.length; i++) {
      if (hT[i].includes(code)) {
        const n = [...hands];
        n[i] = removeCode(hands[i], code);
        setHands(n);
        return;
      }
    }
    if (b1T.includes(code)) {
      setBoard1(encodeBoard(b1T.filter((x) => x !== code)).join(" "));
      return;
    }
    if (b2T.includes(code)) {
      setBoard2(encodeBoard(b2T.filter((x) => x !== code)).join(" "));
      return;
    }

    const t = effectiveTarget;
    if (!t) return;
    if (t.type === "hand") {
      const n = [...hands];
      n[t.idx] = sortCardsDesc([...hT[t.idx], code]).join(" ");
      setHands(n);
    } else {
      if (t.idx === 0) setBoard1(encodeBoard([...b1T, code]).join(" "));
      else setBoard2(encodeBoard([...b2T, code]).join(" "));
    }
  };

  // ✅ validity-driven clearing (hands + boards)
  const handsComplete = useMemo(
    () => handTokens.every((t) => t.length === cap),
    [handTokens, cap]
  );

  const boardsComplete = useMemo(() => {
    const b1Valid = b1Cards.length === 0 || b1Cards.length >= 3;
    if (!b1Valid) return false;
    if (boardsCount === 2) {
      const b2Valid = b2Cards.length === 0 || b2Cards.length >= 3;
      if (!b2Valid) return false;
    }
    return true;
  }, [b1Cards.length, b2Cards.length, boardsCount]);

  const inputsValid = handsComplete && boardsComplete;

  useEffect(() => {
    if (!inputsValid) {
      // Only clear if we currently show anything
      if (
        displayWinPcts1.length > 0 ||
        displayWinPcts2.length > 0 ||
        displayTotalEVs.length > 0
      ) {
        resetDisplayed();
      }
      lastComputedKeyRef.current = null;
    }
  }, [
    inputsValid,
    displayWinPcts1.length,
    displayWinPcts2.length,
    displayTotalEVs.length,
    resetDisplayed,
  ]);

  const s1 = useMemo(() => calcStats(sim1.result, hands.length), [sim1.result, hands.length]);
  const s2 = useMemo(() => calcStats(sim2.result, hands.length), [sim2.result, hands.length]);

  const currentKey = JSON.stringify({
    mode,
    boardsCount,
    cap,
    hands: handTokens.join("|"),
    b1: b1Cards.join(","),
    b2: boardsCount === 2 ? b2Cards.join(",") : "",
  });

  const isFresh = lastComputedKeyRef.current === currentKey;

  useEffect(() => {
    if (!isFresh) return;
    if (!s1.ready) return;

    setDisplayWinPcts1(s1.winPcts);

    if (boardsCount === 2 && s2.ready) {
      setDisplayWinPcts2(s2.winPcts);
    } else if (boardsCount === 1) {
      setDisplayWinPcts2([]);
    }

    setDisplayTotalEVs(
      hands.map((_, idx) => {
        if (boardsCount === 1) return s1.evPcts[idx];
        if (!s2.ready) return s1.evPcts[idx];
        return (s1.evPcts[idx] + s2.evPcts[idx]) / 2;
      })
    );
  }, [isFresh, s1, s2, boardsCount, hands]); // s1/s2 are memoized so this won't loop

  const handleCompute = useCallback(() => {
    if (boardsCount === 1) {
      sim2.cancelAll();
      sim1.compute(board1, hands);
    } else {
      sim1.compute(board1, hands, { dead: tokenize(board2) });
      sim2.compute(board2, hands, { dead: tokenize(board1) });
    }
    lastComputedKeyRef.current = currentKey;
  }, [boardsCount, board1, board2, hands, sim1, sim2, currentKey]);

  const handleClear = () => {
    sim1.cancelAll();
    sim2.cancelAll();
    setBoard1("");
    setBoard2("");
    setHands((p) => p.map(() => ""));
    resetDisplayed();
    lastComputedKeyRef.current = null;
  };

  const allFilled =
    handsComplete &&
    b1Cards.length >= 3 &&
    (boardsCount === 1 || b2Cards.length >= 3);

  useEffect(() => {
    if (allFilled && !computing && lastComputedKeyRef.current !== currentKey)
      handleCompute();
  }, [allFilled, computing, currentKey, handleCompute]);

  useEffect(() => {
    if (computing) {
      sim1.cancelAll();
      sim2.cancelAll();
    }
    lastComputedKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board1, board2, hands, boardsCount, cap, mode]);

  /* --- Seat / board interaction --- */
  const toggleSeatSelect = (i: number) =>
    setSelected((s) =>
      s?.type === "hand" && s.idx === i ? null : { type: "hand", idx: i }
    );

  const toggleBoardSelect = (idx: number) =>
    setSelected((s) =>
      s?.type === "board" && s.idx === idx ? null : { type: "board", idx }
    );

  const removeSeat = (i: number) => {
    if (hands.length <= 2) return;
    const n = [...hands];
    n.splice(i, 1);
    setHands(n);
    setDisplayWinPcts1((prev) => prev.filter((_, idx) => idx !== i));
    setDisplayWinPcts2((prev) => prev.filter((_, idx) => idx !== i));
    setDisplayTotalEVs((prev) => prev.filter((_, idx) => idx !== i));
    lastComputedKeyRef.current = null;
    setSelected(null);
  };

  const chipBtn =
    "px-2 py-1.5 rounded bg-slate-800 text-xs font-bold text-slate-200 whitespace-nowrap hover:bg-slate-700 transition-colors";

  return (
    <div className="flex flex-col h-[calc(100dvh-48px)] w-full overflow-hidden">
      {/* ── Top toolbar ── */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-b border-hairline z-20">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <select
            className="bg-slate-800 border-none rounded text-xs font-bold text-slate-200 py-1.5 pl-2 pr-6"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setHands((p) => p.map(() => ""));
            }}
          >
            <option value="NLH">NLH</option>
            <option value="PLO4">PLO4</option>
            <option value="PLO5">PLO5</option>
          </select>

          <button
            onClick={() => {
              setBoardsCount((b) => (b === 1 ? 2 : 1));
              setSelected((s) =>
                s?.type === "board" && s.idx === 1 ? null : s
              );
            }}
            className={chipBtn}
          >
            {boardsCount} Board{boardsCount > 1 ? "s" : ""}
          </button>

          <div className="flex items-center rounded bg-slate-800 px-1">
            <button
              onClick={() => {
                if (hands.length > 2) {
                  const n = [...hands];
                  n.pop();
                  setHands(n);
                  setDisplayWinPcts1((prev) => prev.slice(0, -1));
                  setDisplayWinPcts2((prev) => prev.slice(0, -1));
                  setDisplayTotalEVs((prev) => prev.slice(0, -1));
                  lastComputedKeyRef.current = null;
                  setSelected((s) =>
                    s?.type === "hand" && s.idx >= hands.length - 1 ? null : s
                  );
                }
              }}
              disabled={hands.length <= 2}
              className="px-2 py-1 text-slate-400 hover:text-red-400 disabled:opacity-30 text-xs font-bold"
            >
              -
            </button>
            <span className="text-[10px] font-bold text-slate-400 px-1">
              {hands.length}P
            </span>
            <button
              onClick={() => {
                if (hands.length < 4) setHands([...hands, ""]);
              }}
              disabled={hands.length >= 4}
              className="px-2 py-1 text-slate-400 hover:text-emerald-400 disabled:opacity-30 text-xs font-bold"
            >
              +
            </button>
          </div>

          {mode === "PLO4" && (
            <span className="text-[10px] text-white whitespace-nowrap">
              Seat&nbsp;1: raise range · Others: call ranges
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleClear}
            className="text-xs font-medium text-slate-400 hover:text-red-400 px-2"
          >
            Clear
          </button>
          {computing ? (
            <button
              onClick={() => {
                sim1.cancelAll();
                sim2.cancelAll();
              }}
              className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded shadow"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleCompute}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow"
            >
              Run
            </button>
          )}
        </div>
      </div>

      {/* ── Main: panels scroll above, card keypad docked below (mobile-first) ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* ── Player + board panels ── */}
        <div className="relative flex-1 min-h-0 w-full overflow-y-auto px-3 py-3 sm:px-5">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {/* Board(s) — on top; one full-width, or two side-by-side when space allows */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns:
                  boardsCount === 2
                    ? "repeat(auto-fit, minmax(260px, 1fr))"
                    : "1fr",
              }}
            >
              <BoardPanel
                idx={0}
                cards={b1Cards}
                value={board1}
                dual={boardsCount === 2}
                selected={selected?.type === "board" && selected.idx === 0}
                isNext={
                  effectiveTarget?.type === "board" && effectiveTarget.idx === 0
                }
                onSelect={() => toggleBoardSelect(0)}
                onChange={setBoard1}
                onRemoveCard={(c) =>
                  setBoard1(encodeBoard(b1Cards.filter((x) => x !== c)).join(" "))
                }
                onRandomize={() => randomizeBoard(0)}
                onClear={() => setBoard1("")}
              />
              {boardsCount === 2 && (
                <BoardPanel
                  idx={1}
                  cards={b2Cards}
                  value={board2}
                  dual
                  selected={selected?.type === "board" && selected.idx === 1}
                  isNext={
                    effectiveTarget?.type === "board" &&
                    effectiveTarget.idx === 1
                  }
                  onSelect={() => toggleBoardSelect(1)}
                  onChange={setBoard2}
                  onRemoveCard={(c) =>
                    setBoard2(
                      encodeBoard(b2Cards.filter((x) => x !== c)).join(" ")
                    )
                  }
                  onRandomize={() => randomizeBoard(1)}
                  onClear={() => setBoard2("")}
                />
              )}
            </div>

            {/* Hole cards — below the board; auto-fit so 2–4 seats pack the row */}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
            >
              {hands.map((_, i) => (
                <PlayerPanel
                  key={i}
                  idx={i}
                  tokens={handTokens[i]}
                  cap={cap}
                  value={hands[i]}
                  selected={selected?.type === "hand" && selected.idx === i}
                  isNext={
                    effectiveTarget?.type === "hand" && effectiveTarget.idx === i
                  }
                  ev={displayTotalEVs[i]}
                  win1={displayWinPcts1[i]}
                  win2={displayWinPcts2[i]}
                  dual={boardsCount === 2}
                  canRemove={hands.length > 2}
                  onSelect={() => toggleSeatSelect(i)}
                  onChange={(v) =>
                    setHands((p) => {
                      const n = [...p];
                      n[i] = v;
                      return n;
                    })
                  }
                  onRemoveCard={(c) =>
                    setHands((p) => {
                      const n = [...p];
                      n[i] = removeCode(p[i], c);
                      return n;
                    })
                  }
                  onRandomize={() => randomizeHand(i)}
                  onClear={() =>
                    setHands((p) => {
                      const n = [...p];
                      n[i] = "";
                      return n;
                    })
                  }
                  onRemoveSeat={() => removeSeat(i)}
                />
              ))}
            </div>

            {computing && (
              <p className="text-center text-[11px] font-medium text-emerald-300/80 animate-pulse">
                simulating…
              </p>
            )}
          </div>
        </div>

        {/* ── Card keypad — docked in the thumb zone (rank → suit) ── */}
        <div className="shrink-0 z-20 border-t border-hairline bg-surface/70 backdrop-blur-md px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <RankSuitKeypad
            used={usedSet}
            onPick={onPickCard}
            targetLabel={targetLabel}
            className="mx-auto w-full max-w-xl"
          />
        </div>
      </div>
    </div>
  );
};

export default EquityCalc;
