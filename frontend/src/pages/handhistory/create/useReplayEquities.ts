// src/pages/handhistory/create/useReplayEquities.ts
// Per-street equity for the hand replayer. Reuses the same equity engine as the
// recorder — exactEquity() (exact enumeration) for the flop/turn/river, and the
// Monte-Carlo worker (useShowdownEquity) for a preflop all-in — but returns
// equity for EVERY street keyed by seat, so the replayer can show each live
// player's equity update as the board runs out. Computed once per hand (memoized
// on the resolved engine / setup), NOT per scrubbed frame.
import { useMemo } from "react";
import { exactEquity } from "@/lib/handEval";
import { useShowdownEquity, type EquityRequest } from "./useShowdownEquity";
import { evalGameId, handSize, type AdvancedHandState } from "./types";
import type { Engine } from "./engine";

export interface ReplayEquities {
  // seat index -> per-street win% (incl. tie share), indexed [pre, flop, turn,
  // river] to line up with engine.street (0..3). A slot is undefined when that
  // street's equity isn't available (preflop is only computed for a preflop
  // all-in; and it's undefined until the async Monte-Carlo converges).
  bySeat: Record<number, (number | undefined)[]>;
  participantSeats: number[]; // seats whose equity is known (the showdown / all-in players)
  computing: boolean; // preflop Monte-Carlo still running
}

const EMPTY: ReplayEquities = { bySeat: {}, participantSeats: [], computing: false };

export function useReplayEquities(
  state: AdvancedHandState | null,
  finalEngine: Engine | null
): ReplayEquities {
  const evalGame = state ? evalGameId(state.game) : null;
  const cardsPerHand = state ? handSize(state.game) : 2;
  const double = state?.numBoards === 2;

  // The showdown participant set + boards, resolved from the final engine. Mirrors
  // the recorder's `showdown` memo (CreateHandHistory): the live (non-folded)
  // players, requiring fully-known hole cards on a complete board.
  const info = useMemo(() => {
    if (!state || !finalEngine || !finalEngine.done || !evalGame) return null;
    const live = finalEngine.players
      .map((p, i) => ({ p, i }))
      .filter((x) => !x.p.folded);
    if (live.length < 2) return null; // won by fold — nothing to compute
    const hands = live.map((x) => x.p.hole.filter((c): c is string => !!c));
    const b1 = state.board.filter((c): c is string => !!c);
    const b2 = state.board2.filter((c): c is string => !!c);
    const canEval =
      hands.every((h) => h.length === cardsPerHand) &&
      b1.length === 5 &&
      (!double || b2.length === 5);
    if (!canEval) return null;
    return { seats: live.map((x) => x.p.seat), hands, b1, b2 };
  }, [state, finalEngine, evalGame, cardsPerHand, double]);

  // Flop/turn/river equity by exact enumeration (cheap; the river has no runout,
  // so it just scores the hands → 100/0 or split). Double board averages the two
  // half-pots, exactly like the recorder.
  const postflop = useMemo(() => {
    if (!info || !evalGame) return null;
    const at = (n: number) => {
      const e1 = exactEquity(evalGame, info.b1.slice(0, n), info.hands);
      if (double) {
        const e2 = exactEquity(evalGame, info.b2.slice(0, n), info.hands);
        return e1.map((v, k) => (v + e2[k]) / 2);
      }
      return e1;
    };
    return { flop: at(3), turn: at(4), river: at(5) };
  }, [info, evalGame, double]);

  // Preflop equity is expensive (Monte-Carlo), so only request it when the money
  // went in preflop — the only case a street-0 equity is ever shown.
  const needPre = !!info && finalEngine?.allInStreet === 0;
  const preReq: EquityRequest | null = useMemo(() => {
    if (!info || !needPre || !evalGame) return null;
    const hands = info.hands.map((h) => h.join(" "));
    return {
      game: evalGame,
      hands,
      board1: "",
      board2: double ? "" : null,
      key: JSON.stringify({ hands, nb: double ? 2 : 1 }),
    };
  }, [info, needPre, evalGame, double]);
  const { pct: preEq, computing } = useShowdownEquity(preReq);

  return useMemo(() => {
    if (!info || !postflop) return EMPTY;
    const bySeat: Record<number, (number | undefined)[]> = {};
    info.seats.forEach((seat, k) => {
      bySeat[seat] = [
        needPre ? preEq?.[k] : undefined,
        postflop.flop[k],
        postflop.turn[k],
        postflop.river[k],
      ];
    });
    return { bySeat, participantSeats: info.seats, computing: needPre && computing };
  }, [info, postflop, preEq, needPre, computing]);
}
