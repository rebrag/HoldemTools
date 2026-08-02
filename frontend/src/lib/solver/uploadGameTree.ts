// src/lib/uploadGameTree.ts
// Authenticated: the API takes the uploader's uid from the verified token.
import { authedFetch } from "@/lib/api";

/** Optional per-seat metadata carried with hand-history uploads so the
 *  solutions viewer can show real player names/stacks/cards. stackChips is
 *  measured AT THE FLOP (net of preflop money) in Pio chips = bb * 100. */
export type SeatMeta = {
  pos: string;
  name: string;
  stackChips: number;
  folded: boolean;
  hero: boolean;
  /** Known hole cards from the recorded hand ("As" style codes). */
  cards?: string[];
};

export type UploadGameTreeBody = {
  folder: string;
  line: string[];
  actingPos: string;
  isICM: boolean;
  text: string;
  alivePositions: string[];
  seats?: SeatMeta[];
  /** The hand's big blind in real chips - lets the viewer convert bb values
   *  back into the hand's own currency. */
  bigBlind?: number;
  /** Pio chips per unit of the hand's money, so the viewer can convert the
   *  solved numbers back. Omitted by sims, which use 100 chips per big blind. */
  chipScale?: number;
};

export type UploadGameTreeResult = {
  ok?: boolean;
  /** Full ADLS path of the uploaded gametree JSON. */
  path?: string;
  /** SolveJob id for status polling (see solveJobs.ts). */
  jobId?: string;
  /** True when an identical sim-path solve was already queued or running and
   *  jobId points at that job instead of a new one. */
  deduped?: boolean;
};

export async function uploadGameTree(body: UploadGameTreeBody): Promise<UploadGameTreeResult> {
  const start = performance.now();

  // Helpful client-side diagnostics
  console.debug("[uploadGameTree] POST /api/gametrees", {
    folder: body.folder,
    actions: body.line.join(" > "),
    actingPos: body.actingPos,
    isICM: body.isICM,
    textLen: body.text?.length ?? 0,
  });

  let res: Response;
  try {
    res = await authedFetch("/api/gametrees", {
      method: "POST",
      // Trim whitespace on big text to avoid accidental trailing spaces
      body: JSON.stringify({ ...body, text: body.text?.trim?.() ?? body.text }),
    });
  } catch (networkErr) {
    const dur = (performance.now() - start).toFixed(0);
    console.error(`[uploadGameTree] Network/auth error after ${dur}ms`, networkErr);
    throw networkErr;
  }

  const dur = (performance.now() - start).toFixed(0);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detail: any = undefined;
    try { detail = isJson ? await res.json() : await res.text(); } catch { /* ignore */ }
    console.error(`[uploadGameTree] HTTP ${res.status} after ${dur}ms`, detail);
    throw new Error(`Upload failed with status ${res.status}`);
  }

  const payload: UploadGameTreeResult = isJson ? await res.json() : {};
  console.info(`[uploadGameTree] Uploaded in ${dur}ms`, payload);
  return payload; // { ok, path, jobId, deduped }
}
