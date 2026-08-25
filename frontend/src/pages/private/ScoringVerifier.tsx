// src/pages/private/ScoringVerifier.tsx
// Score checker: enter every player's set hands and the board(s), and the
// deal is scored by the exact same code the advisor uses (scoreDealAll), so
// real home-game results can be checked against the implementation. Ships
// preloaded with a real 4-player double-board deal from the client's game
// whose scoresheet is known, so the numbers can be compared at a glance.
import React, { useMemo, useState } from "react";
import clsx from "clsx";
import { evaluateCards } from "phe";
import PlayingCard from "@/components/PlayingCard";
import CardPicker from "@/components/CardPicker";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import { bestOmaha } from "@/lib/handEval";
import { scoreDealAll, type RowScores } from "@/lib/taiwanese";
import BreakdownTable from "./BreakdownTable";
import { Segmented, Chip, glassCard } from "./controls";

// A real deal from the client's home game (2026-08-24), reconstructed from
// screenshots of the table and its scoresheet. House scoring of this deal
// must produce, in player order:
//   P1 [-6, -8, 0, -8], P2 [+6, -4, -12, 0], P3 [0, +12, -6, 0],
//   P4 [0, 0, +18, +8].
// Player slot order: [top, middle x2, bottom x4].
const EXAMPLE_PLAYERS: string[][] = [
  ["Qh", "7c", "7h", "4c", "2c", "9d", "Tc"],
  ["Ah", "Kc", "Td", "6h", "Jh", "8c", "5c"],
  ["Ks", "Qc", "Qd", "8s", "7s", "2d", "3d"],
  ["Kh", "9c", "6d", "As", "8h", "2s", "3h"],
];
const EXAMPLE_BOARDS: string[][] = [
  ["8d", "Ts", "Ad", "9s", "5s"],
  ["3s", "3c", "6c", "Ac", "9h"],
];

type Card = string | null;
const emptyPlayer = (): Card[] => new Array<Card>(7).fill(null);
const emptyBoard = (): Card[] => new Array<Card>(5).fill(null);

const SLOT_LABEL = ["Top", "Middle", "Middle", "Bottom", "Bottom", "Bottom", "Bottom"];

