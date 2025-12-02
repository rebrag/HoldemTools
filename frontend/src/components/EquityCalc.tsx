// src/components/EquityCalc.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import PokerBackground from "./PokerBackground";
import { buildDeck, sampleN, tokenize, sortCardsDesc } from "../lib/cards";
import { useEquitySimulation } from "../hooks/useEquitySimulation";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";
import ploOpenRangeCSV from "../data/ploOpenRangeCSV.txt?raw";
import ploCallRangeCSV from "../data/ploCallRangeCSV.txt?raw";

/* ===== Shared helpers & constants ===== */
// Dynamic card width based on viewport to ensure fit
const CARD_W = "clamp(34px, 4.8vw, 64px)";
const SLOT_GAP = "5px";

type PloRangeEntry = {
  cards: string[]; // 4-card PLO hand, e.g. ["Ah", "As", "3s", "2s"]
  weight: number; // probability / weight from the CSV
};

type PloRangeCache = {
  entries: PloRangeEntry[] | null;
  cum: number[] | null;
  total: number;
};

const splitPloHand = (hand: string): string[] => {
  // CSV uses things like "AhAs3s2s" → split into ["Ah","As","3s","2s"]
  const chunks = hand.match(/../g) ?? [];
  return chunks;
};

const openRangeCache: PloRangeCache = { entries: null, cum: null, total: 0 };
const callRangeCache: PloRangeCache = { entries: null, cum: null, total: 0 };

const initPloRange = (raw: string, cache: PloRangeCache) => {
  if (cache.entries) return; // already initialized

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
      if (cards.length !== 4) return; // only keep valid 4-card hands

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

    // binary search in cumulative weights
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (r < cum[mid]) hi = mid;
      else lo = mid + 1;
    }

    const entry = entries[lo];
    if (!entry) continue;

    // avoid conflicts with already-used cards
    if (entry.cards.some((c) => used.has(c))) continue;

    return entry.cards;
  }

  return null;
};

// Encode board: keep first 3 sorted, rest order preserved
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
    className={className ?? "h-6 w-6"}
  >
    <path d="M7.5 3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1h3a.75.75 0 1 1 0 1.5h-.69l-.77 10.01A2.5 2.5 0 0 1 11.55 17h-3.1a2.5 2.5 0 0 1-2.99-2.49L4.69 4.5H4a.75.75 0 0 1 0-1.5h3.5Zm-1.7 1.5.74 9.6a1 1 0 0 0 .99.9h3.14a1 1 0 0 0 .99-.9l.74-9.6H5.8Z" />
  </svg>
);

/* ===== SeatPanel (Compact & Responsive) ===== */
type SeatPanelProps = {
  id: number;
  value: string;
  onChange: (s: string) => void;
  onClear: () => void;
  onRemoveSeat: () => void;
  canRemove: boolean;
  cards: string[];
  emptySlots: number;
  onRandomize: () => void;
  totalEVText: string;
  breakdowns: { label: string; winText: string; tieText: string }[];
  cap: 2 | 4 | 5;
  cardWidth: string;
  slotGap: string;
  randFlag: boolean;
  computing: boolean;
  highlightFirstEmpty?: boolean;
};

