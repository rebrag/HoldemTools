// src/components/EquityCalc.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import RandomizeButton from "./RandomizeButton";
import PokerBackground from "./PokerBackground";
import { buildDeck, sampleN, tokenize, sortCardsDesc } from "../lib/cards";
import { useEquitySimulation } from "../hooks/useEquitySimulation";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";

/* ===== Shared helpers & constants ===== */
const CARD_W = "clamp(36px, 5.4vw, 62px)";
const SLOT_GAP = "4px";
const widthForCap = (cap: number) =>
  `calc(${cap} * var(--card-w) + ${(cap - 1)} * var(--slot-gap))`;

// Sort only the first three cards; keep positions 4–5 in the order they were added.
const encodeBoard = (cards: string[]) => {
  const n = Math.min(3, cards.length);
  const first = sortCardsDesc(cards.slice(0, n));
  const rest = cards.slice(n); // keep user-added order
  return [...first, ...rest];
};

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className ?? "h-4 w-4"}>
    <path d="M7.5 3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1h3a.75.75 0 1 1 0 1.5h-.69l-.77 10.01A2.5 2.5 0 0 1 11.55 17h-3.1a2.5 2.5 0 0 1-2.99-2.49L4.69 4.5H4a.75.75 0 0 1 0-1.5h3.5Zm-1.7 1.5.74 9.6a1 1 0 0 0 .99.9h3.14a1 1 0 0 0 .99-.9l.74-9.6H5.8Z"/>
  </svg>
);

const TinyClearButton: React.FC<{ onPress: () => void; title?: string }> = ({ onPress, title="Clear" }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onPointerDown={(e) => { e.preventDefault(); onPress(); }}
    className="inline-flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 shadow px-2 py-1"
  >
    <TrashIcon />
  </button>
);

const MemoRandomizeButton = React.memo(RandomizeButton);

