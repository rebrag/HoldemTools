// src/types/poker-hand-evaluator-wasm.d.ts  (or wherever yours lives)
declare module "poker-hand-evaluator-wasm" {
  export interface HandRank {
    value: number;
    category: number;
    categoryName(): string;
    toString(): string;
  }
  interface PHE {
    isReady(): boolean;
    ready(): Promise<void>; // ← was Promise<any>
    evaluate(cards: string[]): HandRank;
    evaluate5(a: string, b: string, c: string, d: string, e: string): HandRank;
    evaluate6(a: string, b: string, c: string, d: string, e: string, f: string): HandRank;
    evaluate7(a: string, b: string, c: string, d: string, e: string, f: string, g: string): HandRank;
    evaluateOmaha(
      b1: string, b2: string, b3: string, b4: string, b5: string,
      h1: string, h2: string, h3: string, h4: string
    ): HandRank;
  }
  const PHEvaluator: PHE;
  export default PHEvaluator;
}
