// src/pages/handhistory/advanced/ActionPanel.tsx
import React, { useState } from "react";
import { fmtUnit, legalActions, type ActionKind, type Engine } from "./engine";

interface Props {
  engine: Engine;
  unitMode: "bb" | "chips";
  onAction: (kind: ActionKind, amountTo?: number) => void;
  onUndo: () => void;
  canUndo: boolean;
}

const btn =
  "rounded-lg px-3 py-2.5 text-sm font-semibold transition active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed";

const ActionPanel: React.FC<Props> = ({ engine, unitMode, onAction, onUndo, canUndo }) => {
  const la = legalActions(engine);
  const player = engine.toAct != null ? engine.players[engine.toAct] : null;

  const [raiseTo, setRaiseTo] = useState<number | null>(null);

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

  const submitAggressive = () => {
    const to = clamp(value);
    if (to >= la.maxTo) onAction("allin");
    else onAction(isBet ? "bet" : "raise", to);
    setRaiseTo(null);
  };

  return (
    <div className="mt-3 rounded-2xl border border-emerald-300/40 bg-slate-900/70 p-3 text-white backdrop-blur-sm">
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

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onAction("fold")}
          className={`${btn} bg-rose-600 text-white hover:bg-rose-500`}
        >
          Fold
        </button>
        {la.canCheck ? (
          <button
            type="button"
            onClick={() => onAction("check")}
            className={`${btn} bg-slate-600 text-white hover:bg-slate-500`}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            disabled={!la.canCall}
            onClick={() => onAction("call")}
            className={`${btn} bg-sky-600 text-white hover:bg-sky-500`}
          >
            Call {disp(callAmt)}
          </button>
        )}
        <button
          type="button"
          disabled={!la.canBet && !la.canRaise}
          onClick={submitAggressive}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
        >
          {isBet ? "Bet" : "Raise to"} {disp(clamp(value))}
        </button>
      </div>

      {/* Raise/bet sizing */}
      {(la.canBet || la.canRaise) && (
        <>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRaiseTo(clamp(value - step))}
              aria-label="Decrease by one"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-700 text-lg font-bold leading-none hover:bg-slate-600 active:translate-y-[1px]"
            >
              −
            </button>
            <input
              type="tel"
              inputMode="decimal"
              value={displayValue}
              onChange={(e) => {
                const raw = Number(e.target.value);
                setRaiseTo(unitMode === "chips" ? raw : raw * bb);
              }}
              className="w-full min-w-0 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={() => setRaiseTo(clamp(value + step))}
              aria-label="Increase by one"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-700 text-lg font-bold leading-none hover:bg-slate-600 active:translate-y-[1px]"
            >
              +
            </button>
            <span className="shrink-0 text-[11px] text-emerald-100/60">
              {unitMode === "chips" ? "chips" : "BB"}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            <button
              type="button"
              onClick={() => setRaiseTo(la.minRaiseTo)}
              className="rounded-md bg-slate-700 px-2 py-1.5 text-[11px] font-medium hover:bg-slate-600"
            >
              Min
            </button>
            <button
              type="button"
              onClick={() => setRaiseTo(fracRaiseTo(1 / 3))}
              className="rounded-md bg-slate-700 px-2 py-1.5 text-[11px] font-medium hover:bg-slate-600"
            >
              ⅓ Pot
            </button>
            <button
              type="button"
              onClick={() => setRaiseTo(fracRaiseTo(1 / 2))}
              className="rounded-md bg-slate-700 px-2 py-1.5 text-[11px] font-medium hover:bg-slate-600"
            >
              ½ Pot
            </button>
            <button
              type="button"
              onClick={() => setRaiseTo(fracRaiseTo(3 / 4))}
              className="rounded-md bg-slate-700 px-2 py-1.5 text-[11px] font-medium hover:bg-slate-600"
            >
              ¾ Pot
            </button>
            <button
              type="button"
              onClick={() => setRaiseTo(fracRaiseTo(1))}
              className="rounded-md bg-slate-700 px-2 py-1.5 text-[11px] font-medium hover:bg-slate-600"
            >
              Pot
            </button>
            <button
              type="button"
              onClick={() => onAction("allin")}
              className="rounded-md bg-amber-600 px-2 py-1.5 text-[11px] font-semibold hover:bg-amber-500"
            >
              All-in
            </button>
          </div>
        </>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-slate-600 active:translate-y-[1px] disabled:opacity-40"
        >
          ↩ Undo
        </button>
      </div>
    </div>
  );
};

export default ActionPanel;
