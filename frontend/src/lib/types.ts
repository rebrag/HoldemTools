export type GameType = "texas-holdem" | "omaha4" | "omaha5";

export const gameLabel: Record<GameType, string> = {
  "texas-holdem": "NLH",
  "omaha4": "PLO4",
  "omaha5": "PLO5",
};

export interface EquityResult {
  p1Win: number;
  p2Win: number;
  ties: number;
  total: number;
  game: GameType;
}
