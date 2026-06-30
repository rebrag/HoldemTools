// src/pages/bankroll/SessionHandHistories.tsx
// Hand-history management embedded in the edit-session modal. Lists the hands
// linked to one bankroll session, with previews you can expand to read in full,
// plus add / edit / delete. Hands are associated with the session via sessionId,
// so they inherit the session's date/time rather than carrying their own.
import React, { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AnimatePresence, motion } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import HandHistoryEditorModal from "@/pages/handhistory/HandHistoryEditorModal";
import type {
  HandHistory,
  HandHistoryDraft,
} from "@/pages/handhistory/types";

interface Props {
  user: User;
  sessionId: string;
}

function previewOf(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine;
}

const SessionHandHistories: React.FC<Props> = ({ user, sessionId }) => {
  const [items, setItems] = useState<HandHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HandHistory | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const itemsRef = useRef<HandHistory[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    if (!user) return;
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
  }, [user, sessionId]);

  const openCreate = () => {
    setEditing(null);
    setSaveError(null);
    setEditorOpen(true);
  };

  const openEdit = (hh: HandHistory) => {
    setEditing(hh);
    setSaveError(null);
    setEditorOpen(true);
  };

  const handleSave = async ({ rawText }: HandHistoryDraft) => {
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = !!editing;
      const res = await authedFetch(
        isEdit ? `/api/handhistory/${editing!.id}` : "/api/handhistory",
        {
          method: isEdit ? "PUT" : "POST",
          // Always stamp the session link so the hand belongs to this session.
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
      setEditing(null);
    } catch (e: unknown) {
      setSaveError(
        e instanceof Error ? e.message : "Something went wrong while saving."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (hh: HandHistory) => {
    if (!window.confirm("Delete this hand? This can't be undone.")) return;
    const prev = itemsRef.current;
    setItems((p) => p.filter((i) => i.id !== hh.id));
    try {
      const res = await authedFetch(`/api/handhistory/${hh.id}`, {
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
          {items.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-gray-500">
              ({items.length})
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

      {error && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <LoadingIndicator />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          No hands logged for this session yet.
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((hh) => {
              const expanded = expandedId === hh.id;
              return (
                <motion.li
                  key={hh.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="rounded-lg border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : hh.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={expanded}
                    >
                      <div className="text-[11px] font-semibold text-gray-700">
                        Hand #{hh.id}
                      </div>
                      {!expanded && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                          {previewOf(hh.rawText) || "(empty)"}
                        </div>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(hh)}
                        className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(hh)}
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
                        {hh.rawText}
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
          initial={editing}
          saving={saving}
          errorMessage={saveError}
          onSave={handleSave}
          onCancel={() => {
            if (saving) return;
            setEditorOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
};

export default SessionHandHistories;
