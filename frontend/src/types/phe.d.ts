// src/types/phe.d.ts
declare module "phe" {
  /** Evaluates 5, 6, or 7 card strings like "Ah","Kd". Lower score = stronger hand. */
  export function evaluateCards(cards: string[]): number;
  /** Same, but on numeric card codes: code = rank * 4 + suit, with
   *  rank 2=0 .. A=12 and suit s=0, h=1, d=2, c=3. */
  export function evaluateCardCodes(codes: number[]): number;
  export function rankCards(cards: string[]): number;
  /** Hand-strength number -> category number (index into rankDescription). */
  export function handRank(score: number): number;
  export const ranks: {
    STRAIGHT_FLUSH: number;
    FOUR_OF_A_KIND: number;
    FULL_HOUSE: number;
    FLUSH: number;
    STRAIGHT: number;
    THREE_OF_A_KIND: number;
    TWO_PAIR: number;
    ONE_PAIR: number;
    HIGH_CARD: number;
  };
  export const rankDescription: string[];
}
