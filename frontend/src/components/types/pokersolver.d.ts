declare module "pokersolver" {
  /** Minimal types for the bits we use. */
  export class Hand {
    /** Human name, e.g. "Flush" */
    name: string;
    /** Text description, e.g. "Flush, A High" */
    descr: string;
    /** Return the best hand from the provided cards (5..7 cards typical). */
    static solve(cards: string[]): Hand;
    /** Return the winner(s) from a list of solved hands. Tie => array of 2. */
    static winners(hands: Hand[]): Hand[];
  }

  export { Hand as PokerHand };
}
