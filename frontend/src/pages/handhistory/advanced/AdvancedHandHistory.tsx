// src/pages/handhistory/advanced/AdvancedHandHistory.tsx
// Visual hand recorder. Setup phase: build the table (seats, cards, blinds).
// Action phase: a client-side betting engine steps through each player's
// action; on completion the hand is serialized to a plain-text string.
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import PlayingCard from "@/components/PlayingCard";
import CopyButton from "@/components/CopyButton";
import { authedFetch } from "@/lib/api";
import SeatEditorModal from "./SeatEditorModal";
import BoardEditorModal from "./BoardEditorModal";
import ActionPanel from "./ActionPanel";
import { positionLabels, seatCoords } from "./positions";
import {
  applyAction,
  buildEngine,
  fmtUnit,
  revealedBoardCount,
  setWinners,
  STREET_NAMES,
  type ActionKind,
  type Engine,
} from "./engine";
import { serializeHand } from "./serialize";
import {
  createInitialState,
  resizeSeats,
  usedCards,
  type AdvancedHandState,
  type Seat,
} from "./types";

interface Props {
  user: User | null;
}

const TABLE_SIZES = [9, 8, 7, 6, 5, 4, 3, 2];

const inputCls =
  "w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition";

const CardBack: React.FC<{ w?: number }> = ({ w = 22 }) => (
  <div
    className="aspect-[3/4] rounded-[4px] border border-rose-900/50 bg-gradient-to-br from-rose-600 to-rose-800 shadow-sm"
    style={{ width: w }}
    aria-hidden="true"
  />
);

