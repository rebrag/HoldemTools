// Types + authed fetchers for the v3 postflop solution layout:
//   piosolutions/{stacks}/{node_name}/{board}/streets/{seed}.json.gz  street bundles
//   piosolutions/{stacks}/{node_name}/{board}/manifest.json           per-board manifest
//   piosolutions-index.json                                           library index
// All reads go through authedFetch (endpoints require a signed-in user).
import { authedFetch } from "@/lib/api";
import type { PioSolutionDoc } from "@/lib/solver/postflopClient";

export type ManifestNode = {
  type: string; // "OOP_DEC" | "IP_DEC" | "SPLIT_NODE" | "terminal"
  street?: "flop" | "turn" | "river";
  actions?: string[]; // pio labels, e.g. ["c","b175"]
  extracted?: boolean;
};

export type ManifestStreetEntry = {
  street: "flop" | "turn" | "river";
  file: string;
  extracted: boolean;
  node_count?: number;
  updated_utc?: string;
  /** Set while an evicted-cfr re-solve is running (minutes, not seconds). */
  status?: "resolving";
  requested_utc?: string;
};

export type BoardManifest = {
  schema: number;
  board: string; // "AhKd9c"
  stacks: string;
  node_name: string;
  created_utc: string;
  updated_utc: string;
  preflop: {
    folder: string | null;
    line: string[] | null;
    alive_positions: string[] | null;
    acting_pos: string | null;
    icm: boolean;
    gametree_path: string | null;
  };
  seats: { oop: string | null; ip: string | null };
  stacks_map: Record<string, number>;
  pot_chips: number | null;
  /** Chips behind each player at flop start (from Pio's show_effective_stack);
   * drives the ALLIN labeling of stack-committing bets. Absent on old boards. */
  effective_stack_chips?: number | null;
  summary: { ev_oop: number | null; ev_ip: number | null; exploitable: number | null };
  cfr: { file: string; available: boolean; size_bytes: number | null };
  /** v3: keyed by dotted seed suffix ("r.0", "r.0.c.c.Th", ...). */
  streets: Record<string, ManifestStreetEntry>;
};

export type StreetBundle = {
  schema: number;
  kind: "street_bundle";
  seed: string; // colon form
  seed_suffix: string; // dotted form
  street: "flop" | "turn" | "river";
  board: string; // board AT this street, e.g. "Ts8d2hTh"
  nodes: Record<string, PioSolutionDoc>; // keyed by dotted suffix
  meta: Record<string, ManifestNode>;
};

export type PostflopIndexEntry = {
  stacks: string;
  node_name: string;
  board: string;
  preflop_line: string[] | null;
  alive_positions: string[] | null;
  icm: boolean;
  created_utc: string;
  flop_nodes: number;
  turn_streets?: number;
  cfr_available: boolean;
};

export type PostflopIndex = {
  schema: number;
  updated_utc?: string;
  entries: PostflopIndexEntry[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Authenticated GET returning parsed JSON, null on 404, ApiError otherwise. */
async function authedJson<T>(path: string): Promise<T | null> {
  const res = await authedFetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function fetchPostflopIndex(): Promise<PostflopIndex | null> {
  return authedJson<PostflopIndex>(`/api/Files/piosolutionsIndex`);
}

export async function fetchBoardManifest(
  stacks: string,
  nodeName: string,
  board: string
): Promise<BoardManifest | null> {
  return authedJson<BoardManifest>(
    `/api/Files/piosolutions/${stacks}/${nodeName}/${board}/manifest`
  );
}

/** Fetch one street bundle; the server sends gzip bytes with
 * Content-Encoding, which the browser inflates transparently. */
export async function fetchStreetBundle(
  stacks: string,
  nodeName: string,
  board: string,
  seedSuffix: string
): Promise<StreetBundle | null> {
  return authedJson<StreetBundle>(
    `/api/Files/piosolutions/${stacks}/${nodeName}/${board}/streets/${encodeURIComponent(seedSuffix)}.json`
  );
}

/** Queue an on-demand street extraction (turn/river card). */
export async function postNodeRequest(req: {
  stacks: string;
  node: string;
  board: string;
  nodeId: string;
}): Promise<boolean> {
  const res = await authedFetch(`/api/noderequests`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  return res.ok;
}

/**
 * Poll the manifest until a street is extracted. Fast cadence for the normal
 * warm path (seconds); slower once the watcher reports a re-solve (minutes).
 */
export async function pollForStreet(
  stacks: string,
  nodeName: string,
  board: string,
  seedSuffix: string,
  options?: {
    maxAttempts?: number;
    shouldStop?: () => boolean;
    onResolving?: () => void;
  }
): Promise<BoardManifest | null> {
  const maxAttempts = options?.maxAttempts ?? 120;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.shouldStop?.()) return null;
    try {
      const manifest = await fetchBoardManifest(stacks, nodeName, board);
      const entry = manifest?.streets?.[seedSuffix];
      if (entry?.extracted) return manifest;
      if (entry?.status === "resolving") options?.onResolving?.();
      await sleep(entry?.status === "resolving" ? 15000 : 3000);
    } catch (err) {
      console.warn(`⚠️ Error polling for street ${seedSuffix}`, err);
      await sleep(3000);
    }
  }
  console.warn(`⌛ Gave up waiting for street ${seedSuffix} on ${board}`);
  return null;
}

/**
 * Poll for a board manifest after a fresh solve request. A solve takes
 * minutes, so the window is generous; `shouldStop` lets the caller cancel.
 */
export async function pollForBoardManifest(
  stacks: string,
  nodeName: string,
  board: string,
  options?: { intervalMs?: number; maxAttempts?: number; shouldStop?: () => boolean }
): Promise<BoardManifest | null> {
  const intervalMs = options?.intervalMs ?? 8000;
  const maxAttempts = options?.maxAttempts ?? 90; // ~12 minutes
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.shouldStop?.()) return null;
    try {
      const manifest = await fetchBoardManifest(stacks, nodeName, board);
      if (manifest) {
        console.log(`✅ Board manifest ready for ${board} (attempt ${attempt})`);
        return manifest;
      }
      console.log(`⏳ Manifest not ready for ${board}, attempt ${attempt}/${maxAttempts}`);
    } catch (err) {
      console.warn(`⚠️ Error polling manifest (attempt ${attempt}/${maxAttempts})`, err);
    }
    await sleep(intervalMs);
  }
  console.warn(`⌛ Gave up waiting for manifest for board ${board}`);
  return null;
}
