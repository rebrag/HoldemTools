// utils.ts
export type FileData = Record<string, Record<string, [number, number]>>;

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

// Predefined color mappings for known actions.
const actionColorMapping: Record<string, string> = {
  Fold: "lightblue",
  ALLIN: "red",
  Min: "lightcoral",
  Call: "lightgreen",
  // Add more known mappings if needed.
};

export const getColorForAction = (action: string): string => {
  return actionColorMapping[action] || stringToColor(action);
};

// Combines API data into grid data.
export const combineDataByHand = (data: FileData): HandCellData[] => {
  const combined: { [hand: string]: HandCellData } = {};
  for (const action in data) {
    const actionData = data[action];
    for (const hand in actionData) {
      const [strategy] = actionData[hand];
      if (!combined[hand]) {
        combined[hand] = { hand, actions: {} };
      }
      combined[hand].actions[action] = strategy;
    }
  }
  return Object.values(combined);
};
