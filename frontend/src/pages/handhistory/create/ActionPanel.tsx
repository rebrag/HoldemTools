// src/pages/handhistory/create/ActionPanel.tsx
import React, { useState } from "react";
import { fmtUnit, legalActions, type ActionKind, type Engine } from "./engine";

interface Props {
  engine: Engine;
  unitMode: "bb" | "chips";
  onAction: (kind: ActionKind, amountTo?: number) => void;
  onUndo: () => void;
  canUndo: boolean;
}

// Action button base (colors applied per-action). Uses the design-kit glass /
// emerald-slate-blue scheme.
const actionBtn =
  "rounded-lg px-3 py-3 text-sm font-bold uppercase tracking-wide text-white transition active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed";

// Pot-fraction quick sizings shown as pill buttons.
const POT_FRACTIONS: { f: number; label: string }[] = [
  { f: 0.25, label: "1/4" },
  { f: 0.5, label: "1/2" },
  { f: 0.75, label: "3/4" },
  { f: 1, label: "Pot" },
];

const ActionPanel: React.FC<Props> = ({ engine, unitMode, onAction, onUndo, canUndo }) => {
  const la = legalActions(engine);
  const player = engine.toAct != null ? engine.players[engine.toAct] : null;

  const [raiseTo, setRaiseTo] = useState<number | null>(null);
  const [activeFrac, setActiveFrac] = useState<number | null>(null);

  if (!la || !player) return null;

  const bb = engine.bb;
  const value = raiseTo ?? la.minRaiseTo;
  const callAmt = la.callAmount;
  const potAfterCall = engine.pot + callAmt;
  const isBet = la.canBet;

  const clamp = (v: number) => Math.max(la.minRaiseTo, Math.min(v, la.maxTo));
  const disp = (chips: number) => `${fmtUnit(chips, bb, unitMode)}${unitMode === "bb" ? " BB" : ""}`;
  const displayValue = unitMode === "chips" ? clamp(value) : Math.round((clamp(value) / bb) * 100) / 100;

  // A pot-fraction raise/bet "to" amount: call the current bet, then add a
  // fraction of the resulting pot. f = 1 is a full pot-sized bet/raise.
  const fracRaiseTo = (f: number) => clamp(engine.currentBet + f * potAfterCall);
  // Nudge step: one displayed unit (1 chip, or 1 BB worth of chips).
  const step = unitMode === "chips" ? 1 : bb;

  const setSize = (chips: number, frac: number | null) => {
    setRaiseTo(chips);
    setActiveFrac(frac);
  };

  const submitAggressive = () => {
    const to = clamp(value);
    if (to >= la.maxTo) onAction("allin");
    else onAction(isBet ? "bet" : "raise", to);
    setSize(la.minRaiseTo, null);
    setRaiseTo(null);
  };

  return (
    <div className="mt-3 rounded-2xl border border-hairline bg-surface/60 p-3 text-white shadow-lg backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-emerald-200">
          {player.name}
          <span className="ml-1 text-emerald-100/60">({player.pos})</span>
        </span>
        <span className="text-emerald-100/70">
          Stack {disp(player.stack)} · Pot {disp(engine.pot)}
          {callAmt > 0 && <> · To call {disp(callAmt)}</>}
        </span>
      </div>

      {/* Raise/bet sizing: pot-fraction pills, a value readout, and +/- nudgers */}
      {(la.canBet || la.canRaise) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <div className="flex gap-1">
            {POT_FRACTIONS.map(({ f, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setSize(fracRaiseTo(f), f)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  activeFrac === f
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-white/5 text-emerald-100/80 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="tel"
            inputMode="decimal"
            value={displayValue}
            onChange={(e) => {
              const raw = Number(e.target.value);
              setSize(unitMode === "chips" ? raw : raw * bb, null);
            }}
            className="w-20 min-w-0 flex-1 rounded-md border border-hairline bg-slate-800/70 px-2 py-1 text-center text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSize(clamp(value - step), null)}
              aria-label="Decrease"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-lg font-bold leading-none text-emerald-100 hover:bg-white/10 active:translate-y-[1px]"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setSize(clamp(value + step), null)}
              aria-label="Increase"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-lg font-bold leading-none text-emerald-100 hover:bg-white/10 active:translate-y-[1px]"
            >
              +
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onAction("fold")}
          className={`${actionBtn} bg-rose-600 hover:bg-rose-500`}
        >
          Fold
        </button>
        {la.canCheck ? (
          <button
            type="button"
            onClick={() => onAction("check")}
            className={`${actionBtn} bg-slate-600 hover:bg-slate-500`}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            disabled={!la.canCall}
            onClick={() => onAction("call")}
            className={`${actionBtn} bg-blue-600 hover:bg-blue-500`}
          >
            Call
            <span className="block text-[11px] font-semibold normal-case tracking-normal opacity-90">
              {disp(callAmt)}
            </span>
          </button>
        )}
        <button
          type="button"
          disabled={!la.canBet && !la.canRaise}
          onClick={submitAggressive}
          className={`${actionBtn} bg-emerald-600 hover:bg-emerald-500 hover:shadow-glow`}
        >
          {isBet ? "Bet" : "Raise"}
          {(la.canBet || la.canRaise) && (
            <span className="block text-[11px] font-semibold normal-case tracking-normal opacity-90">
              {disp(clamp(value))}
            </span>
          )}
        </button>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-white/10 active:translate-y-[1px] disabled:opacity-40"
        >
          ↩ Undo
        </button>
      </div>
    </div>
  );
};

export default ActionPanel;
