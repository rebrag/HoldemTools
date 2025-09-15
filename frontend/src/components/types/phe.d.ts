// src/types/phe.d.ts
declare module "phe" {
  /** Lower score = stronger hand. Expects 7 card strings like "Ah","Kd"... */
  export function evaluateCards(cards: string[]): number;
  export function rankCards(cards: string[]): number;
  export const rankDescription: string[];
}
