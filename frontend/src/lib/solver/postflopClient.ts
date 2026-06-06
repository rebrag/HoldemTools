// src/lib/postflopClient.ts
import axios from "axios";
import type { JsonData } from "../utils/utils";

export type PioSolutionDoc = {
  board: string;
  created_utc: string;
  position?: "IP" | "OOP";
  hero_pos?: string | null;
  bb?: number | null;
  node_type?: "root" | "check";
  node_id?: string | null; // e.g. "r:0" or "r:0:1"
  node_suffix?: string | null; // e.g. "r.0" or "r.0.1"

  root_169?: {
    hand_classes: string[];
    strategy: {
      actions: string[];
      matrix: number[][];
    };
    ev: {
      oop: (number | null)[] | null;
      ip: (number | null)[] | null;
    };
  };

  actions?: {
    [actionName: string]: {
      [handClass: string]: [number, number | null]; // [freq, EV]
    };
  };

  source?: {
    gametree_path?: string;
    stacks?: string;
    node?: string;
  };
};

// simple sleep helper for polling
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert a root_169 block into your JsonData shape
 * for one role ("oop" or "ip") and one table position (BTN, BB, etc.).
 */
export function root169ToJsonData(
  root: NonNullable<PioSolutionDoc["root_169"]>,
  role: "oop" | "ip",
  position: string,
  bb: number
): JsonData {
  const { hand_classes, strategy, ev } = root;

  const evArray = role === "oop" ? ev.oop : ev.ip;

  const json: JsonData = {
    Position: position,
    bb,
  };

  // For each action row, build HandData: { [hand]: [strategyWeight, EV] }
  strategy.actions.forEach((actionName, actionIdx) => {
    const row = strategy.matrix[actionIdx] ?? [];
    const handMap: { [hand: string]: [number, number] } = {};

    hand_classes.forEach((hand, handIdx) => {
      const weight = row[handIdx] ?? 0;
      const evVal = evArray?.[handIdx] ?? 0;
      handMap[hand] = [weight, evVal];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (json as any)[actionName] = handMap;
  });

  return json;
}

/**
 * Parse an ADLS gametree path to extract stacks + nodeName,
 * e.g. gametrees/YYYY/MM/DD/<user>/folder=STACKS/NODENAME.json
 */
export function parseGametreePathForSolution(gametreePath: string): {
  stacks: string | null;
  nodeName: string | null;
} {
  let path = gametreePath.replace(/^\/+/, "");

  if (path.startsWith("gametrees/")) {
    path = path.slice("gametrees/".length);
  }

  const parts = path.split("/").filter(Boolean);

  let stacks: string | null = null;
  for (const part of parts) {
    if (part.startsWith("folder=")) {
      stacks = part.slice("folder=".length);
      break;
    }
  }

  const nodeFile = parts[parts.length - 1] ?? "";
  const nodeName = nodeFile.endsWith(".json")
    ? nodeFile.slice(0, -".json".length)
    : nodeFile;

  return { stacks, nodeName };
}

/**
 * Build the URL where your API will expose a postflop solution JSON.
 *
 * NOTE: This path must line up with whatever your watcher uploads to ADLS / your API serves.
 */
export function buildPioSolutionUrl(
  apiBaseUrl: string,
  gametreePath: string,
  boardName: string,
  nodeId: string = "r:0" // default: root node
): string | null {
  const { stacks, nodeName } = parseGametreePathForSolution(gametreePath);
  if (!stacks || !nodeName) {
    console.warn("Could not derive stacks/node from gametreePath:", gametreePath);
    return null;
  }

  // nodeId may contain ":", so encode it for safety
  const safeNodeId = encodeURIComponent(nodeId);

  // piosolutions/{stacks}/{nodeName}/{boardName}/{nodeId}.json
  return `${apiBaseUrl}/api/Files/piosolutions/${stacks}/${nodeName}/${boardName}/${safeNodeId}.json`;
}

/**
 * Poll your API for a PioSolutionDoc given a gametree path + board + node id.
 * Returns null if it never shows up in time.
 */
export async function pollForPioSolutionByGametree(
  apiBaseUrl: string,
  gametreePath: string,
  boardName: string,
  nodeId: string = "r:0",
  options?: { intervalMs?: number; maxAttempts?: number }
): Promise<PioSolutionDoc | null> {
  const intervalMs = options?.intervalMs ?? 8000;
  const maxAttempts = options?.maxAttempts ?? 20;
  const url = buildPioSolutionUrl(apiBaseUrl, gametreePath, boardName, nodeId);

  if (!url) return null;

  console.log(
    `🔎 Polling for Pio solution at ${url} (board=${boardName}, nodeId=${nodeId}, gametreePath=${gametreePath})`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.get<PioSolutionDoc>(url, {
        validateStatus: (status) => status === 200 || status === 404,
      });

      if (res.status === 200) {
        const doc = res.data;
        console.log(
          `✅ Pio solution ready for board ${boardName} (attempt ${attempt})`,
          doc
        );

        if (doc.root_169) {
          const { hand_classes, strategy, ev } = doc.root_169;
          console.log("🧩 root_169.hand_classes (169 keys):", hand_classes);
          console.log("🧩 root_169.strategy.actions:", strategy.actions);
          console.log(
            "🧩 root_169.strategy.matrix[0] (first action row, 169 cells):",
            strategy.matrix?.[0]
          );
          console.log("🧮 root_169.ev.oop:", ev.oop);
          console.log("🧮 root_169.ev.ip:", ev.ip);
        } else {
          console.log("ℹ️ No root_169 found on solution doc:", doc);
        }

        return doc;
      }

      console.log(
        `⏳ Solution not ready yet (HTTP ${res.status}) for board ${boardName}, attempt ${attempt}/${maxAttempts}`
      );
    } catch (err) {
      console.warn(
        `⚠️ Error polling for Pio solution (attempt ${attempt}/${maxAttempts})`,
        err
      );
    }

    await sleep(intervalMs);
  }

  console.warn(
    `⌛ Gave up waiting for solution JSON for board ${boardName} after ${maxAttempts} attempts`
  );
  return null;
}
