// src/workers/sessionSimWorker.ts
//
// Thin shell over src/lib/sessionSim: deals and plays a compiled solve, or
// bootstraps sessions from finished pools. Both loops are synchronous, so a
// queued "cancel" message could never preempt them - the host cancels by
// terminate(), which is why there is no cancel message here.
import { analyzeSessions } from "../lib/sessionSim/analyzeSessions";
import { simulateHands } from "../lib/sessionSim/simulateHands";
import type { SimIn, SimOut } from "../lib/sessionSim/types";

const post = (m: SimOut, transfer?: Transferable[]) =>
  transfer ? self.postMessage(m, transfer) : self.postMessage(m);

self.onmessage = (ev: MessageEvent<SimIn>) => {
  const m = ev.data;
  try {
    if (m.type === "simulate") {
      const pool = simulateHands(
        m.policy,
        m.hands,
        m.seed,
        (done) => post({ type: "progress", taskId: m.taskId, done }),
        m.reportEvery
      );
      post({ type: "simulated", taskId: m.taskId, pool }, [pool.results.buffer]);
    } else if (m.type === "analyze") {
      const result = analyzeSessions(
        m.pools,
        m.poolStats,
        m.poolMeta,
        m.chipScale,
        m.params,
        m.seed,
        (done) => post({ type: "progress", taskId: -1, done })
      );
      post({ type: "analysis", result });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
