/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState, useCallback } from "react";
// import Layout from "./Layout";
import RandomizeButton from "./RandomizeButton";
import PokerBackground from "./PokerBackground";
import { buildDeck, sampleN, tokenize, sortCardsDesc } from "../lib/cards";
import { useEquitySimulation } from "../hooks/useEquitySimulation";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";

/* ===== Shared helpers & constants ===== */
// const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) + "%" : "—");

const CARD_W = "clamp(36px, 5.4vw, 62px)";
const SLOT_GAP = "4px";
const widthForCap = (cap: number) =>
  `calc(${cap} * var(--card-w) + ${(cap - 1)} * var(--slot-gap))`;

const MemoRandomizeButton = React.memo(RandomizeButton);

/* ===== SeatPanel (memoized, module scope) ===== */
type SeatPanelProps = {
  label: string;
  value: string;
  onChange: (s: string) => void;
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
  highlightFirstEmpty?: boolean; // NEW: show “next” marker on first empty slot
};
const SeatPanel: React.FC<SeatPanelProps> = React.memo(
  ({
    label, value, onChange, cards, emptySlots, onRandomize,
    totalEVText, breakdowns, cap, cardWidth, slotGap, randFlag, computing,
    highlightFirstEmpty = false
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
        {/* Input matches total slot width */}
        <div className="flex items-center gap-1 mb-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`${label}`}
            className="rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm"
            style={{ width: widthForCap(cap), maxWidth: "80%" }}
          />
          <MemoRandomizeButton
            randomFillEnabled={randFlag && !computing}
            setRandomFillEnabled={onRandomize}
            animationSpeed={0.5}
          />
        </div>

        {/* Cards + empty slots */}
        <div className="flex items-center" style={{ gap: "var(--slot-gap)" }}>
          {cards.map((c) => (
            <button
              key={`${label}-${c}`}
              type="button"
              onClick={() => onChange(sortCardsDesc(tokenize(value).filter((x) => x !== c)).join(" "))}
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

        {/* Equity: total EV + per-board rows */}
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

/* ===== BoardPanel (memoized, module scope) ===== */
type BoardPanelProps = {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onRandomize: () => void;
  cards: string[];
  emptySlots: number;
  cardWidth: string;
  slotGap: string;
  randFlag: boolean;
  computing: boolean;
  highlightFirstEmpty?: boolean; // NEW: show “next” marker on first empty slot
};
const BoardPanel: React.FC<BoardPanelProps> = React.memo(
  ({
    label, value, onChange, onRandomize, cards, emptySlots,
    cardWidth, slotGap, randFlag, computing, highlightFirstEmpty = false
  }) => {
    const slotVars: React.CSSProperties = {
      ["--card-w" as any]: cardWidth,
      ["--slot-gap" as any]: slotGap,
    };
    return (
      <div className="flex flex-col items-center" style={slotVars}>
        <div className="flex items-center gap-2 mb-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`${label} (e.g., Ah Kh Qd ...)`}
            className="rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm"
            style={{ width: widthForCap(5), maxWidth: "100%" }}
          />
          <MemoRandomizeButton
            randomFillEnabled={randFlag && !computing}
            setRandomFillEnabled={onRandomize}
            animationSpeed={0.5}
          />
        </div>

        <div className="flex items-center" style={{ gap: "var(--slot-gap)" }}>
          {cards.map((c) => (
            <button
              key={`${label}-${c}`}
              type="button"
              onClick={() => onChange(sortCardsDesc(tokenize(value).filter((x) => x !== c)).join(" "))}
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
const EquityCalc: React.FC = () => {
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
    const boardSorted = sortCardsDesc(sampleN(avail, want));
    setBoard1(boardSorted.join(" "));
    setRandFlag((f) => !f);
  }, [board1, usedSetFrom]);

  const randomizeBoard2 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, true, false);
    const avail = deck.filter((c) => !used.has(c));
    const len = tokenize(board2).length;
    const want = len === 4 ? 4 : len === 5 ? 5 : 3;
    const boardSorted = sortCardsDesc(sampleN(avail, want));
    setBoard2(boardSorted.join(" "));
    setRandFlag((f) => !f);
  }, [board2, usedSetFrom]);

  const randomizeP1 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p1).length;
    const want = cur >= 5 ? 5 : cur === 4 ? 4 : cur >= 3 ? 4 : 2;
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP1(handSorted.join(" "));
    setRandFlag((f) => !f);
  }, [p1, usedSetFrom]);

  const randomizeP2 = useCallback(() => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false, true);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p2).length;
    const want = cur >= 5 ? 5 : cur === 4 ? 4 : cur >= 3 ? 4 : 2;
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP2(handSorted.join(" "));
    setRandFlag((f) => !f);
  }, [p2, usedSetFrom]);

  const resizeHandTo = useCallback((
    codes: string, target: 2 | 4 | 5, otherHand: string, includeBoards: boolean
  ) => {
    const cur = tokenize(codes);
    if (cur.length === target) return sortCardsDesc(cur).join(" ");
    if (cur.length > target)   return sortCardsDesc(cur.slice(0, target)).join(" ");
    const deck = buildDeck();
    const used = usedSetFrom(includeBoards, true, true, includeBoards);
    tokenize(otherHand).forEach(c => used.add(c));
    cur.forEach(c => used.add(c));
    const avail = deck.filter((c) => !used.has(c));
    const need = target - cur.length;
    return sortCardsDesc([...cur, ...sampleN(avail, need)]).join(" ");
  }, [usedSetFrom]);

  const rotateMode = useCallback(() => {
    const k = tokenize(p1).length;
    const curMode = k >= 5 ? "PLO5" : k >= 4 ? "PLO4" : "NLH";
    const nextMode = curMode === "NLH" ? "PLO4" : curMode === "PLO4" ? "PLO5" : "NLH";
    const target: 2 | 4 | 5 = nextMode === "NLH" ? 2 : nextMode === "PLO4" ? 4 : 5;
    setP1(resizeHandTo(p1, target, p2, true));
    setP2(resizeHandTo(p2, target, p1, true));
  }, [p1, p2, resizeHandTo]);

  const handCapacity = (): 2 | 4 | 5 => {
    const k = tokenize(p1).length;
    return (k >= 5 ? 5 : k >= 4 ? 4 : 2) as 2 | 4 | 5;
  };

  const removeCodeFromStr = (codes: string, code: string) =>
    sortCardsDesc(tokenize(codes).filter((c) => c !== code)).join(" ");

  const onPickCard = (code: string) => {
    const p1Arr = tokenize(p1);
    const p2Arr = tokenize(p2);
    const b1Arr = tokenize(board1);
    const b2Arr = tokenize(board2);

    if (p1Arr.includes(code)) { setP1(removeCodeFromStr(p1, code)); return; }
    if (p2Arr.includes(code)) { setP2(removeCodeFromStr(p2, code)); return; }
    if (b1Arr.includes(code)) { setBoard1(removeCodeFromStr(board1, code)); return; }
    if (b2Arr.includes(code)) { setBoard2(removeCodeFromStr(board2, code)); return; }

    const cap = handCapacity();
    if (p1Arr.length < cap) { setP1(sortCardsDesc([...p1Arr, code]).join(" ")); return; }
    if (p2Arr.length < cap) { setP2(sortCardsDesc([...p2Arr, code]).join(" ")); return; }
    if (b1Arr.length < 5)   { setBoard1(sortCardsDesc([...b1Arr, code]).join(" ")); return; }
    if (boardsCount === 2 && b2Arr.length < 5) {
      setBoard2(sortCardsDesc([...b2Arr, code]).join(" "));
    }
  };

  const usedPickerSet = useMemo(() => {
    const s = new Set<string>();
    tokenize(board1).forEach((c) => s.add(c));
    tokenize(board2).forEach((c) => s.add(c));
    tokenize(p1).forEach((c) => s.add(c));
    tokenize(p2).forEach((c) => s.add(c));
    return s;
  }, [board1, board2, p1, p2]);

  const p1Cards = sortCardsDesc(tokenize(p1));
  const p2Cards = sortCardsDesc(tokenize(p2));
  const b1Cards = sortCardsDesc(tokenize(board1));
  const b2Cards = sortCardsDesc(tokenize(board2));
  const cap = handCapacity();

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

  const totalP1EV = (boardsCount === 1)
    ? (s1.ready ? s1.p1EVPct! : undefined)
    : (s1.ready && s2.ready ? (s1.p1EVPct! + s2.p1EVPct!) / 2 : undefined);

  const totalP2EV = (boardsCount === 1)
    ? (s1.ready ? s1.p2EVPct! : undefined)
    : (s1.ready && s2.ready ? (s1.p2EVPct! + s2.p2EVPct!) / 2 : undefined);

  const fmt = (v?: number) => (v === undefined ? "—" : `${v.toFixed(2)}%`);
  const modeLabel = cap === 5 ? "PLO5" : cap === 4 ? "PLO4" : "NLH";

  /* Determine which ghost card to highlight as “NEXT” */
  const nextTarget = useMemo(() => {
    if (p1Cards.length < cap) return "p1";
    if (p2Cards.length < cap) return "p2";
    if (b1Cards.length < 5)   return "b1";
    if (boardsCount === 2 && b2Cards.length < 5) return "b2";
    return null as null | "p1" | "p2" | "b1" | "b2";
  }, [p1Cards.length, p2Cards.length, b1Cards.length, b2Cards.length, cap, boardsCount]);

  /* Actions */
  const handleCompute = () => {
    if (boardsCount === 1) {
      sim2.cancelAll();
      sim1.compute(board1, p1, p2);
    } else {
      sim1.compute(board1, p1, p2);
      sim2.compute(board2, p1, p2);
    }
  };
  const handleClear = () => {
    sim1.cancelAll();
    sim2.cancelAll();
    setBoard1(""); setBoard2(""); setP1(""); setP2("");
  };

  /* Pills */
  const modePill = (
    <button
      type="button"
      onClick={rotateMode}
      title="Click to switch game: NLH → PLO4 → PLO5"
      className="text-xs px-2 py-1 rounded-full bg-gray-900/70 text-gray-100 border border-white/10 hover:bg-gray-800/80 transition"
    >
      Mode:&nbsp;{modeLabel}
    </button>
  );
  const boardsPill = (
    <button
      type="button"
      onClick={() => setBoardsCount((b) => (b === 1 ? 2 : 1))}
      title="Toggle number of boards"
      className="text-xs px-2 py-1 rounded-full bg-gray-900/70 text-gray-100 border border-white/10 hover:bg-gray-800/80 transition"
    >
      Boards:&nbsp;{boardsCount}
    </button>
  );

  return (
    <div className="h-auto flex flex-col">
      {/* Keep background behind content */}
      <div className="fixed inset-0 z-1">
        <PokerBackground />
      </div>

      <div className="relative z-10 mx-auto max-w-screen-xl px-3 sm:px-6 overflow-x-hidden">
        {/* Header: Mode/Boards + Actions */}
        <div className="grid grid-cols-2 items-start gap-3 pt-3">
          <div className="justify-self-start flex items-center gap-2">
            {modePill}
            {boardsPill}
          </div>
          <div className="justify-self-end flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg px-3 py-1.5 bg-gray-100/90 hover:bg-gray-200 text-gray-800 shadow"
            >
              Clear
            </button>
            {!computing ? (
              <button
                type="button"
                onClick={handleCompute}
                className="rounded-lg px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow"
              >
                Compute
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { sim1.cancelAll(); sim2.cancelAll(); }}
                className="rounded-lg px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white shadow"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Main stack: Boards / Seats row */}
        <div className="grid gap-4 my-3">
          {/* Boards area (Board 1 + optional Board 2 stacked) */}
          <div className="flex flex-col items-center gap-4">
            <BoardPanel
              label="Board 1"
              value={board1}
              onChange={setBoard1}
              onRandomize={randomizeBoard1}
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

          {/* Seats row: side-by-side 50/50 below boards */}
          <div className="grid grid-cols-2 md:grid-cols-2 gap-4 items-start">
            <SeatPanel
              label="e.g. AsKd"
              value={p1}
              onChange={setP1}
              cards={p1Cards}
              emptySlots={p1Empty}
              onRandomize={randomizeP1}
              totalEVText={fmt(totalP1EV)}
              breakdowns={[
                { label: "Board 1", winText: fmt(s1.p1WinPct), tieText: fmt(s1.tiePct) },
                ...(boardsCount === 2 ? [{ label: "Board 2", winText: fmt(s2.p1WinPct), tieText: fmt(s2.tiePct) }] : []),
              ]}
              cap={cap}
              cardWidth={CARD_W}
              slotGap={SLOT_GAP}
              randFlag={randFlag}
              computing={computing}
              highlightFirstEmpty={nextTarget === "p1" && p1Empty > 0}
            />

            <SeatPanel
              label="e.g. QhQs"
              value={p2}
              onChange={setP2}
              cards={p2Cards}
              emptySlots={p2Empty}
              onRandomize={randomizeP2}
              totalEVText={fmt(totalP2EV)}
              breakdowns={[
                { label: "Board 1", winText: fmt(s1.p2WinPct), tieText: fmt(s1.tiePct) },
                ...(boardsCount === 2 ? [{ label: "Board 2", winText: fmt(s2.p2WinPct), tieText: fmt(s2.tiePct) }] : []),
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

        {/* Card Picker */}
        <div className="w-full pb-8">
          <div className="mx-auto w-full max-w-screen-xl">
            <CardPicker
              used={usedPickerSet}
              onPick={onPickCard}
              size="sm"
              /* Your preferred width */
              cardWidth="clamp(22px, 5.8vw, 56px)"
              gapPx={4}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EquityCalc;