const SeatPanel: React.FC<SeatPanelProps> = React.memo(
  ({
    id,
    value,
    onChange,
    onClear,
    onRemoveSeat,
    canRemove,
    cards,
    emptySlots,
    onRandomize,
    totalEVText,
    breakdowns,
    cardWidth,
    slotGap,
    highlightFirstEmpty = false,
  }) => {
    const slotVars: React.CSSProperties = {
      ["--card-w" as any]: cardWidth,
      ["--slot-gap" as any]: slotGap,
    };

    // Determine background color based on active/empty state
    const isActive = cards.length > 0;

    return (
      <div
        className={`relative w-full h-full flex flex-col justify-between bg-white/90 backdrop-blur-sm border border-gray-300 shadow-sm rounded-lg p-1.5 transition-all
          ${highlightFirstEmpty ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-emerald-900" : ""}`}
        style={slotVars}
      >
        {/* Top Row: Input & Controls */}
        <div className="flex items-center gap-1 mb-1">
          <div className="flex items-center justify-center w-5 h-5 rounded bg-gray-200 text-[10px] font-bold text-gray-700 shrink-0">
            {id + 1}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Hand..."
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-gray-800 placeholder-gray-400 outline-none border-b border-gray-200 focus:border-emerald-500 py-0.5"
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={onRandomize}
              className="p-1 hover:bg-gray-200 rounded text-gray-500"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
            {isActive ? (
              <button
                onClick={onClear}
                className="p-1 hover:bg-red-100 rounded text-gray-500 hover:text-red-600"
              >
                <TrashIcon />
              </button>
            ) : (
              canRemove && (
                <button
                  onClick={onRemoveSeat}
                  className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600"
                  title="Remove Seat"
                >
                  <span className="text-s font-bold">✕</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Cards Row - Centered */}
        <div
          className="flex-1 flex items-center justify-center py-1"
          style={{ gap: "var(--slot-gap)" }}
        >
          {cards.map((c) => (
            <button
              key={`p${id}-${c}`}
              onPointerDown={(e) => {
                e.preventDefault();
                onChange(
                  sortCardsDesc(tokenize(value).filter((x) => x !== c)).join(" ")
                );
              }}
              className="hover:-translate-y-0.5 transition-transform"
            >
              <PlayingCard code={c} width={cardWidth} />
            </button>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => {
            const isNext = highlightFirstEmpty && i === 0;
            return (
              <div
                key={`p${id}-slot-${i}`}
                className="relative"
                style={{ width: "var(--card-w)", aspectRatio: "3/4" }}
              >
                {/* Base dashed slot */}
                <div className="w-full h-full border border-dashed rounded bg-gray-50/50 border-gray-300" />

                {/* NEXT highlight overlay */}
                {isNext && (
                  <>
                    <div className="pointer-events-none absolute -inset-1 rounded-[9px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-10" />
                    <div className="absolute -top-3 -right-1 z-20">
                      <span className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5 shadow">
                        NEXT
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Stats Footer - Very Compact */}
        <div className="mt-auto pt-1 border-t border-gray-200">
          <div className="flex justify-between items-end leading-none">
            <div className="flex flex-col text-[9px] text-gray-500 gap-0.5">
              {breakdowns.map((b) => (
              <div key={b.label} className="flex gap-1">
                <span className="opacity-70">{b.label}:</span>
                <span
                  className={
                    parseFloat(b.winText) > 50
                      ? "font-bold text-gray-800"
                      : ""
                  }
                >
                  {b.winText}
                </span>
              </div>
            ))}
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 uppercase tracking-tighter">
                Equity
              </div>
              <div className="text-sm font-bold text-emerald-700">
                {totalEVText}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

/* ===== BoardPanel (Compact) ===== */
const BoardPanel: React.FC<{
  label: string;
  value: string;
  onChange: (s: string) => void;
  onRandomize: () => void;
  onClear: () => void;
  cards: string[];
  emptySlots: number;
  cardWidth: string;
  slotGap: string;
  highlightFirstEmpty?: boolean;
}> = React.memo(
  ({
    label,
    value,
    onChange,
    onRandomize,
    onClear,
    cards,
    emptySlots,
    cardWidth,
    slotGap,
    highlightFirstEmpty,
  }) => (
    <div className="bg-white/90 backdrop-blur border border-gray-300 rounded-lg px-2 py-1.5 shadow-sm flex flex-col items-center min-w-[160px]">
      <div className="w-full flex justify-between items-center mb-1">
        <span className="text-[10px] font-bold text-gray-500 uppercase">
          {label}
        </span>
        <div className="flex gap-1">
          <button
            onClick={onRandomize}
            className="text-gray-400 hover:text-emerald-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-red-600"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="flex" style={{ gap: slotGap }}>
        {cards.map((c) => (
          <button
            key={c}
            onPointerDown={(e) => {
              e.preventDefault();
              onChange(
                encodeBoard(tokenize(value).filter((x) => x !== c)).join(" ")
              );
            }}
          >
            <PlayingCard code={c} width={cardWidth} />
          </button>
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => {
          const isNext = highlightFirstEmpty && i === 0;

          return (
            <div
              key={i}
              className="relative"
              style={{ width: cardWidth, aspectRatio: "3/4" }}
            >
              <div className="w-full h-full border border-dashed rounded bg-gray-50/50 border-gray-300" />
              {isNext && (
                <>
                  <div className="pointer-events-none absolute -inset-1 rounded-[9px] ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] animate-pulse z-10" />
                  <div className="absolute -top-3 -right-1 z-20">
                    <span className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5 shadow">
                      NEXT
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  )
);

/* ===== Main Component ===== */
type Mode = "NLH" | "PLO4" | "PLO5";

const EquityCalc: React.FC = () => {
  const [mode, setMode] = useState<Mode>("NLH");
  const [board1, setBoard1] = useState("");
  const [board2, setBoard2] = useState("");
  const [hands, setHands] = useState<string[]>(["", ""]);
  const [boardsCount, setBoardsCount] = useState<1 | 2>(1);
  const [randFlag, setRandFlag] = useState(false);

  const sim1 = useEquitySimulation();
  const sim2 = useEquitySimulation();
  const computing = sim1.computing || (boardsCount === 2 && sim2.computing);
  const cap: 2 | 4 | 5 = mode === "NLH" ? 2 : mode === "PLO4" ? 4 : 5;
  const lastComputedKeyRef = useRef<string | null>(null);

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
      setRandFlag((f) => !f);
    },
    [board1, board2, usedSetFrom]
  );

  const randomizeHand = useCallback(
    (seatIdx: number) => {
      const used = usedSetFrom(null, seatIdx);

      // PLO4: use ranges instead of pure random
      if (mode === "PLO4") {
        const cardsFromRange =
          seatIdx === 0
            ? pickRandomPloOpenHand(used) // Seat 1 → open range
            : pickRandomPloCallHand(used); // Other seats → call range

        if (cardsFromRange && cardsFromRange.length === cap) {
          const sample = sortCardsDesc(cardsFromRange);
          setHands((p) => {
            const n = [...p];
            n[seatIdx] = sample.join(" ");
            return n;
          });
          setRandFlag((f) => !f);
          return;
        }
        // If we couldn't find a conflict-free range hand, fall through
        // to generic random so the button still does something.
      }

      // Default behavior: random cards from remaining deck
      const deck = buildDeck();
      const avail = deck.filter((c) => !used.has(c));
      const sample = sortCardsDesc(sampleN(avail, cap));
      setHands((p) => {
        const n = [...p];
        n[seatIdx] = sample.join(" ");
        return n;
      });
      setRandFlag((f) => !f);
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

  const onPickCard = (code: string) => {
    const hT = hands.map((h) => tokenize(h));
    const b1T = tokenize(board1);
    const b2T = tokenize(board2);

    // Toggle Off
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

    // Add
    const t = nextAddTarget(boardsCount, cap, hT, b1T.length, b2T.length);
    if (!t) return;
    if (t.type === "hand") {
      const n = [...hands];
      n[t.idx] = sortCardsDesc([...hT[t.idx], code]).join(" ");
      setHands(n);
    } else {
      if (t.idx === 0)
        setBoard1(encodeBoard([...b1T, code]).join(" "));
      else setBoard2(encodeBoard([...b2T, code]).join(" "));
    }
  };

  const handTokens = useMemo(
    () => hands.map((h) => sortCardsDesc(tokenize(h))),
    [hands]
  );
  const b1Cards = useMemo(() => tokenize(board1), [board1]);
  const b2Cards = useMemo(() => tokenize(board2), [board2]);

  const calcStats = (res: any) => {
    if (!res || res.total <= 0 || res.wins.length !== hands.length)
      return {
        winPcts: hands.map(() => 0),
        tiePct: 0,
        evPcts: hands.map(() => 0),
        ready: false,
      };
    const n = res.total;
    const tieShare = res.ties / hands.length;
    return {
      winPcts: res.wins.map((w: number) => (w / n) * 100),
      tiePct: (res.ties / n) * 100,
      evPcts: res.wins.map((w: number) => ((w + tieShare) / n) * 100),
      ready: true,
    };
  };
  const s1 = calcStats(sim1.result);
  const s2 = calcStats(sim2.result);

  const currentKey = JSON.stringify({
    mode,
    boardsCount,
    cap,
    hands: handTokens.join("|"),
    b1: b1Cards.join(","),
    b2: boardsCount === 2 ? b2Cards.join(",") : "",
  });
  const isFresh = lastComputedKeyRef.current === currentKey;

  const getTotalEV = (idx: number) => {
    if (boardsCount === 1)
      return isFresh && s1.ready ? s1.evPcts[idx] : undefined;
    return isFresh && s1.ready && s2.ready
      ? (s1.evPcts[idx] + s2.evPcts[idx]) / 2
      : undefined;
  };
  const fmt = (v?: number) =>
    v === undefined ? "—" : `${v.toFixed(1)}%`;
  const target = nextAddTarget(
    boardsCount,
    cap,
    handTokens,
    b1Cards.length,
    b2Cards.length
  );

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
    lastComputedKeyRef.current = null;
  };

  // Auto-run
  const allFilled =
    hands.every((h) => tokenize(h).length === cap) &&
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

  /* --- RENDER --- */
  return (
    <div className="flex flex-col h-[calc(100dvh-100px)]  w-full overflow-hidden">
      {/* TOP CONTROLS */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between gap-2 shadow-sm z-20">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <select
            className="bg-gray-100 border-none rounded text-xs font-bold text-gray-700 py-1.5 pl-2 pr-6"
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
            onClick={() =>
              setBoardsCount((b) => (b === 1 ? 2 : 1))
            }
            className="px-2 py-1.5 rounded bg-gray-100 text-xs font-bold text-gray-700 whitespace-nowrap"
          >
            {boardsCount} Board{boardsCount > 1 ? "s" : ""}
          </button>
          <div className="flex items-center rounded px-1">
            <button
              onClick={() => {
                if (hands.length > 2) {
                  const n = [...hands];
                  n.pop();
                  setHands(n);
                  lastComputedKeyRef.current = null;
                }
              }}
              disabled={hands.length <= 2}
              className="px-2 py-1 text-gray-500 hover:text-red-600 disabled:opacity-30 text-xs font-bold"
            >
              -
            </button>
            <span className="text-[10px] font-bold text-gray-400 px-1">
              {hands.length}P
            </span>
            <button
              onClick={() => {
                if (hands.length < 4) setHands([...hands, ""]);
              }}
              disabled={hands.length >= 4}
              className="px-2 py-1 text-gray-500 hover:text-emerald-600 disabled:opacity-30 text-xs font-bold"
            >
              +
            </button>
          </div>

            {/* NEW: PLO4 range hint */}
            {mode === "PLO4" && (
              <span className="text-[10px] text-white whitespace-nowrap">
                Seat&nbsp;1: raise range · Others: call ranges
              </span>
            )}

        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleClear}
            className="text-xs font-medium text-gray-500 hover:text-red-500 px-2"
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

      {/* MIDDLE: TABLE (Fills space) */}
      <div className="relative flex-1 min-h-0 w-full">
        <div className="absolute inset-0 z-0">
          <PokerBackground />
        </div>

        {/* Scrollable Container just in case, but optimized to fit */}
        <div className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden p-2 flex flex-col items-center">
          <div className="w-full max-w-4xl flex flex-col gap-2 h-full justify-center">
            {/* Boards Area */}
            <div className="flex justify-center gap-2 shrink-0">
              <BoardPanel
                label="Board 1"
                value={board1}
                onChange={setBoard1}
                onRandomize={() => randomizeBoard(0)}
                onClear={() => setBoard1("")}
                cards={b1Cards}
                emptySlots={Math.max(0, 5 - b1Cards.length)}
                cardWidth={CARD_W}
                slotGap={SLOT_GAP}
                highlightFirstEmpty={
                  target?.type === "board" && target.idx === 0
                }
              />
              {boardsCount === 2 && (
                <BoardPanel
                  label="Board 2"
                  value={board2}
                  onChange={setBoard2}
                  onRandomize={() => randomizeBoard(1)}
                  onClear={() => setBoard2("")}
                  cards={b2Cards}
                  emptySlots={Math.max(0, 5 - b2Cards.length)}
                  cardWidth={CARD_W}
                  slotGap={SLOT_GAP}
                  highlightFirstEmpty={
                    target?.type === "board" && target.idx === 1
                  }
                />
              )}
            </div>

            {/* Seats Grid: 2 columns on ALL sizes to ensure compactness */}
            <div
              className={`grid grid-cols-2 gap-2 w-full mt-2 ${
                hands.length > 2 ? "flex-1" : ""
              }`}
            >
              {hands.map((h, i) => (
                <SeatPanel
                  key={i}
                  id={i}
                  value={h}
                  onChange={(v) => {
                    const n = [...hands];
                    n[i] = v;
                    setHands(n);
                  }}
                  onClear={() => {
                    const n = [...hands];
                    n[i] = "";
                    setHands(n);
                  }}
                  onRemoveSeat={() => {
                    if (hands.length > 2) {
                      const n = [...hands];
                      n.splice(i, 1);
                      setHands(n);
                      lastComputedKeyRef.current = null;
                    }
                  }}
                  canRemove={hands.length > 2}
                  cards={handTokens[i]}
                  emptySlots={Math.max(0, cap - handTokens[i].length)}
                  onRandomize={() => randomizeHand(i)}
                  totalEVText={fmt(getTotalEV(i))}
                  breakdowns={[
                    {
                      label: "B1",
                      winText: fmt(
                        isFresh && s1.ready ? s1.winPcts[i] : undefined
                      ),
                      tieText: "",
                    },
                    ...(boardsCount === 2
                      ? [
                          {
                            label: "B2",
                            winText: fmt(
                              isFresh && s2.ready
                                ? s2.winPcts[i]
                                : undefined
                            ),
                            tieText: "",
                          },
                        ]
                      : []),
                  ]}
                  cap={cap}
                  cardWidth={CARD_W}
                  slotGap={SLOT_GAP}
                  randFlag={randFlag}
                  computing={computing}
                  highlightFirstEmpty={
                    target?.type === "hand" && target.idx === i
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM: PICKER (Fixed height) */}
      <div className="shrink-0 z-20 pb-safe">
        <div className="w-full max-w-6xl mx-auto p-1 flex justify-center">
          <CardPicker
            used={useMemo(() => {
              const s = new Set<string>();
              tokenize(board1).forEach((c) => s.add(c));
              tokenize(board2).forEach((c) => s.add(c));
              hands.forEach((h) =>
                tokenize(h).forEach((c) => s.add(c))
              );
              return s;
            }, [board1, board2, hands])}
            onPick={onPickCard}
            size="sm"
            cardWidth="clamp(28px, 4.5vw, 42px)"
            gapPx={4}
          />
        </div>
      </div>
    </div>
  );
};

export default EquityCalc;
