// src/pages/bankroll/SessionHandHistories.tsx
// Hand-history management embedded in the session modal. Two modes:
//   - "session": a saved session, server-backed via /api/handhistory (hands
//     carry the real sessionId).
//   - "draft":   the current/in-progress session, which has no database id yet.
//     Hands are held in memory and persisted+linked when the session is saved
//     (see BankrollTracker.handleSave).
// Hands are associated with the session, so they inherit its date/time rather
// than carrying their own.
import React, { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AnimatePresence, motion } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import HandHistoryEditorModal from "@/pages/handhistory/HandHistoryEditorModal";
import type { HandHistory } from "@/pages/handhistory/types";

// A hand typed against an unsaved (draft) session — no server id yet.
export interface LocalHand {
  localId: string;
  rawText: string;
}

interface Row {
  key: string;
  label: string;
  rawText: string;
}

interface Props {
  mode: "session" | "draft";
  // session mode
  user?: User;
  sessionId?: string;
  // draft mode
  draftHands?: LocalHand[];
  onDraftChange?: (next: LocalHand[]) => void;
}

function makeLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `lh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function previewOf(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
}

const SessionHandHistories: React.FC<Props> = ({
  mode,
  user,
  sessionId,
  draftHands,
  onDraftChange,
}) => {
  const [items, setItems] = useState<HandHistory[]>([]); // session mode only
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const itemsRef = useRef<HandHistory[]>([]);
  itemsRef.current = items;

  // Load a saved session's hands from the server.
  useEffect(() => {
    if (mode !== "session" || !user || !sessionId) return;
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await authedFetch(
          `/api/handhistory?sessionId=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) {
          throw new Error(`Couldn't load this session's hands. (${res.status})`);
        }
        const data = (await res.json()) as HandHistory[];
        if (!cancelled) setItems(data);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Couldn't load this session's hands."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, user, sessionId]);

  const rows: Row[] =
    mode === "session"
      ? items.map((h) => ({
          key: String(h.id),
          label: `Hand #${h.id}`,
          rawText: h.rawText,
        }))
      : (draftHands ?? []).map((h, i) => ({
          key: h.localId,
          label: `Hand ${i + 1}`,
          rawText: h.rawText,
        }));

  const editingRawText =
    editingKey != null
      ? rows.find((r) => r.key === editingKey)?.rawText ?? null
      : null;

  const openCreate = () => {
    setEditingKey(null);
    setSaveError(null);
    setEditorOpen(true);
  };

  const openEdit = (key: string) => {
    setEditingKey(key);
    setSaveError(null);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setEditingKey(null);
  };

  const handleSave = async (rawText: string) => {
    const isEdit = editingKey != null;

    if (mode === "draft") {
      const list = draftHands ?? [];
      const next = isEdit
        ? list.map((h) => (h.localId === editingKey ? { ...h, rawText } : h))
        : [{ localId: makeLocalId(), rawText }, ...list];
      onDraftChange?.(next);
      setEditorOpen(false);
      setEditingKey(null);
      return;
    }

    // session mode → server CRUD
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch(
        isEdit ? `/api/handhistory/${editingKey}` : "/api/handhistory",
        {
          method: isEdit ? "PUT" : "POST",
          body: JSON.stringify({ rawText, sessionId }),
        }
      );
      if (!res.ok) {
        throw new Error(
          `Failed to ${isEdit ? "update" : "save"} hand. (${res.status})`
        );
      }
      const saved = (await res.json()) as HandHistory;
      setItems((prev) =>
        isEdit ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev]
      );
      setEditorOpen(false);
      setEditingKey(null);
    } catch (e: unknown) {
      setSaveError(
        e instanceof Error ? e.message : "Something went wrong while saving."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!window.confirm("Delete this hand? This can't be undone.")) return;

    if (mode === "draft") {
      onDraftChange?.((draftHands ?? []).filter((h) => h.localId !== key));
      return;
    }

    const prev = itemsRef.current;
    setItems((p) => p.filter((i) => String(i.id) !== key));
    try {
      const res = await authedFetch(`/api/handhistory/${key}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev); // rollback
      setError("We couldn't delete that hand. Please try again.");
    }
  };

  return (
    <div className="mt-5 border-t border-gray-200 pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Hand Histories
          {rows.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-gray-500">
              ({rows.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px]"
        >
          + Add hand
        </button>
      </div>

      {mode === "draft" && (
        <p className="mb-2 text-[11px] text-gray-500">
          Hands you add now are saved with this session when you finish it.
        </p>
      )}

      {error && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <LoadingIndicator />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          No hands logged for this session yet.
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const expanded = expandedKey === row.key;
              return (
                <motion.li
                  key={row.key}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="rounded-lg border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : row.key)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={expanded}
                    >
                      <div className="text-[11px] font-semibold text-gray-700">
                        {row.label}
                      </div>
                      {!expanded && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                          {previewOf(row.rawText) || "(empty)"}
                        </div>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(row.key)}
                        className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.key)}
                        className="rounded-md border border-rose-200 px-2 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.pre
                        key="raw"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-2.5 font-mono text-[11px] leading-relaxed text-gray-800"
                      >
                        {row.rawText}
                      </motion.pre>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {editorOpen && (
        <HandHistoryEditorModal
          initialRawText={editingRawText}
          isEdit={editingKey != null}
          saving={saving}
          errorMessage={saveError}
          onSave={({ rawText }) => void handleSave(rawText)}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
};

export default SessionHandHistories;
