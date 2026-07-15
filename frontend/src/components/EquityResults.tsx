import React from "react";
import { EquityResult } from "../lib/types";
import CardRow from "./CardRow";

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "—");

interface Props {
  result: EquityResult | null;
  board: string;  // committed, sorted string (e.g., "Ah Kh Qd")
  p1: string;     // committed, sorted string
  p2: string;     // committed, sorted string
  barPct: { p1: number; tie: number; p2: number };
}

const EquityResults: React.FC<Props> = ({ result, board, p1, p2, barPct }) => {
  return (
    <div className="rounded-xl bg-white p-4 border border-gray-100">
      <h2 className="font-semibold mb-2">Results</h2>
      <div className="text-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">Board:</span>
          {board ? <CardRow cardsStr={board} size="md" ariaLabel="Board cards" /> : <em className="text-gray-400">— (preflop)</em>}
        </div>
        <div className="flex items-center justify-between">
          <span className="font-medium">Hand 1:</span>
          <CardRow cardsStr={p1} size="md" ariaLabel="Player 1 cards" />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-medium">Hand 2:</span>
          <CardRow cardsStr={p2} size="md" ariaLabel="Player 2 cards" />
        </div>

        <hr className="my-2" />

        {result ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Hand 1</span>
              <span className="font-medium">{pct(result.p1Win, result.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Hand 2</span>
              <span className="font-medium">{pct(result.p2Win, result.total)}</span>
            </div>
            <div className="flex items-center justify-between text-gray-600">
              <span>Tie</span>
              <span>{pct(result.ties, result.total)}</span>
            </div>

            {/* Animated stacked bar */}
            <div className="mt-2">
              <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-gray-200" role="img" aria-label="Win percentage bar">
                <div
                  className="h-full flex-none bg-emerald-600 transition-all duration-300 ease-out"
                  style={{ width: `${barPct.p1}%` }}
                  title={`Hand 1: ${barPct.p1.toFixed(2)}%`}
                />
                <div
                  className="h-full flex-none bg-gray-300 transition-all duration-300 ease-out"
                  style={{ width: `${barPct.tie}%` }}
                  title={`Tie: ${barPct.tie.toFixed(2)}%`}
                />
                <div
                  className="h-full flex-none bg-indigo-600 transition-all duration-300 ease-out"
                  style={{ width: `${barPct.p2}%` }}
                  title={`Hand 2: ${barPct.p2.toFixed(2)}%`}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-gray-600">
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600" />
                  <span>Hand 1</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-gray-300" />
                  <span>Tie</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-indigo-600" />
                  <span>Hand 2</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-gray-500">
            Preflop Monte-Carlo stops automatically when the Wilson CI half-width reaches the internal target.
          </p>
        )}
      </div>
    </div>
  );
};

export default EquityResults;
