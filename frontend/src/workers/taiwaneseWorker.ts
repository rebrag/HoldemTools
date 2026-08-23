/// <reference lib="webworker" />
// A Vite module worker. No DOM APIs here.
// Taiwanese poker hand-setting advisor for the /private page. Common random
// numbers: every sampled scenario (opponent hands + boards) is scored against
// ALL 105 hero splits, so the split EVs are directly comparable and converge
// with far fewer samples than independent runs would need. Cancellation is by
// worker.terminate() from the host.
import { evaluateCards } from "phe";
import { bestOmaha } from "../lib/handEval";
import {
  PAIRS,
  QUADS,
  enumerateSplits,
  heuristicSplit,
  scorePairwise,
  splitCards,
  type RowScores,
} from "../lib/taiwanese";
import type { TaiwaneseIn, TaiwaneseOut, TaiwaneseParams, TaiwaneseSplitResult } from "../pages/private/protocol";

/* ---------- cards ---------- */
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["h", "d", "c", "s"];

/* ---------- LCG RNG (seeded per run) ---------- */
let lcgState = 0;
function seedLCG(seed: number) { lcgState = seed >>> 0; }
function rand(): number { // [0,1)
  lcgState = (1664525 * lcgState + 1013904223) >>> 0;
  return (lcgState >>> 8) / 0x01000000;
}

const post = (m: TaiwaneseOut) => self.postMessage(m);

self.onmessage = (ev: MessageEvent<TaiwaneseIn>) => {
  const msg = ev.data;
  if (msg.type !== "start") return;
  try {
    run(msg.payload);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

function run(p: TaiwaneseParams) {
  const { heroCards, opponents, boards, samples, seed, reportEvery } = p;
  if (heroCards.length !== 7) throw new Error("heroCards must have exactly 7 cards");
  seedLCG(seed);

  const splits = enumerateSplits();
  const heroSet = new Set(heroCards);
  const avail: string[] = [];
  for (const r of RANKS) for (const s of SUITS) {
    const c = r + s;
    if (!heroSet.has(c)) avail.push(c);
  }

  const ev = new Float64Array(splits.length);
  const need = opponents * 7 + boards * 5;

  for (let it = 0; it < samples; it++) {
    // Partial Fisher-Yates; avail stays a permutation between scenarios.
    for (let t = 0; t < need; t++) {
      const j = t + Math.floor(rand() * (avail.length - t));
      const tmp = avail[t];
      avail[t] = avail[j];
      avail[j] = tmp;
    }
    let off = 0;
    const oppHands: string[][] = [];
    for (let o = 0; o < opponents; o++) {
      oppHands.push(avail.slice(off, off + 7));
      off += 7;
    }
    const boardList: string[][] = [];
    for (let b = 0; b < boards; b++) {
      boardList.push(avail.slice(off, off + 5));
      off += 5;
    }

    // Hero score tables per board: each split is then 3 array lookups instead
    // of fresh evaluations (7 top + 21 middle + 35 bottom evals cover all 105).
    const topScores: number[][] = [];
    const midScores: number[][] = [];
    const botScores: number[][] = [];
    for (const board of boardList) {
      const tops = new Array<number>(7);
      for (let i = 0; i < 7; i++) tops[i] = evaluateCards([heroCards[i], ...board]);
      const mids = new Array<number>(PAIRS.length);
      PAIRS.forEach(([a, b], pi) => {
        mids[pi] = evaluateCards([heroCards[a], heroCards[b], ...board]);
      });
      const bots = new Array<number>(QUADS.length);
      QUADS.forEach((q, qi) => {
        bots[qi] = bestOmaha(board, q.map((i) => heroCards[i]));
      });
      topScores.push(tops);
      midScores.push(mids);
      botScores.push(bots);
    }

    // Opponents set their hands once (board-independent heuristic), then each
    // is scored per board.
    const oppRows: RowScores[][] = oppHands.map((hand) => {
      const parts = splitCards(heuristicSplit(hand), hand);
      return boardList.map((board) => ({
        top: evaluateCards([...parts.top, ...board]),
        middle: evaluateCards([...parts.middle, ...board]),
        bottom: bestOmaha(board, parts.bottom),
      }));
    });

    for (let si = 0; si < splits.length; si++) {
      const sp = splits[si];
      const heroRows: RowScores[] = boardList.map((_, b) => ({
        top: topScores[b][sp.top],
        middle: midScores[b][sp.middleIdx],
        bottom: botScores[b][sp.bottomIdx],
      }));
      let pts = 0;
      for (const rows of oppRows) pts += scorePairwise(heroRows, rows);
      ev[si] += pts;
    }

    if ((it + 1) % reportEvery === 0) post({ type: "progress", done: it + 1, total: samples });
  }

  const results: TaiwaneseSplitResult[] = splits
    .map((sp, si) => ({ ...splitCards(sp, heroCards), evPoints: ev[si] / samples }))
    .sort((a, b) => b.evPoints - a.evPoints);

  post({ type: "done", result: { samples, opponents, boards, splits: results } });
}
