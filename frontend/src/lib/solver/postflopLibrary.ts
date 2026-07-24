// Types + fetchers for the v2 postflop solution layout:
//   piosolutions/{stacks}/{node_name}/{board}/{suffix}.json   per-node docs
//   piosolutions/{stacks}/{node_name}/{board}/manifest.json   per-board manifest
//   piosolutions-index.json                                   library index
import axios from "axios";
import type { PioSolutionDoc } from "@/lib/solver/postflopClient";

export type ManifestNode = {
  type: string; // "OOP_DEC" | "IP_DEC" | "SPLIT_NODE" | "terminal"
  street?: "flop" | "turn" | "river";
  actions?: string[]; // pio labels, e.g. ["c","b175"]
  extracted?: boolean;
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
  summary: { ev_oop: number | null; ev_ip: number | null; exploitable: number | null };
  cfr: { file: string; available: boolean; size_bytes: number | null };
  nodes: Record<string, ManifestNode>; // keyed by dotted suffix, e.g. "r.0.b175"
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
  cfr_available: boolean;
};

export type PostflopIndex = {
  schema: number;
  updated_utc?: string;
  entries: PostflopIndexEntry[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchPostflopIndex(apiBase: string): Promise<PostflopIndex | null> {
  const res = await axios.get<PostflopIndex>(`${apiBase}/api/Files/piosolutionsIndex`, {
    validateStatus: (s) => s === 200 || s === 404,
  });
  return res.status === 200 ? res.data : null;
}

export async function fetchBoardManifest(
  apiBase: string,
  stacks: string,
  nodeName: string,
  board: string
): Promise<BoardManifest | null> {
  const url = `${apiBase}/api/Files/piosolutions/${stacks}/${nodeName}/${board}/manifest`;
  const res = await axios.get<BoardManifest>(url, {
    validateStatus: (s) => s === 200 || s === 404,
  });
  return res.status === 200 ? res.data : null;
}

export async function fetchNodeDoc(
  apiBase: string,
  stacks: string,
  nodeName: string,
  board: string,
  nodeId: string
): Promise<PioSolutionDoc | null> {
  const suffix = encodeURIComponent(nodeId.replace(/:/g, "."));
  const url = `${apiBase}/api/Files/piosolutions/${stacks}/${nodeName}/${board}/${suffix}.json`;
  const res = await axios.get<PioSolutionDoc>(url, {
    validateStatus: (s) => s === 200 || s === 404,
  });
  return res.status === 200 ? res.data : null;
}

/**
 * Poll for a board manifest after a fresh solve request. A solve takes
 * minutes, so the window is generous; `shouldStop` lets the caller cancel.
 */
export async function pollForBoardManifest(
  apiBase: string,
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
      const manifest = await fetchBoardManifest(apiBase, stacks, nodeName, board);
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
