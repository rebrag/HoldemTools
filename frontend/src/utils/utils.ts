// src/utils/utils.ts

export interface HandData {
  [hand: string]: [number, number]; // [strategyWeight, EV]
}

export interface JsonData {
  Position: string;
  bb: number;
  // All other keys (like "Fold", "Call", etc.) will be action data.
  [action: string]: string | number | HandData;
}

// Extend HandCellData to carry both strategy and EVs
export interface HandCellData {
  hand: string;
  actions: Record<string, number>;
  evs: Record<string, number>;
}

// Generate a consistent color from a string using a hash function.
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).substr(-2);
  }
  return color;
}

// src/utils/utils.ts

// ...keep your existing interfaces above...

// ---- Action colors ----

// Base colors for *buckets* (ALLIN, UNKNOWN, Min, Call, Fold).
// We’ll map raw actions like "c" or "check" into one of these buckets in HandCell.
const actionColorMapping: Record<string, string> = {
  ALLIN: "#7d1f1e",
  UNKNOWN: "#C14c39", // single-unknown color
  Min: "#F03c3c",
  Call: "#5ab964",
  c: "#5ab964",
  Check: "#5ab964",
  Fold: "#3d7cb8",
};

// Used when there are multiple distinct unknown actions in a cell.
export const UNKNOWN_MULTI_COLOR = "#F2733c"; // pick whatever you like

export const getColorForAction = (action: string): string => {
  return actionColorMapping[action] ?? "#C14c39";
};


// Combine JsonData into an array of HandCellData objects,
// extracting both strategy weights and EV values per action.
export const combineDataByHand = (data: JsonData): HandCellData[] => {
  const combined: Record<string, HandCellData> = {};

  for (const key in data) {
    if (key === "Position" || key === "bb") continue;

    const actionData = data[key] as HandData;
    if (typeof actionData === "object" && actionData !== null) {
      for (const hand in actionData) {
        const [strategyWeight, evValue] = actionData[hand];

        // normalize action keys
        const actionKey = key === "c" ? "Call" : key;

        if (!combined[hand]) {
          combined[hand] = { hand, actions: {}, evs: {} };
        }

        combined[hand].actions[actionKey] = strategyWeight;
        combined[hand].evs[actionKey] = evValue;
      }
    }
  }

  return Object.values(combined);
};

