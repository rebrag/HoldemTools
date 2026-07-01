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
  const potRaiseTo = Math.min(engine.currentBet + potAfterCall, la.maxTo);
  const isBet = la.canBet;

  const clamp = (v: number) => Math.max(la.minRaiseTo, Math.min(v, la.maxTo));
  const disp = (chips: number) => `${fmtUnit(chips, bb, unitMode)}${unitMode === "bb" ? " BB" : ""}`;
  const displayValue = unitMode === "chips" ? clamp(value) : Math.round((clamp(value) / bb) * 100) / 100;

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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="tel"
            inputMode="decimal"
            value={displayValue}
            onChange={(e) => {
              const raw = Number(e.target.value);
              setRaiseTo(unitMode === "chips" ? raw : raw * bb);
            }}
            className="w-24 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <span className="text-[11px] text-emerald-100/60">
            {unitMode === "chips" ? "chips (to)" : "BB (to)"}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => setRaiseTo(la.minRaiseTo)}
              className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-600"
            >
              Min
            </button>
            <button
              type="button"
              onClick={() => setRaiseTo(clamp(potRaiseTo))}
              className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-600"
            >
              Pot
            </button>
            <button
              type="button"
              onClick={() => onAction("allin")}
              className="rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold hover:bg-amber-500"
            >
              All-in {disp(la.maxTo)}
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          className="text-[11px] text-emerald-200/80 underline underline-offset-2 hover:text-white disabled:opacity-40"
        >
          ↩ Undo
        </button>
      </div>
    </div>
  );
};

export default ActionPanel;
