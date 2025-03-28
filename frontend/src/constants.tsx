// Consider moving this to a shared helper file or ColorKey.tsx if desired.
export const actionToPrefixMap: Record<string, string> = {
    Fold: "0",
    ALLIN: "3",
    Min: "5",
    Call: "1",
    "15": "15",
    "14": "14",
    "40054": "40054",
    "40075": "40075",
    "40050": "40050",
    "40078": "40078",
    "21": "21",
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
};

  