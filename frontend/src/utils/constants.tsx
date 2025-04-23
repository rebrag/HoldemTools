// utils/constants.ts
//import { getColorForAction } from "./utils";

// Consider moving this to a shared helper file or ColorKey.tsx if desired.
export const actionToNumberMap: Record<string, string> = {
    Fold: "0",
    ALLIN: "3",
    Min: "5",
    Call: "1",
    "Raise 54%": "40054",
    "Raise 75%": "40075",
    "Raise 50%": "40050",
    "Raise 78%": "40078",
    "Raise 1.5bb": "14",
    "Raise 2bb": "15",
    "Raise 4bb": "19",
    "Raise 3.5bb": "18",
    "Raise 5bb": "21",
  };

  export const numberToActionMap: Record<string, string> = {
    40054: "Raise 54%",
    40075: "Raise 75%",
    40050: "Raise 50%",
    40078: "Raise 78",
    3: "ALLIN",
    21: "Raise 5bb",
    19: "Raise 4bb",
    18: "Raise 3.5bb",
    17: "Raise 3bb",
    15: "Raise 2bb",
    14: "Raise 1.5bb",
    0: "Fold",
    5: "Min",
    1: "Call"
  };

  export const actionToPrefixMap2: Record<string, string> = {
    Min: "Min",
    Call: "Call",
    "15": "Raise 2bb",
    "14": "Raise 1.5bb",
    "40054": "Raise 54%",
    "40075": "Raise 75%",
    "40050": "Raise 50%",
    "40078": "Raise 78%",
    "21": "21",
    "19": "Raise 4bb",
};


// src/utils/constants.ts
export type Action = "ALLIN" | "Min" | "Call" | "Fold" | "UNKNOWN";

export const ALL_ACTIONS: Action[] = ["ALLIN", "UNKNOWN", "Min", "Call", "Fold"];

export const actionColorMapping: Record<string, string> = {
  ALLIN: "#7d1f1e",
  Min: "#F03c3c",
  Call: "#5ab964",
  Fold: "#3d7cb8",
  // Unknown actions default to:
};

export const ALL_COLORS: string[] = [
  "#7d1f1e", // ALLIN
  "#C14c39", // UNKNOWN
  "#F03c3c", // Min
  "#5ab964", // Call
  "#3d7cb8"  // Fold
];

