/**
 * Return the canonical “root / 0 / 0.0 …” file-mapping for
 * each starting seat configuration (8 → 2 max).
 *
 * Keys are positions, values are the JSON file name that
 * represents the first node for that player in the tree.
 */
export function getInitialMapping(seats: number): Record<string, string> {
  switch (seats) {
    case 8: // SB BB UTG UTG1 LJ HJ CO BTN
      return {
        UTG:  "root.json",
        UTG1: "0.json",
        LJ:   "0.0.json",
        HJ:   "0.0.0.json",
        CO:   "0.0.0.0.json",
        BTN:  "0.0.0.0.0.json",
        SB:   "0.0.0.0.0.0.json",
        BB:   "0.0.0.0.0.0.1.json",
      };

    case 7: // SB BB UTG1 LJ HJ CO BTN
      return {
        UTG1: "root.json",
        LJ:   "0.json",
        HJ:   "0.0.json",
        CO:   "0.0.0.json",
        BTN:  "0.0.0.0.json",
        SB:   "0.0.0.0.0.json",
        BB:   "0.0.0.0.0.1.json",
      };

    case 6: // SB BB LJ HJ CO BTN
      return {
        LJ:  "root.json",
        HJ:  "0.json",
        CO:  "0.0.json",
        BTN: "0.0.0.json",
        SB:  "0.0.0.0.json",
        BB:  "0.0.0.0.1.json",
      };

    case 5: // SB BB HJ CO BTN
      return {
        HJ:  "root.json",
        CO:  "0.json",
        BTN: "0.0.json",
        SB:  "0.0.0.json",
        BB:  "0.0.0.1.json",
      };

    case 4: // SB BB CO BTN
      return {
        CO:  "root.json",
        BTN: "0.json",
        SB:  "0.0.json",
        BB:  "0.0.1.json",
      };

    case 3: // SB BB BTN
      return {
        BTN: "root.json",
        SB:  "0.json",
        BB:  "0.1.json",
      };

    case 2: // BTN BB (heads-up)
      return {
        BTN: "root.json",
        BB:  "1.json",
      };

    default:
      return {}; // fallback for unusual counts
  }
}
