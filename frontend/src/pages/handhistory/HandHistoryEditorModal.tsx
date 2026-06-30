// src/pages/handhistory/HandHistoryEditorModal.tsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import LoadingIndicator from "@/components/LoadingIndicator";
import type { HandHistory, HandHistoryDraft } from "./types";

interface Props {
  initial: HandHistory | null; // null = create, otherwise editing
  saving: boolean;
  errorMessage?: string | null;
  onSave: (draft: HandHistoryDraft) => void;
  onCancel: () => void;
}

const HandHistoryEditorModal: React.FC<Props> = ({
  initial,
  saving,
  errorMessage,
  onSave,
  onCancel,
}) => {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [rawText, setRawText] = useState(initial?.rawText ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  const canSave = rawText.trim().length > 0 && !saving;

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-black/50"
        onPointerDown={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Edit hand history" : "Add hand history"}
        className="relative z-[1210] w-full max-w-2xl rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-2xl shadow-emerald-500/30 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {saving && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/60">
            <LoadingIndicator />
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            {initial ? "Edit Hand History" : "Add Hand History"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
          >
            <span className="text-sm">✕</span>
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">
            Title <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. AA vs 3-bet at Bellagio 2/5"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">Hand history</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the full hand history here…"
            rows={14}
            className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
          />
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ title: title.trim(), rawText })}
            className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-60 disabled:shadow-none"
          >
            {initial ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HandHistoryEditorModal;
