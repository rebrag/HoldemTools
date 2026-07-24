// src/lib/postflopClient.ts
import type { JsonData } from "@/lib/solver/utils";

export type PioSolutionDoc = {
  board: string;
  created_utc: string;
  position?: "IP" | "OOP";
  hero_pos?: string | null;
  bb?: number | null;
  node_type?: "root" | "check" | "node";
  node_id?: string | null; // e.g. "r:0" or "r:0:1"
  node_suffix?: string | null; // e.g. "r.0" or "r.0.1"

  // v2 fields (schema 2 docs; absent on legacy docs)
  schema?: number;
  street?: "flop" | "turn" | "river";
  parent_id?: string | null;
  children?: Record<string, string>; // pio action label -> child node id
  pio_node_type?: string; // OOP_DEC | IP_DEC | SPLIT_NODE | terminal
  pot?: number[] | null; // [oop_chips, ip_chips, pot_chips]

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
