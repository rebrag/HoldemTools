declare module "pokersolver" {
  export class Hand {
    static solve(cards: string[], game?: string): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    rank: number;
  }
}
