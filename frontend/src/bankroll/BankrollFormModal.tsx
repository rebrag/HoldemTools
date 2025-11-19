// src/bankroll/BankrollFormModal.tsx
import React from "react";
import type { FormState, SessionDuration } from "./types";
import LoadingIndicator from "../components/LoadingIndicator";

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
  onChange: (field: keyof FormState, value: string) => void;
  onLocationChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onGameChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onStartNow: () => void;
  onEndNow: () => void;
  onSave: () => void;
  onCancel: () => void;
  onMinimize: () => void;
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
  onChange,
  onLocationChange,
  onGameChange,
  onStartNow,
  onEndNow,
  onSave,
  onCancel,
  onMinimize,
}) => {
  const handleTimerClick = () => {
    if (isTimerRunning) {
      onEndNow();
    } else {
      onStartNow();
    }
  };

  return (
    <div className="relative rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-2xl shadow-emerald-500/30 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            {editingId ? "Edit Session" : "Add Session"}
          </h2>
          {editingId && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-[2px] text-[10px] font-medium text-gray-600">
              Editing existing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canUseTimerControls && (
            <button
              type="button"
              onClick={onMinimize}
              className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 transition"
            >
              Minimize
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
            aria-label="Close"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>
      </div>

      {/* Row 1: Type + Start + End */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 w-[130px]">
          <label className="text-xs font-medium text-gray-700">
            Type
          </label>
          <select
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.type}
            onChange={(e) => onChange("type", e.target.value)}
          >
            <option>Cash</option>
            <option>Tournament</option>
            <option>Other</option>
          </select>
        </div>

        <div className="flex-1 min-w-[180px] flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">
            Start
          </label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.start}
            onChange={(e) => onChange("start", e.target.value)}
          />
        </div>

        <div className="flex-1 min-w-[180px] flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">
            End
          </label>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.end}
            onChange={(e) => onChange("end", e.target.value)}
          />
        </div>
      </div>

      {/* Row 2: Location + Game + Buy-in + Cash-out */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 w-[180px]">
          <label className="text-xs font-medium text-gray-700">
            Location
          </label>
          <select
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.location || ""}
            onChange={onLocationChange}
          >
            <option value="">Select location</option>
            {knownLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            <option value="__ht_add_location__">＋ Add location…</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 w-[160px]">
          <label className="text-xs font-medium text-gray-700">
            Game
          </label>
          <select
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
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
          <label className="text-xs font-medium text-gray-700">
            Buy-in
          </label>
          <input
            type="number"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.buyIn}
            onChange={(e) => onChange("buyIn", e.target.value)}
            placeholder="200"
          />
        </div>

        <div className="flex-1 min-w-[120px] flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">
            Cash-out
          </label>
          <input
            type="number"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
            value={form.cashOut}
            onChange={(e) => onChange("cashOut", e.target.value)}
            placeholder="520"
          />
        </div>
      </div>

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
                {isTimerRunning ? "End" : "Start"}
              </button>
            )}

            {sessionDuration && (
              <span className="text-xs font-medium text-gray-700">
                Duration: {sessionDuration.hours}:
                {String(sessionDuration.minutes).padStart(2, "0")}
              </span>
            )}

            {autoProfit !== null && (
              <span
                className={`text-xs font-medium ${
                  autoProfit >= 0 ? "text-emerald-600" : "text-rose-600"
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
              className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 text-left"
            >
              Discard changes
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {saving && (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <LoadingIndicator />
              {editingId ? "Updating…" : "Saving…"}
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-60 disabled:shadow-none"
          >
            {editingId ? "Update Session" : "Save Session"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BankrollFormModal;
