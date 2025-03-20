export interface HandData {
  [hand: string]: [number, number];
}

export interface JsonData {
  Position: string;
  bb: number;
  // All other keys (like "Fold", "Call", etc.) will be action data.
  [action: string]: string | number | HandData;
}

export interface HandCellData {
  hand: string;
  actions: Record<string, number>;
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

const actionColorMapping: Record<string, string> = {
  Fold: "#3d7cb8",
  ALLIN: "#7d1f1e",
  Min: "#F03c3c",
  Call: "#5ab964",
  // Add more known mappings if needed.
};

export const getColorForAction = (action: string): string => {
  return actionColorMapping[action] || "#F03c39";
};

export const combineDataByHand = (data: JsonData): HandCellData[] => {
  const combined: { [hand: string]: HandCellData } = {};

  for (const key in data) {
    if (key === "Position" || key === "bb") continue;

    const actionData = data[key];
    if (typeof actionData === "object" && actionData !== null) {
      for (const hand in actionData) {
        const value = actionData[hand];
        if (Array.isArray(value)) {
          const [strategy] = value;
          if (!combined[hand]) {
            combined[hand] = { hand, actions: {} };
          }
          combined[hand].actions[key] = strategy;
        }
      }
    }
  }
  return Object.values(combined);
};