const AdvancedHandHistory: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const [state, setState] = useState<AdvancedHandState>(() => createInitialState());
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  const [editingBoard, setEditingBoard] = useState(false);
  const [editingBoard2, setEditingBoard2] = useState(false);
  const [phase, setPhase] = useState<"setup" | "action">("setup");

  const [engine, setEngine] = useState<Engine | null>(null);
  const [history, setHistory] = useState<Engine[]>([]);
  const [winnerSel, setWinnerSel] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [unitMode, setUnitMode] = useState<"bb" | "chips">("bb");

  const labels = useMemo(
    () => positionLabels(state.tableSize, state.buttonSeat),
    [state.tableSize, state.buttonSeat]
  );
  const coords = useMemo(() => seatCoords(state.tableSize), [state.tableSize]);

  const occupiedCount = state.seats.filter((s) => s.occupied).length;

  const serialized = useMemo(
    () => (engine && engine.done && engine.winners ? serializeHand(state, engine) : ""),
    [engine, state]
  );

  const update = (partial: Partial<AdvancedHandState>) =>
    setState((prev) => ({ ...prev, ...partial }));

  const onTableSizeChange = (size: number) =>
    setState((prev) => ({
      ...prev,
      tableSize: size,
      seats: resizeSeats(prev.seats, size),
      buttonSeat: Math.min(prev.buttonSeat, size - 1),
      heroSeat: Math.min(prev.heroSeat, size - 1),
    }));

  const saveSeat = (index: number, seat: Seat, makeButton: boolean, makeHero: boolean) => {
    setState((prev) => ({
      ...prev,
      seats: prev.seats.map((s, i) => (i === index ? seat : s)),
      buttonSeat: makeButton ? index : prev.buttonSeat,
      heroSeat: makeHero ? index : prev.heroSeat,
    }));
    setEditingSeat(null);
  };

  const reset = () => {
    setState(createInitialState(state.tableSize));
    setEngine(null);
    setHistory([]);
    setPhase("setup");
  };

  const start = () => {
    if (occupiedCount < 2) return;
    setEngine(buildEngine(state));
    setHistory([]);
    setWinnerSel([]);
    setPhase("action");
  };

  const act = (kind: ActionKind, amountTo?: number) => {
    if (!engine) return;
    setHistory((h) => [...h, engine]);
    setEngine(applyAction(engine, kind, amountTo));
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setEngine(prev);
      return h.slice(0, -1);
    });
  };

  const confirmWinners = () => {
    if (!engine || winnerSel.length === 0) return;
    const board = engine.winners === null ? 1 : 2;
    setEngine(setWinners(engine, winnerSel, board));
    setWinnerSel([]);
  };

  const saveHand = async () => {
    if (!serialized) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch("/api/handhistory", {
        method: "POST",
        body: JSON.stringify({ rawText: serialized, sessionId: null }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      navigate("/hand-history");
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-20 pb-12">
        <h1 className="text-xl font-semibold text-white">Advanced Hand History</h1>
        <p className="mt-3 text-sm text-emerald-100/80">
          Sign in to record hand histories.
        </p>
      </div>
    );
  }

  const revealCount = engine ? revealedBoardCount(engine.street) : 0;
  const needWinner =
    !!engine &&
    engine.done &&
    (engine.winners === null || (engine.numBoards === 2 && engine.winners2 === null));
  const winnerBoard: 1 | 2 = engine && engine.winners === null ? 1 : 2;
  const complete =
    !!engine &&
    engine.done &&
    !!engine.winners &&
    (engine.numBoards === 1 || !!engine.winners2);

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-16">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/hand-history")}
          className="text-sm text-emerald-200 hover:text-white transition"
        >
          ← Hand Histories
        </button>
        <h1 className="text-lg font-semibold text-white">Hand Recorder</h1>
        <span className="w-[110px]" />
      </div>

      {/* ───────── Table ───────── */}
      <div className="rounded-3xl bg-slate-950/70 p-2 shadow-2xl shadow-emerald-900/40">
        <div className="rounded-[40px] bg-gradient-to-b from-slate-800 to-slate-900 p-2">
          <div className="relative mx-auto aspect-[4/5] w-full max-w-sm">
            {/* felt */}
            <div
              className="absolute inset-[6%] rounded-[46%] ring-4 ring-slate-950/60"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 42%, #0e7490 0%, #0c5566 55%, #083344 100%)",
                boxShadow: "inset 0 6px 30px rgba(0,0,0,0.45)",
              }}
            />

            {/* center: pot / street / board */}
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
              {engine ? (
                <span className="rounded-full bg-black/50 px-3 py-0.5 text-[11px] font-semibold text-white">
                  {STREET_NAMES[engine.street]} · Pot {fmtUnit(engine.pot, engine.bb, unitMode)}
                  {unitMode === "bb" ? " BB" : ""}
                </span>
              ) : (
                <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/80">
                  Tap a card to edit
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditingBoard(true)}
                className="flex gap-1"
                aria-label="Edit board"
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const revealed = !engine || i < revealCount;
                  const c = state.board[i];
                  return revealed && c ? (
                    <PlayingCard key={i} code={c} size="sm" width={26} />
                  ) : (
                    <CardBack key={i} w={26} />
                  );
                })}
              </button>
              {state.numBoards === 2 && (
                <button
                  type="button"
                  onClick={() => setEditingBoard2(true)}
                  className="flex gap-1"
                  aria-label="Edit board 2"
                >
                  {[0, 1, 2, 3, 4].map((i) => {
                    const revealed = !engine || i < revealCount;
                    const c = state.board2[i];
                    return revealed && c ? (
                      <PlayingCard key={i} code={c} size="sm" width={22} />
                    ) : (
                      <CardBack key={i} w={22} />
                    );
                  })}
                </button>
              )}
              <span className="text-[9px] font-semibold uppercase tracking-widest text-white/25">
                HoldemTools
              </span>
            </div>

            {/* seats */}
            {Array.from({ length: state.tableSize }, (_, i) => {
              const seat = state.seats[i];
              const coord = coords[i];
              const label = seat.name.trim() || labels[i];
              const isButton = state.buttonSeat === i;
              const isHero = state.heroSeat === i;

              // Live engine info for this seat (action phase)
              const ep = engine?.players.find((p) => p.seat === i) ?? null;
              const isActive = !!engine && engine.toAct != null && engine.players[engine.toAct]?.seat === i;
              const folded = ep?.folded ?? false;
              const stackText = ep
                ? `${fmtUnit(ep.stack, engine!.bb, unitMode)}${unitMode === "bb" ? " BB" : ""}`
                : seat.stack.trim();
              const committed = ep?.committed ?? 0;

              if (engine && !ep) return null; // seat empty during a hand

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => phase === "setup" && setEditingSeat(i)}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${
                    phase === "setup" ? "cursor-pointer" : "cursor-default"
                  } ${folded ? "opacity-40 grayscale" : ""}`}
                  style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
                  aria-label={`Seat ${label}`}
                >
                  <div className="relative flex gap-0.5">
                    {[0, 1].map((h) =>
                      seat.holeCards[h] ? (
                        <PlayingCard key={h} code={seat.holeCards[h]!} size="sm" width={22} />
                      ) : (
                        <CardBack key={h} w={22} />
                      )
                    )}
                    {isButton && (
                      <span className="absolute -right-3 -bottom-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-gray-800 shadow ring-1 ring-gray-300">
                        D
                      </span>
                    )}
                  </div>
                  <span
                    className={`max-w-[80px] truncate rounded px-1.5 py-[1px] text-[10px] font-semibold ring-1 ${
                      isActive
                        ? "bg-emerald-500 text-white ring-emerald-200"
                        : isHero
                        ? "bg-amber-500/90 text-white ring-amber-200"
                        : "bg-slate-900/80 text-sky-100 ring-slate-700"
                    }`}
                  >
                    {label}
                  </span>
                  {stackText && (
                    <span className="rounded bg-black/50 px-1.5 text-[10px] font-semibold text-emerald-100">
                      {stackText}
                    </span>
                  )}
                  {committed > 0 && (
                    <span className="mt-0.5 rounded-full bg-amber-400/90 px-1.5 text-[9px] font-bold text-amber-950">
                      {fmtUnit(committed, engine!.bb, unitMode)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ───────── Action phase ───────── */}
      {phase === "action" && engine && (
        <>
          {!engine.done && (
            <>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setUnitMode((u) => (u === "bb" ? "chips" : "bb"))}
                  className="rounded-full border border-emerald-300/40 bg-slate-900/70 px-3 py-1 text-[11px] font-medium text-emerald-100 transition hover:bg-slate-800 active:scale-95"
                >
                  Show in {unitMode === "bb" ? "chip amounts" : "BB"}
                </button>
              </div>
              <ActionPanel
                engine={engine}
                unitMode={unitMode}
                onAction={act}
                onUndo={undo}
                canUndo={history.length > 0}
              />
            </>
          )}

          {needWinner && (
            <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-950/40 p-3 text-sm text-amber-100">
              <p className="mb-2 font-semibold">
                Showdown — who won?
                {engine.numBoards === 2 && <span className="ml-1 text-amber-200/80">(Board {winnerBoard})</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {engine.players.map((p, i) =>
                  p.folded ? null : (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setWinnerSel((sel) =>
                          sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]
                        )
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                        winnerSel.includes(i)
                          ? "bg-emerald-500 text-white ring-emerald-300"
                          : "bg-slate-800 text-slate-200 ring-slate-600 hover:bg-slate-700"
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                )}
              </div>
              <button
                type="button"
                disabled={winnerSel.length === 0}
                onClick={confirmWinners}
                className="mt-3 inline-flex rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirm winner{winnerSel.length > 1 ? "s (split)" : ""}
              </button>
            </div>
          )}

          {complete && (
            <div className="mt-3 rounded-2xl border border-emerald-300/40 bg-white/95 p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Hand history</h3>
                <CopyButton
                  text={serialized}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                />
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800">
                {serialized}
              </pre>
              {saveError && (
                <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                  {saveError}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                >
                  Record another
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveHand}
                  className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save hand history"}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setEngine(null);
              setPhase("setup");
            }}
            className="mt-3 text-xs text-emerald-200/80 underline underline-offset-2 hover:text-white"
          >
            ← Back to setup
          </button>
        </>
      )}

      {/* ───────── Setup phase: config form ───────── */}
      {phase === "setup" && (
        <div className="mt-4 rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-lg shadow-emerald-500/20 backdrop-blur-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table size">
              <select
                className={inputCls}
                value={state.tableSize}
                onChange={(e) => onTableSizeChange(Number(e.target.value))}
              >
                {TABLE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} Players
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Game">
              <select className={inputCls} value={state.game} onChange={(e) => update({ game: e.target.value })}>
                <option>Holdem</option>
                <option>PLO</option>
                <option>PLO5</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Small blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.smallBlind} onChange={(e) => update({ smallBlind: e.target.value })} />
            </Field>
            <Field label="Big blind">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.bigBlind} onChange={(e) => update({ bigBlind: e.target.value })} />
            </Field>
            <Field label="Ante (per player)">
              <input type="tel" inputMode="decimal" className={inputCls} value={state.ante} onChange={(e) => update({ ante: e.target.value })} />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Straddle seat">
              <select
                className={inputCls}
                value={state.straddleSeat ?? ""}
                onChange={(e) =>
                  update({ straddleSeat: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">None</option>
                {state.seats.map((seat, i) =>
                  seat.occupied && labels[i] !== "BB" ? (
                    <option key={i} value={i}>
                      {seat.name.trim() || labels[i]}
                    </option>
                  ) : null
                )}
              </select>
            </Field>
            <Field label="Straddle amount">
              <input
                type="tel"
                inputMode="decimal"
                className={inputCls}
                disabled={state.straddleSeat === null}
                value={state.straddleAmount}
                onChange={(e) => update({ straddleAmount: e.target.value })}
              />
            </Field>
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={state.numBoards === 2}
              onChange={(e) => update({ numBoards: e.target.checked ? 2 : 1 })}
            />
            Run it twice (2 boards)
          </label>

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">Comment</label>
            <textarea
              rows={2}
              className={`${inputCls} resize-y`}
              value={state.comment}
              onChange={(e) => update({ comment: e.target.value })}
              placeholder="Optional note about this hand…"
            />
          </div>

          <p className="mt-3 text-[11px] text-gray-500">
            Tap each seat to set its name, stack, and hole cards. Mark the dealer
            button and your own seat (hero). Then press Start to record the action.
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 transition"
            >
              ⟲ Reset
            </button>
            <button
              type="button"
              disabled={occupiedCount < 2}
              onClick={start}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-6 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-50"
            >
              ▷ Start
            </button>
          </div>
        </div>
      )}

      {editingSeat !== null && (
        <SeatEditorModal
          positionLabel={labels[editingSeat]}
          seat={state.seats[editingSeat]}
          isButton={state.buttonSeat === editingSeat}
          isHero={state.heroSeat === editingSeat}
          otherUsed={usedCards(state, state.seats[editingSeat].holeCards)}
          onSave={(seat, makeButton, makeHero) =>
            saveSeat(editingSeat, seat, makeButton, makeHero)
          }
          onClose={() => setEditingSeat(null)}
        />
      )}

      {editingBoard && (
        <BoardEditorModal
          board={state.board}
          otherUsed={usedCards(state, state.board)}
          onSave={(board) => {
            update({ board });
            setEditingBoard(false);
          }}
          onClose={() => setEditingBoard(false)}
        />
      )}

      {editingBoard2 && (
        <BoardEditorModal
          board={state.board2}
          otherUsed={usedCards(state, state.board2)}
          onSave={(board2) => {
            update({ board2 });
            setEditingBoard2(false);
          }}
          onClose={() => setEditingBoard2(false)}
        />
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium text-gray-700">{label}</label>
    {children}
  </div>
);

export default AdvancedHandHistory;