const ScoringVerifier: React.FC = () => {
  const [players, setPlayers] = useState<Card[][]>(EXAMPLE_PLAYERS.map((p) => [...p]));
  const [boards, setBoards] = useState<Card[][]>(EXAMPLE_BOARDS.map((b) => [...b]));
  const [royalties, setRoyalties] = useState(false);
  // cursor: [playerIdx, slotIdx] | ["board", boardIdx, slotIdx] flattened.
  const [cursor, setCursor] = useState<{ area: "p" | "b"; g: number; i: number } | null>(null);

  const nPlayers = players.length;
  const nBoards = boards.length;

  const used = useMemo(() => {
    const s = new Set<string>();
    for (const p of players) for (const c of p) if (c) s.add(c);
    for (const b of boards) for (const c of b) if (c) s.add(c);
    return s;
  }, [players, boards]);

  const slots = useMemo(() => {
    const list: { area: "p" | "b"; g: number; i: number }[] = [];
    players.forEach((p, g) => p.forEach((_, i) => list.push({ area: "p", g, i })));
    boards.forEach((b, g) => b.forEach((_, i) => list.push({ area: "b", g, i })));
    return list;
  }, [players, boards]);

  const getCard = (s: { area: "p" | "b"; g: number; i: number }): Card =>
    s.area === "p" ? players[s.g][s.i] : boards[s.g][s.i];

  const setCard = (s: { area: "p" | "b"; g: number; i: number }, v: Card) => {
    if (s.area === "p") {
      setPlayers((ps) => ps.map((p, g) => (g === s.g ? p.map((c, i) => (i === s.i ? v : c)) : p)));
    } else {
      setBoards((bs) => bs.map((b, g) => (g === s.g ? b.map((c, i) => (i === s.i ? v : c)) : b)));
    }
  };

  const firstEmptyFrom = (start: number): { area: "p" | "b"; g: number; i: number } | null => {
    for (let k = 0; k < slots.length; k++) {
      const s = slots[(start + k) % slots.length];
      if (!getCard(s)) return s;
    }
    return null;
  };

  const slotIndex = (s: { area: "p" | "b"; g: number; i: number }): number =>
    slots.findIndex((x) => x.area === s.area && x.g === s.g && x.i === s.i);

  const target =
    cursor && !getCard(cursor) ? cursor : firstEmptyFrom(cursor ? slotIndex(cursor) : 0);

  const pick = (code: string) => {
    if (used.has(code) || !target) return;
    setCard(target, code);
    const next = firstEmptyFrom(slotIndex(target) + 1);
    setCursor(next);
  };

  const clickSlot = (s: { area: "p" | "b"; g: number; i: number }) => {
    if (getCard(s)) setCard(s, null);
    setCursor(s);
  };

  const setPlayerCount = (n: number) => {
    setPlayers((ps) => {
      const next = ps.slice(0, n).map((p) => [...p]);
      while (next.length < n) next.push(emptyPlayer());
      return next;
    });
    setCursor(null);
  };

  const setBoardCount = (n: 1 | 2) => {
    setBoards((bs) => {
      const next = bs.slice(0, n).map((b) => [...b]);
      while (next.length < n) next.push(emptyBoard());
      return next;
    });
    setCursor(null);
  };

  const loadExample = () => {
    setPlayers(EXAMPLE_PLAYERS.map((p) => [...p]));
    setBoards(EXAMPLE_BOARDS.map((b) => [...b]));
    setCursor(null);
  };

  const clearAll = () => {
    setPlayers((ps) => ps.map(() => emptyPlayer()));
    setBoards((bs) => bs.map(() => emptyBoard()));
    setCursor(null);
  };

  const missing = slots.filter((s) => !getCard(s)).length;

  const breakdown = useMemo(() => {
    if (missing > 0) return null;
    const full = players as string[][];
    const fullBoards = boards as string[][];
    const rows: RowScores[][] = full.map((p) =>
      fullBoards.map((board) => ({
        top: evaluateCards([p[0], ...board]),
        middle: evaluateCards([p[1], p[2], ...board]),
        bottom: bestOmaha(board, p.slice(3)),
      }))
    );
    return scoreDealAll(rows, royalties);
  }, [players, boards, royalties, missing]);

  const targetLabel = target
    ? target.area === "p"
      ? `Player ${target.g + 1} ${SLOT_LABEL[target.i]}`
      : `Board ${target.g + 1}, card ${target.i + 1}`
    : undefined;

  const slotButton = (s: { area: "p" | "b"; g: number; i: number }, code: Card) => {
    const isTarget = target && target.area === s.area && target.g === s.g && target.i === s.i;
    return (
      <button
        key={`${s.area}${s.g}-${s.i}`}
        type="button"
        onClick={() => clickSlot(s)}
        title={code ? `Remove ${code}` : "Fill this slot next"}
        className={clsx(
          "rounded-md transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          isTarget && "ring-2 ring-emerald-400"
        )}
      >
        {code ? (
          <PlayingCard code={code} width={30} />
        ) : (
          <span
            className={clsx(
              "block w-[30px] aspect-[3/4] rounded-md border border-dashed",
              isTarget ? "border-emerald-400/80 bg-emerald-400/10" : "border-white/20 bg-white/[0.03]"
            )}
          />
        )}
      </button>
    );
  };

  return (
    <div className={glassCard}>
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        Score checker
      </p>
      <p className="mt-1 text-sm text-emerald-100/70 max-w-2xl">
        Enter every player's set hands and the board cards from a real deal; the points come
        from the exact code the advisor uses. It starts loaded with a scored deal from the
        home game, so the output can be compared with the real scoresheet.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
            Players
          </p>
          <div className="flex gap-1.5">
            {[2, 3, 4, 5, 6].map((n) => (
              <Chip key={n} label={String(n)} active={nPlayers === n} onClick={() => setPlayerCount(n)} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
            Boards
          </p>
          <Segmented
            value={String(nBoards) as "1" | "2"}
            options={[
              { value: "1", label: "Single" },
              { value: "2", label: "Double" },
            ]}
            onChange={(v) => setBoardCount(Number(v) as 1 | 2)}
          />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
            Royalties
          </p>
          <Segmented
            value={royalties ? "on" : "off"}
            options={[
              { value: "off", label: "Off (house)" },
              { value: "on", label: "On (PokerNews)" },
            ]}
            onChange={(v) => setRoyalties(v === "on")}
          />
        </div>
        <div className="flex gap-3 pb-1">
          <button
            type="button"
            onClick={loadExample}
            className="text-xs text-emerald-100/60 underline decoration-emerald-100/30 transition-colors hover:text-emerald-100"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-emerald-100/60 underline decoration-emerald-100/30 transition-colors hover:text-emerald-100"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {players.map((p, g) => (
          <div key={g} className="rounded-lg bg-white/[0.04] p-3">
            <p className="text-xs text-emerald-100/60 mb-2">Player {g + 1}</p>
            <div className="flex items-center gap-2.5">
              <span className="flex gap-1">{slotButton({ area: "p", g, i: 0 }, p[0])}</span>
              <span className="flex gap-1">
                {[1, 2].map((i) => slotButton({ area: "p", g, i }, p[i]))}
              </span>
              <span className="flex gap-1">
                {[3, 4, 5, 6].map((i) => slotButton({ area: "p", g, i }, p[i]))}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-emerald-100/40">top &middot; middle &middot; bottom</p>
          </div>
        ))}
        {boards.map((b, g) => (
          <div key={`b${g}`} className="rounded-lg bg-white/[0.04] p-3">
            <p className="text-xs text-emerald-100/60 mb-2">Board {g + 1}</p>
            <div className="flex gap-1">{b.map((c, i) => slotButton({ area: "b", g, i }, c))}</div>
          </div>
        ))}
      </div>

      {missing > 0 ? (
        <>
          <p className="mt-3 text-sm text-emerald-100/70">
            {missing} card{missing === 1 ? "" : "s"} left to place
            {targetLabel ? `, next: ${targetLabel}` : ""}.
          </p>
          <div className="mt-2 hidden md:block">
            <CardPicker
              used={used}
              onPick={pick}
              size="sm"
              fitToWidth
              cardWidth="100%"
              gapPx={5}
              className="grid w-full max-w-3xl rounded-xl border border-white/10 bg-white/[0.04] p-2.5"
            />
          </div>
          <div className="mt-2 md:hidden">
            <RankSuitKeypad used={used} onPick={pick} targetLabel={targetLabel} />
          </div>
        </>
      ) : (
        breakdown && (
          <div className="mt-4">
            <BreakdownTable breakdown={breakdown} />
          </div>
        )
      )}
    </div>
  );
};

export default ScoringVerifier;
