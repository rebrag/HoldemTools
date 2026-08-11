// src/bankroll/BankrollFormModal.tsx
import React from "react";
import type { User } from "firebase/auth";
import type { FormState, SessionDuration } from "./types";
import LoadingIndicator from "@/components/LoadingIndicator";
import SessionHandHistories, { type LocalHand } from "./SessionHandHistories";

interface Props {
  form: FormState;
  knownLocations: string[];
  knownGames: string[];
  autoProfit: number | null;
  sessionDuration: SessionDuration | null;
  canUseTimerControls: boolean;
  isTimerRunning: boolean;
  saving: boolean;
  editingId: string | null;
  user: User | null;
  draftHands: LocalHand[];
  onDraftHandsChange: (next: LocalHand[]) => void;
  onChange: (field: keyof FormState, value: string) => void;
  onLocationChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onGameChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onStartNow: () => void;
  onEndNow: () => void;
  onSave: () => void;
  onCancel: () => void;
  onMinimize: () => void;
  errorMessage?: string | null;
}

const BankrollFormModal: React.FC<Props> = ({
  form,
  knownLocations,
  knownGames,
  autoProfit,
  sessionDuration,
  canUseTimerControls,
  isTimerRunning,
  saving,
  editingId,
  user,
  draftHands,
  onDraftHandsChange,
  onChange,
  onLocationChange,
  onGameChange,
  onStartNow,
  onEndNow,
  onSave,
  onCancel,
  onMinimize,
  errorMessage,
}) => {
  const handleTimerClick = () => {
    if (isTimerRunning) {
      onEndNow();
    } else {
      onStartNow();
    }
  };

  return (
    // The hosting ResponsiveDrawer owns the panel chrome (background, border,
    // radius, padding) and the Close button; this renders only the form.
    <div className="relative">
      {/* 🔹 Centered spinner overlay while saving */}
      {saving && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60">
          <LoadingIndicator />
        </div>
      )}

      {/* pr-10 keeps the header clear of the drawer's absolute Close button */}
      <div className="mb-3 flex items-center justify-between gap-2 pr-10">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-100">
            {editingId ? "Edit Session" : "Add Session"}
          </h2>
          {editingId && (
            <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-[2px] text-[10px] font-medium text-slate-300">
              Editing existing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canUseTimerControls && (
            <button
              type="button"
              onClick={onMinimize}
              className="inline-flex items-center rounded-full border border-emerald-400/40 bg-white/5 px-3 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10 transition"
            >
              Minimize
            </button>
          )}
        </div>
      </div>

      {/* Row 1: Type + Start + End */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 w-[130px]">
          <label className="text-xs font-medium text-slate-300">Type</label>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 [&>option]:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.type}
            onChange={(e) => onChange("type", e.target.value)}
          >
            <option>Cash</option>
            <option>Tournament</option>
            <option>Other</option>
          </select>
        </div>

        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-300">Start</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.start}
            onChange={(e) => onChange("start", e.target.value)}
          />
        </div>

        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-300">End</label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.end}
            onChange={(e) => onChange("end", e.target.value)}
          />
        </div>
      </div>

      {/* Row 2: Location + Game + Buy-in + Cash-out */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 w-[180px]">
          <label className="text-xs font-medium text-slate-300">Location</label>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 [&>option]:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.location || ""}
            onChange={onLocationChange}
          >
            <option value="">Select location</option>
            {knownLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            <option value="__ht_add_location__">+ Add location…</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 w-[160px]">
          <label className="text-xs font-medium text-slate-300">Game</label>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-100 [&>option]:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.blinds || ""}
            onChange={onGameChange}
          >
            <option value="">Select game</option>
            {knownGames.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value="__ht_add_game__">＋ Add game…</option>
          </select>
        </div>

        <div className="flex-1 min-w-[120px] flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-300">Buy-in</label>
          <input
            type="tel"
            inputMode="decimal"
            pattern="[0-9]*"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-base sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.buyIn}
            onChange={(e) => onChange("buyIn", e.target.value)}
            placeholder="200"
          />
        </div>

        <div className="flex-1 min-w-[120px] flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-300">Cash-out</label>
          <input
            type="tel"
            inputMode="decimal"
            pattern="[0-9]*"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-base sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/60 transition"
            value={form.cashOut}
            onChange={(e) => onChange("cashOut", e.target.value)}
            placeholder="520"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/60 px-3 py-1.5 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}

      {/* Hand histories: saved session → server-backed; in-progress draft →
          held locally and attached when the session is saved. */}
      {editingId && user ? (
        <SessionHandHistories mode="session" user={user} sessionId={editingId} />
      ) : canUseTimerControls ? (
        <SessionHandHistories
          mode="draft"
          draftHands={draftHands}
          onDraftChange={onDraftHandsChange}
        />
      ) : null}

      {/* Footer: Timer / Net / Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            {canUseTimerControls && (
              <button
                type="button"
                onClick={handleTimerClick}
                className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold shadow-sm transition ${
                  isTimerRunning
                    ? "bg-rose-600 text-white hover:bg-rose-500"
                    : "bg-emerald-600 text-white hover:bg-emerald-500"
                }`}
              >
                {isTimerRunning ? "End / Save Session" : "Start Session"}
              </button>
            )}

            {sessionDuration && (
              <span className="text-xs font-medium text-slate-300">
                Duration: {sessionDuration.hours}:
                {String(sessionDuration.minutes).padStart(2, "0")}
              </span>
            )}

            {autoProfit !== null && (
              <span
                className={`text-xs font-medium ${
                  autoProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                Net: {autoProfit >= 0 ? "+" : "-"}$
                {Math.abs(autoProfit).toFixed(2)}
              </span>
            )}
          </div>

          {editingId && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200 text-left"
            >
              Discard changes
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* 🔻 Removed the inline "Updating…" / "Saving…" text + spinner */}
          {editingId && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-60 disabled:shadow-none"
            >
              Update Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BankrollFormModal;