/* ===== SeatPanel (memoized) ===== */
type SeatPanelProps = {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onClear: () => void;
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
    label, value, onChange, onClear, cards, emptySlots, onRandomize,
    totalEVText, breakdowns, cap, cardWidth, slotGap, randFlag, computing,
    highlightFirstEmpty = false
  }) => {
    const slotVars: React.CSSProperties = {
      ["--card-w" as any]: cardWidth,
      ["--slot-gap" as any]: slotGap,
    };
    return (
      <div
        className="w-full bg-white/95 border border-gray-200 rounded-xl shadow-md px-3 py-2 flex flex-col items-center"
        style={slotVars}
      >
        <div className="flex items-center gap-1 mb-2 w-full">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label}`}
          className="flex-1 min-w-0 rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm truncate"
          // Let it grow, but never exceed the SeatPanel width on small screens
          style={{ width: `min(100%, ${widthForCap(cap)})` }}
        />
        <div className="shrink-0">
          <TinyClearButton onPress={onClear} />
        </div>
        <div className="shrink-0">
          <MemoRandomizeButton
            randomFillEnabled={randFlag && !computing}
            setRandomFillEnabled={onRandomize}
            animationSpeed={0.5}
          />
        </div>
      </div>


        <div className="flex items-center" style={{ gap: "var(--slot-gap)" }}>
          {cards.map((c) => (
            <button
              key={`${label}-${c}`}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onChange(sortCardsDesc(tokenize(value).filter((x) => x !== c)).join(" "));
              }}
              title={`Remove ${c}`}
              className="rounded-md focus:outline-none"
            >
              <PlayingCard code={c} width={cardWidth} />
            </button>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => {
            const isNext = highlightFirstEmpty && i === 0;
            return (
              <div
                key={`${label}-slot-${i}`}
                className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/60
                  ${isNext ? "border-emerald-500 ring-2 ring-emerald-400 animate-pulse" : "border-gray-400"}`}
                style={{ width: "var(--card-w)" }}
                title={isNext ? "Next card will go here" : "Empty slot"}
              >
                <span className={`text-sm ${isNext ? "text-emerald-700" : "text-gray-500"}`}>+</span>
                {isNext && (
                  <span className="absolute -top-1 -right-1 text-[9px] bg-emerald-600 text-white rounded px-1 shadow">
                    NEXT
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 text-[11px] text-gray-800 text-center">
          <div className="font-semibold text-emerald-700">Total Equity: {totalEVText}</div>
          {breakdowns.map((b) => (
            <div key={b.label} className="mt-0.5">
              <span className="font-medium text-gray-700">{b.label}:</span>{" "}
              <span className="text-gray-800">Win {b.winText}</span><br/>
              <span className="text-gray-600">Tie {b.tieText}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
);

/* ===== BoardPanel (memoized) ===== */
type BoardPanelProps = {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onRandomize: () => void;
  onClear: () => void;
  cards: string[];
  emptySlots: number;
  cardWidth: string;
  slotGap: string;
  randFlag: boolean;
  computing: boolean;
  highlightFirstEmpty?: boolean;
};
const BoardPanel: React.FC<BoardPanelProps> = React.memo(
  ({
    label, value, onChange, onRandomize, onClear, cards, emptySlots,
    cardWidth, slotGap, randFlag, computing, highlightFirstEmpty = false
  }) => {
    const slotVars: React.CSSProperties = {
      ["--card-w" as any]: cardWidth,
      ["--slot-gap" as any]: slotGap,
    };
    return (
      <div
        className="bg-white/95 border border-gray-200 rounded-xl shadow-md px-3 py-2 flex flex-col items-center"
        style={slotVars}
      >
        <div className="flex items-center gap-2 mb-2 w-full">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`${label} (ex: Ah Kh Qd ...)`}
            className="flex-1 min-w-0 rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm truncate"
            style={{ width: `min(100%, ${widthForCap(5)})` }}
          />
          <div className="shrink-0">
            <TinyClearButton onPress={onClear} />
          </div>
          <div className="shrink-0">
            <MemoRandomizeButton
              randomFillEnabled={randFlag && !computing}
              setRandomFillEnabled={onRandomize}
              animationSpeed={0.5}
            />
          </div>
        </div>


        <div className="flex items-center" style={{ gap: "var(--slot-gap)" }}>
          {cards.map((c) => (
            <button
              key={`${label}-${c}`}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                const filtered = tokenize(value).filter((x) => x !== c);
                onChange(encodeBoard(filtered).join(" "));
              }}
              title={`Remove ${c}`}
              className="rounded-md focus:outline-none"
            >
              <PlayingCard code={c} width={cardWidth} />
            </button>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => {
            const isNext = highlightFirstEmpty && i === 0;
            return (
              <div
                key={`${label}-slot-${i}`}
                className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/60
                  ${isNext ? "border-emerald-500 ring-2 ring-emerald-400 animate-pulse" : "border-gray-400"}`}
                style={{ width: "var(--card-w)" }}
                title={isNext ? "Next card will go here" : "Empty board slot"}
              >
                <span className={`text-sm ${isNext ? "text-emerald-700" : "text-gray-600"}`}>+</span>
                {isNext && (
                  <span className="absolute -top-1 -right-1 text-[9px] bg-emerald-600 text-white rounded px-1 shadow">
                    NEXT
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

/* ===== Main component ===== */
type Mode = "NLH" | "PLO4" | "PLO5";

const EquityCalc: React.FC = () => {
  /* explicit mode (fixed slot count; doesn't change from edits) */
  const [mode, setMode] = useState<Mode>("NLH");

  /* live inputs */
  const [board1, setBoard1] = useState("");
  const [board2, setBoard2] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");

  /* 1 or 2 boards */
  const [boardsCount, setBoardsCount] = useState<1 | 2>(1);

  /* randomize pulse */
  const [randFlag, setRandFlag] = useState(false);

  /* two sims: one per board */
  const sim1 = useEquitySimulation();
  const sim2 = useEquitySimulation();

  const computing = sim1.computing || (boardsCount === 2 && sim2.computing);

  /* capacity derived from explicit mode */
  const cap: 2 | 4 | 5 = mode === "NLH" ? 2 : mode === "PLO4" ? 4 : 5;

  /* track last fully computed configuration to gate displaying results */
  const lastComputedKeyRef = useRef<string | null>(null);

  /* helpers */
  const usedSetFrom = useCallback((
    includeB1: boolean, includeP1: boolean, includeP2: boolean, includeB2: boolean
  ) => {
    const used = new Set<string>();
    if (includeB1) tokenize(board1).forEach((c) => used.add(c));
    if (includeB2) tokenize(board2).forEach((c) => used.add(c));
    if (includeP1) tokenize(p1).forEach((c) => used.add(c));
    if (includeP2) tokenize(p2).forEach((c) => used.add(c));
    return used;
  }, [board1, board2, p1, p2]);

  const randomizeBoard1 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(false, true, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const len = tokenize(board1).length;
    const want = len === 4 ? 4 : len === 5 ? 5 : 3;
    const sample = sampleN(avail, want);
    setBoard1(encodeBoard(sample).join(" "));
    setRandFlag((f) => !f);
  }, [board1, usedSetFrom]);

  const randomizeBoard2 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, true, false);
    const avail = deck.filter((c) => !used.has(c));
    const len = tokenize(board2).length;
    const want = len === 4 ? 4 : len === 5 ? 5 : 3;
    const sample = sampleN(avail, want);
    setBoard2(encodeBoard(sample).join(" "));
    setRandFlag((f) => !f);
  }, [board2, usedSetFrom]);

  const randomizeP1 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const handSorted = sortCardsDesc(sampleN(avail, cap));
    setP1(handSorted.join(" "));
    setRandFlag((f) => !f);
  }, [usedSetFrom, cap]);

  const randomizeP2 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false, true);
    const avail = deck.filter((c) => !used.has(c));
    const handSorted = sortCardsDesc(sampleN(avail, cap));
    setP2(handSorted.join(" "));
    setRandFlag((f) => !f);
  }, [usedSetFrom, cap]);

  const removeCodeFromStr = (codes: string, code: string) =>
    sortCardsDesc(tokenize(codes).filter((c) => c !== code)).join(" ");

  // Determine the next target for an added card, honoring flop → turn → river across two boards.
  const nextAddTarget = (
    boards: 1 | 2,
    capSize: 2 | 4 | 5,
    p1Len: number, p2Len: number, b1Len: number, b2Len: number
  ): "p1" | "p2" | "b1" | "b2" | null => {
    if (p1Len < capSize) return "p1";
    if (p2Len < capSize) return "p2";
    // Flop
    if (b1Len < 3) return "b1";
    if (boards === 2 && b2Len < 3) return "b2";
    // Turn
    if (b1Len < 4) return "b1";
    if (boards === 2 && b2Len < 4) return "b2";
    // River
    if (b1Len < 5) return "b1";
    if (boards === 2 && b2Len < 5) return "b2";
    return null;
  };

  const onPickCard = (code: string) => {
    const p1Arr = tokenize(p1);
    const p2Arr = tokenize(p2);
    const b1Arr = tokenize(board1);
    const b2Arr = tokenize(board2);

    // toggle off if already placed
    if (p1Arr.includes(code)) { setP1(removeCodeFromStr(p1, code)); return; }
    if (p2Arr.includes(code)) { setP2(removeCodeFromStr(p2, code)); return; }
    if (b1Arr.includes(code)) { 
      const filtered = b1Arr.filter((x) => x !== code);
      setBoard1(encodeBoard(filtered).join(" "));
      return; 
    }
    if (b2Arr.includes(code)) { 
      const filtered = b2Arr.filter((x) => x !== code);
      setBoard2(encodeBoard(filtered).join(" "));
      return; 
    }

    // add in the desired order
    const target = nextAddTarget(boardsCount, cap, p1Arr.length, p2Arr.length, b1Arr.length, b2Arr.length);
    switch (target) {
      case "p1":
        setP1(sortCardsDesc([...p1Arr, code]).join(" "));
        return;
      case "p2":
        setP2(sortCardsDesc([...p2Arr, code]).join(" "));
        return;
      case "b1":
        setBoard1(encodeBoard([...b1Arr, code]).join(" "));
        return;
      case "b2":
        setBoard2(encodeBoard([...b2Arr, code]).join(" "));
        return;
      default:
        return;
    }
  };

  const p1Cards = sortCardsDesc(tokenize(p1));
  const p2Cards = sortCardsDesc(tokenize(p2));
  const b1Cards = tokenize(board1); // already encoded (first 3 sorted)
  const b2Cards = tokenize(board2);

  const p1Empty = Math.max(0, cap - p1Cards.length);
  const p2Empty = Math.max(0, cap - p2Cards.length);
  const b1Empty = Math.max(0, 5 - b1Cards.length);
  const b2Empty = Math.max(0, 5 - b2Cards.length);

  /* Per-board stats & totals */
  type Stat = { p1WinPct?: number; p2WinPct?: number; tiePct?: number; p1EVPct?: number; p2EVPct?: number; ready: boolean };
  const calcStats = (res: typeof sim1.result): Stat => {
    if (!res || res.total <= 0) return { ready: false };
    const n = res.total;
    return {
      p1WinPct: (res.p1Win / n) * 100,
      p2WinPct: (res.p2Win / n) * 100,
      tiePct  : (res.ties  / n) * 100,
      p1EVPct : ((res.p1Win + 0.5 * res.ties) / n) * 100,
      p2EVPct : ((res.p2Win + 0.5 * res.ties) / n) * 100,
      ready: true
    };
  };
  const s1 = calcStats(sim1.result);
  const s2 = calcStats(sim2.result);

  const currentKey = useMemo(() => JSON.stringify({
    mode, boardsCount, cap,
    p1: p1Cards.join(","), p2: p2Cards.join(","),
    b1: b1Cards.join(","), b2: boardsCount === 2 ? b2Cards.join(",") : ""
  }), [mode, boardsCount, cap, p1Cards, p2Cards, b1Cards, b2Cards]);

  const isFresh = lastComputedKeyRef.current === currentKey;

  const totalP1EV = (boardsCount === 1)
    ? (isFresh && s1.ready ? s1.p1EVPct! : undefined)
    : (isFresh && s1.ready && s2.ready ? (s1.p1EVPct! + s2.p1EVPct!) / 2 : undefined);

  const totalP2EV = (boardsCount === 1)
    ? (isFresh && s1.ready ? s1.p2EVPct! : undefined)
    : (isFresh && s1.ready && s2.ready ? (s1.p2EVPct! + s2.p2EVPct!) / 2 : undefined);

  const fmt = (v?: number) => (v === undefined ? "—" : `${v.toFixed(2)}%`);

  // NEXT ghost marker: align with the same add ordering
  const nextTarget = useMemo(() => {
    return nextAddTarget(boardsCount, cap, p1Cards.length, p2Cards.length, b1Cards.length, b2Cards.length);
  }, [boardsCount, cap, p1Cards.length, p2Cards.length, b1Cards.length, b2Cards.length]);

  /* Actions */
  const handleCompute = useCallback(() => {
    if (boardsCount === 1) {
      sim2.cancelAll();
      sim1.compute(board1, p1, p2);
    } else {
      // exclude the other board's known cards from each run (dead cards)
      sim1.compute(board1, p1, p2, { dead: tokenize(board2) });
      sim2.compute(board2, p1, p2, { dead: tokenize(board1) });
    }
    lastComputedKeyRef.current = currentKey;
  }, [boardsCount, board1, board2, p1, p2, sim1, sim2, currentKey]);

  const handleClearAll = () => {
    sim1.cancelAll();
    sim2.cancelAll();
    setBoard1(""); setBoard2(""); setP1(""); setP2("");
    lastComputedKeyRef.current = null;
  };

  /* Reset stats to default/null whenever inputs or mode change */
  useEffect(() => {
    if (computing) { sim1.cancelAll(); sim2.cancelAll(); }
    lastComputedKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board1, board2, p1, p2, boardsCount, cap, mode]);

  /* Auto-compute once everything is filled */
  const allFilled =
    p1Cards.length === cap && p2Cards.length === cap &&
    b1Cards.length >= 3 && (boardsCount === 1 || b2Cards.length >= 3);

  useEffect(() => {
    if (allFilled && !computing && lastComputedKeyRef.current !== currentKey) {
      handleCompute();
    }
  }, [allFilled, computing, currentKey, handleCompute]);

  /* Mode dropdown — same aesthetic as Tools; switching modes clears SeatPanels */
  const onChangeMode = (newMode: Mode) => {
    setMode(newMode);
    setP1(""); // clear seats on mode change
    setP2("");
  };

  const modeDropdown = (
    <div className="relative inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 shadow">
      <span className="pr-1">Mode</span>
      <select
        className="bg-transparent text-gray-800 text-sm outline-none appearance-none pl-1 pr-6 cursor-pointer"
        value={mode}
        onChange={(e) => onChangeMode(e.target.value as Mode)}
        aria-label="Select game mode"
      >
        <option className="text-black" value="NLH">NLH</option>
        <option className="text-black" value="PLO4">PLO4</option>
        <option className="text-black" value="PLO5">PLO5</option>
      </select>
      <svg className="pointer-events-none absolute right-2 h-4 w-4 text-gray-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.188l3.71-3.957a.75.75 0 111.08 1.04l-4.24 4.52a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </div>
  );

  const boardsPill = (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); setBoardsCount((b) => (b === 1 ? 2 : 1)); }}
      title="Toggle number of boards"
      className="text-xs px-2 py-1 rounded-full bg-gray-900/70 text-gray-100 border border-white/10 hover:bg-gray-800/80 transition"
    >
      Boards:&nbsp;{boardsCount}
    </button>
  );

  /* Used picker set (for greying cards) */
  const usedPickerSet = useMemo(() => {
    const s = new Set<string>();
    tokenize(board1).forEach((c) => s.add(c));
    tokenize(board2).forEach((c) => s.add(c));
    tokenize(p1).forEach((c) => s.add(c));
    tokenize(p2).forEach((c) => s.add(c));
    return s;
  }, [board1, board2, p1, p2]);

  return (
    <div className="h-auto flex flex-col">
      {/* Page content container */}
      <div className="relative z-10 mx-auto max-w-screen-xl px-3 sm:px-6 overflow-x-hidden">
        {/* Header */}
        <div className="grid grid-cols-2 items-start gap-3 pt-3">
          <div className="justify-self-start flex items-center gap-2">
            {modeDropdown}
            {boardsPill}
          </div>
          <div className="justify-self-end flex items-center gap-2">
            <button
              type="button"
              onPointerDown={(e) => { e.preventDefault(); handleClearAll(); }}
              className="rounded-lg px-3 py-1.5 bg-gray-100/90 hover:bg-gray-200 text-gray-800 shadow"
            >
              Clear
            </button>
            {!computing ? (
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); handleCompute(); }}
                className="rounded-lg px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow"
              >
                Compute
              </button>
            ) : (
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); sim1.cancelAll(); sim2.cancelAll(); }}
                className="rounded-lg px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white shadow"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* === Scoped background block: ONLY boards + seats === */}
        <div className="relative my-3">
          {/* Background behind this block only */}
          <PokerBackground />

          {/* Foreground content defines the height of the background */}
          <div className="relative z-10 grid gap-4">
            {/* Boards */}
            <div className="flex flex-col items-center gap-4">
              <BoardPanel
                label="Board 1"
                value={board1}
                onChange={setBoard1}
                onRandomize={randomizeBoard1}
                onClear={() => setBoard1("")}
                cards={b1Cards}
                emptySlots={b1Empty}
                cardWidth={CARD_W}
                slotGap={SLOT_GAP}
                randFlag={randFlag}
                computing={computing}
                highlightFirstEmpty={nextTarget === "b1" && b1Empty > 0}
              />
              {boardsCount === 2 && (
                <BoardPanel
                  label="Board 2"
                  value={board2}
                  onChange={setBoard2}
                  onRandomize={randomizeBoard2}
                  onClear={() => setBoard2("")}
                  cards={b2Cards}
                  emptySlots={b2Empty}
                  cardWidth={CARD_W}
                  slotGap={SLOT_GAP}
                  randFlag={randFlag}
                  computing={computing}
                  highlightFirstEmpty={nextTarget === "b2" && b2Empty > 0}
                />
              )}
            </div>

            {/* Seats */}
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4 items-start">
              <SeatPanel
                label={mode === "NLH" ? "ex: AsKd" : mode === "PLO4" ? "ex: AhKhQdJs" : "ex: AsKsQsJsTs"}
                value={p1}
                onChange={setP1}
                onClear={() => setP1("")}
                cards={p1Cards}
                emptySlots={p1Empty}
                onRandomize={randomizeP1}
                totalEVText={fmt(totalP1EV)}
                breakdowns={[
                  { label: "Board 1", winText: fmt(isFresh && s1.ready ? s1.p1WinPct : undefined), tieText: fmt(isFresh && s1.ready ? s1.tiePct : undefined) },
                  ...(boardsCount === 2 ? [{ label: "Board 2", winText: fmt(isFresh && s2.ready ? s2.p1WinPct : undefined), tieText: fmt(isFresh && s2.ready ? s2.tiePct : undefined) }] : []),
                ]}
                cap={cap}
                cardWidth={CARD_W}
                slotGap={SLOT_GAP}
                randFlag={randFlag}
                computing={computing}
                highlightFirstEmpty={nextTarget === "p1" && p1Empty > 0}
              />

              <SeatPanel
                label={mode === "NLH" ? "ex: QhQs" : mode === "PLO4" ? "ex: QhQsJhTd" : "ex: QhQsJhTd9c"}
                value={p2}
                onChange={setP2}
                onClear={() => setP2("")}
                cards={p2Cards}
                emptySlots={p2Empty}
                onRandomize={randomizeP2}
                totalEVText={fmt(totalP2EV)}
                breakdowns={[
                  { label: "Board 1", winText: fmt(isFresh && s1.ready ? s1.p2WinPct : undefined), tieText: fmt(isFresh && s1.ready ? s1.tiePct : undefined) },
                  ...(boardsCount === 2 ? [{ label: "Board 2", winText: fmt(isFresh && s2.ready ? s2.p2WinPct : undefined), tieText: fmt(isFresh && s2.ready ? s2.tiePct : undefined) }] : []),
                ]}
                cap={cap}
                cardWidth={CARD_W}
                slotGap={SLOT_GAP}
                randFlag={randFlag}
                computing={computing}
                highlightFirstEmpty={nextTarget === "p2" && p2Empty > 0}
              />
            </div>
          </div>
        </div>

        {/* Card Picker (no table behind this) */}
        <div className="w-full pb-6">
          <div className="mx-auto w-full max-w-screen-xl">
            <CardPicker
              used={usedPickerSet}
              onPick={onPickCard}
              size="sm"
              cardWidth="clamp(22px, 6vw, 56px)"
              gapPx={4}
            />
          </div>
        </div>
      </div>
    </div>
  );

};

export default EquityCalc;
