/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import Layout from "./Layout";
import RandomizeButton from "./RandomizeButton";
import PokerBackground from "./PokerBackground";
import { buildDeck, sampleN, tokenize, sortCardsDesc } from "../lib/cards";
import { useEquitySimulation } from "../hooks/useEquitySimulation";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";

/* Helpers */
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) + "%" : "—");

/* Shared sizing so seats, inputs, and slots line up 1:1 */
const CARD_W = "clamp(36px, 5.4vw, 62px)"; // single card/slot width
const SLOT_GAP = "6px";                    // ~gap-1.5
const widthForCap = (cap: number) =>
  `calc(${cap} * var(--card-w) + ${(cap - 1)} * var(--slot-gap))`;

const EquityCalc: React.FC = () => {
  /* live inputs (editable) */
  const [board, setBoard] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");

//   /* committed inputs (for compute) */
//   const [boardCommitted, setBoardCommitted] = useState("");
//   const [p1Committed, setP1Committed] = useState("");
//   const [p2Committed, setP2Committed] = useState("");

  /* randomize animation coupling */
  const [randFlag, setRandFlag] = useState(false);

  /* simulation hook */
  const { computing, result, compute, cancelAll } = useEquitySimulation();

  /* card utils */
  const usedSetFrom = (includeBoard: boolean, includeP1: boolean, includeP2: boolean) => {
    const used = new Set<string>();
    if (includeBoard) tokenize(board).forEach((c) => used.add(c));
    if (includeP1) tokenize(p1).forEach((c) => used.add(c));
    if (includeP2) tokenize(p2).forEach((c) => used.add(c));
    return used;
  };

  const randomizeBoard = () => {
    const deck = buildDeck();
    const used = usedSetFrom(false, true, true);
    const avail = deck.filter((c) => !used.has(c));
    const len = tokenize(board).length;
    const want = len === 4 ? 4 : len === 5 ? 5 : 3;
    const boardSorted = sortCardsDesc(sampleN(avail, want));
    setBoard(boardSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP1 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p1).length;
    const want = cur >= 5 ? 5 : cur === 4 ? 4 : cur >= 3 ? 4 : 2;
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP1(handSorted.join(" "));
    setRandFlag((f) => !f);
  };
  const randomizeP2 = () => {
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false);
    const avail = deck.filter((c) => !used.has(c));
    const cur = tokenize(p2).length;
    const want = cur >= 5 ? 5 : cur === 4 ? 4 : cur >= 3 ? 4 : 2;
    const handSorted = sortCardsDesc(sampleN(avail, want));
    setP2(handSorted.join(" "));
    setRandFlag((f) => !f);
  };

  // Resize helpers for mode toggle
  const resizeP1To = (target: 2 | 4 | 5) => {
    const cur = tokenize(p1);
    if (cur.length === target) { setP1(sortCardsDesc(cur).join(" ")); return; }
    if (cur.length > target)   { setP1(sortCardsDesc(cur.slice(0, target)).join(" ")); return; }
    const deck = buildDeck();
    const used = usedSetFrom(true, false, true);
    cur.forEach(c => used.add(c));
    const avail = deck.filter((c) => !used.has(c));
    const need = target - cur.length;
    setP1(sortCardsDesc([...cur, ...sampleN(avail, need)]).join(" "));
  };
  const resizeP2To = (target: 2 | 4 | 5) => {
    const cur = tokenize(p2);
    if (cur.length === target) { setP2(sortCardsDesc(cur).join(" ")); return; }
    if (cur.length > target)   { setP2(sortCardsDesc(cur.slice(0, target)).join(" ")); return; }
    const deck = buildDeck();
    const used = usedSetFrom(true, true, false);
    cur.forEach(c => used.add(c));
    const avail = deck.filter((c) => !used.has(c));
    const need = target - cur.length;
    setP2(sortCardsDesc([...cur, ...sampleN(avail, need)]).join(" "));
  };
  const rotateMode = () => {
    const k = tokenize(p1).length;
    const curMode = k >= 5 ? "PLO5" : k >= 4 ? "PLO4" : "NLH";
    const nextMode = curMode === "NLH" ? "PLO4" : curMode === "PLO4" ? "PLO5" : "NLH";
    const target: 2 | 4 | 5 = nextMode === "NLH" ? 2 : nextMode === "PLO4" ? 4 : 5;
    resizeP1To(target);
    resizeP2To(target);
  };

  // capacity from current mode (based on P1 hand length)
  const handCapacity = (): 2 | 4 | 5 => {
    const k = tokenize(p1).length;
    return (k >= 5 ? 5 : k >= 4 ? 4 : 2) as 2 | 4 | 5;
  };

  const removeCodeFromStr = (codes: string, code: string) =>
    sortCardsDesc(tokenize(codes).filter((c) => c !== code)).join(" ");

  // CardPicker fill order: P1 -> P2 -> Board (toggle off when clicked again)
  const onPickCard = (code: string) => {
    const p1Arr = tokenize(p1);
    const p2Arr = tokenize(p2);
    const bArr  = tokenize(board);

    if (p1Arr.includes(code)) { setP1(removeCodeFromStr(p1, code)); return; }
    if (p2Arr.includes(code)) { setP2(removeCodeFromStr(p2, code)); return; }
    if (bArr.includes(code))  { setBoard(removeCodeFromStr(board, code)); return; }

    const cap = handCapacity();
    if (p1Arr.length < cap) { setP1(sortCardsDesc([...p1Arr, code]).join(" ")); return; }
    if (p2Arr.length < cap) { setP2(sortCardsDesc([...p2Arr, code]).join(" ")); return; }
    if (bArr.length < 5)    { setBoard(sortCardsDesc([...bArr, code]).join(" ")); }
  };

  // Used set to dim tiles in picker
  const usedPickerSet = (() => {
    const s = new Set<string>();
    tokenize(board).forEach((c) => s.add(c));
    tokenize(p1).forEach((c) => s.add(c));
    tokenize(p2).forEach((c) => s.add(c));
    return s;
  })();

  // Derived arrays for rendering cards
  const p1Cards = sortCardsDesc(tokenize(p1));
  const p2Cards = sortCardsDesc(tokenize(p2));
  const boardCards = sortCardsDesc(tokenize(board));
  const cap = handCapacity();
  const p1Empty = Math.max(0, cap - p1Cards.length);
  const p2Empty = Math.max(0, cap - p2Cards.length);
  const boardEmpty = Math.max(0, 5 - boardCards.length);

  const p1Win = result ? pct(result.p1Win, result.total) : "—";
  const p2Win = result ? pct(result.p2Win, result.total) : "—";
  const tie   = result ? pct(result.ties,  result.total) : "—";
  const modeLabel = cap === 5 ? "PLO5" : cap === 4 ? "PLO4" : "NLH";

  /* CSS custom props for slot sizing */
  const slotVars: React.CSSProperties = {
    ["--card-w" as any]: CARD_W,
    ["--slot-gap" as any]: SLOT_GAP,
  };

  /* Seat subcomponent (to avoid duplication) */
  const SeatPanel: React.FC<{
    label: string;
    value: string;
    onChange: (s: string) => void;
    cards: string[];
    emptySlots: number;
    onRandomize: () => void;
    winText: string;
    tieText: string;
  }> = ({ label, value, onChange, cards, emptySlots, onRandomize, winText, tieText }) => (
    <div
      className="bg-white/95 border border-gray-200 rounded-xl shadow-md px-3 py-2 flex flex-col items-center"
      style={slotVars}
    >
      {/* Input matches total slot width */}
      <div className="flex items-center gap-2 mb-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label} (e.g., As Kd ...)`}
          className="rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm"
          style={{ width: widthForCap(cap), maxWidth: "100%" }}
        />
        <RandomizeButton
          randomFillEnabled={randFlag}
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
            onClick={() => onChange(removeCodeFromStr(value, c))}
            title={`Remove ${c}`}
            className="rounded-md focus:outline-none"
          >
            <PlayingCard code={c} width={CARD_W} />
          </button>
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div
            key={`${label}-slot-${i}`}
            className="inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-gray-400 bg-white/60"
            style={{ width: "var(--card-w)" }}
            title="Empty slot"
          >
            <span className="text-gray-500 text-sm">+</span>
          </div>
        ))}
      </div>

      {/* Equity (line break between Win and Tie) */}
      <div className="mt-2 text-[11px] text-gray-800 text-center">
        <div><span className="font-semibold text-emerald-700">Win:</span> {winText}</div>
        <div className="mt-0.5"><span className="font-semibold text-gray-600">Tie:</span> {tieText}</div>
      </div>
    </div>
  );

  return (
    <Layout>
      {/* BACKGROUND (purely aesthetic) */}
      <div className="fixed inset-0 z-10">
        <PokerBackground />
      </div>

      {/* CONTENT: grid fills space, no overlapping */}
      <div className="relative z-10 mx-auto max-w-screen-xl px-3 sm:px-6">
        {/* Header row: Mode (left) + Actions (right) */}
        <div className="grid grid-cols-2 items-start gap-3 pt-3">
          <div className="justify-self-start">
            <button
              type="button"
              onClick={rotateMode}
              title="Click to switch game: NLH → PLO4 → PLO5"
              className="text-xs px-2 py-1 rounded-full bg-gray-900/70 text-gray-100 border border-white/10 hover:bg-gray-800/80 transition"
            >
              Mode:&nbsp;{modeLabel}
            </button>
          </div>

          <div className="justify-self-end flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                cancelAll();
                setBoard(""); setP1(""); setP2("");
                // setBoardCommitted(""); setP1Committed(""); setP2Committed("");
              }}
              className="rounded-lg px-3 py-1.5 bg-gray-100/90 hover:bg-gray-200 text-gray-800 shadow"
            >
              Clear
            </button>

            {!computing ? (
              <button
                type="button"
                onClick={() => {
                //   setBoardCommitted(board);
                //   setP1Committed(p1);
                //   setP2Committed(p2);
                  compute(board, p1, p2);
                }}
                className="rounded-lg px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow"
              >
                Compute
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelAll}
                className="rounded-lg px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white shadow"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Main vertical stack:
            auto (Seat1) / minmax(120px, 1fr) (Board grows) / auto (Seat2) */}
        <div className="grid gap-4 my-3"
             style={{ gridTemplateRows: "auto minmax(120px, 1fr) auto" }}>
          <SeatPanel
            label="Player 1"
            value={p1}
            onChange={setP1}
            cards={p1Cards}
            emptySlots={p1Empty}
            onRandomize={randomizeP1}
            winText={p1Win}
            tieText={tie}
          />

          {/* Board panel */}
          <div className="flex flex-col items-center" style={slotVars}>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={board}
                onChange={(e) => setBoard(e.target.value)}
                placeholder="Board (e.g., Ah Kh Qd ...)"
                className="rounded-md bg-white px-2 py-1 text-sm outline-none border border-gray-300 shadow-sm"
                style={{ width: widthForCap(5), maxWidth: "100%" }}
              />
              <RandomizeButton
                randomFillEnabled={randFlag}
                setRandomFillEnabled={randomizeBoard}
                animationSpeed={0.5}
              />
            </div>

            <div className="flex items-center" style={{ gap: "var(--slot-gap)" }}>
              {boardCards.map((c) => (
                <button
                  key={`b-${c}`}
                  type="button"
                  onClick={() => setBoard(removeCodeFromStr(board, c))}
                  title={`Remove ${c}`}
                  className="rounded-md focus:outline-none"
                >
                  <PlayingCard code={c} width={CARD_W} />
                </button>
              ))}
              {Array.from({ length: boardEmpty }).map((_, i) => (
                <div
                  key={`slot-${i}`}
                  className="inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-gray-400 bg-white/60"
                  style={{ width: "var(--card-w)" }}
                  title="Empty board slot"
                >
                  <span className="text-gray-600 text-sm">+</span>
                </div>
              ))}
            </div>
          </div>

          <SeatPanel
            label="Player 2"
            value={p2}
            onChange={setP2}
            cards={p2Cards}
            emptySlots={p2Empty}
            onRandomize={randomizeP2}
            winText={p2Win}
            tieText={tie}
          />
        </div>

        {/* Card Picker (stays below, centered; responsive width) */}
        <div className="w-full pb-8">
          <CardPicker
            used={usedPickerSet}
            onPick={onPickCard}
            size="sm"
            cardWidth="clamp(28px, 5.8vw, 56px)"
            gapPx={6}
          />
        </div>
      </div>
    </Layout>
  );
};

export default EquityCalc;
