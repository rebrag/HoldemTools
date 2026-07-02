// src/pages/handhistory/advanced/useShowdownEquity.ts
// Computes all-in equity for a recorded showdown by reusing the project's
// Monte-Carlo / exact-enumeration equity engine (useEquitySimulation). Handles
// one or two boards; for a double board each player's equity is the average of
// their equity on the two half-pots.
import { useEffect, useRef, useState } from "react";
import { useEquitySimulation, type EquityResult } from "@/hooks/useEquitySimulation";
import type { EvalGame } from "@/lib/handEval";
import { tokenize } from "@/lib/cards";

export interface EquityRequest {
  game: EvalGame; // informational; the engine infers game from hand length
  hands: string[]; // space-joined hole cards, one per live player, in a fixed order
  board1: string; // cards known when the money went in (0/3/4/5), space-joined
  board2: string | null; // null for a single board
  key: string; // identity used to avoid recomputing the same request
}

export interface ShowdownEquity {
  pct: number[] | null; // win% incl. tie share per hand (request order); null until ready
  computing: boolean;
}

// win% (with tie share) per hand from a raw simulation result.
function evShares(res: EquityResult | null, nHands: number): { ev: number[]; ready: boolean } {
  if (!res || res.total <= 0 || res.wins.length !== nHands) {
    return { ev: new Array(nHands).fill(0), ready: false };
  }
  const n = res.total;
  const tieShare = res.ties / nHands;
  return { ev: res.wins.map((w) => ((w + tieShare) / n) * 100), ready: true };
}

export function useShowdownEquity(req: EquityRequest | null): ShowdownEquity {
  const sim1 = useEquitySimulation();
  const sim2 = useEquitySimulation();
  const [pct, setPct] = useState<number[] | null>(null);
  const startedKeyRef = useRef<string | null>(null);

  const nHands = req ? req.hands.length : 0;
  const double = !!req?.board2;

  // Kick off (or reset) the computation whenever the request identity changes.
  useEffect(() => {
    if (!req) {
      setPct(null);
      startedKeyRef.current = null;
      return;
    }
    if (startedKeyRef.current === req.key) return;
    startedKeyRef.current = req.key;
    setPct(null);
    if (req.board2 != null) {
      sim1.compute(req.board1, req.hands, { dead: tokenize(req.board2) });
      sim2.compute(req.board2, req.hands, { dead: tokenize(req.board1) });
    } else {
      sim2.cancelAll();
      sim1.compute(req.board1, req.hands);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.key]);

  const s1 = evShares(sim1.result, nHands);
  const s2 = evShares(sim2.result, nHands);
  // A board is settled when it has a result and is no longer simulating. For the
  // preflop Monte-Carlo path this waits for convergence rather than locking in an
  // early, low-sample estimate; exact postflop enumeration settles immediately.
  const ready1 = s1.ready && !sim1.computing;
  const ready2 = s2.ready && !sim2.computing;

  // Combine the board results once both are settled.
  useEffect(() => {
    if (!req || startedKeyRef.current !== req.key) return;
    if (!ready1 || (double && !ready2)) return;
    setPct(req.hands.map((_, i) => (double ? (s1.ev[i] + s2.ev[i]) / 2 : s1.ev[i])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready1, ready2, req?.key]);

  return { pct, computing: sim1.computing || (double && sim2.computing) };
}
