// src/pages/handhistory/HandHistoryTool.tsx
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import HandHistoryEditorModal from "./HandHistoryEditorModal";
import type { HandHistory, HandHistoryDraft, HandHistoryToolProps } from "./types";
import type { BankrollSession } from "@/pages/bankroll/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

// A hand linked to a session shows that session's date/location/blinds
// (the hand's "time" is the session's), instead of its own saved-at stamp.
function sessionLabel(s: BankrollSession): string {
  const parts: string[] = [];
  if (s.start) {
    const d = new Date(s.start);
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      );
    }
  }
  if (s.location?.trim()) parts.push(s.location.trim());
  if (s.blinds?.trim()) parts.push(s.blinds.trim());
  return parts.join(" · ");
}

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
  exit: { opacity: 0, x: -24, transition: { duration: 0.18 } },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function previewOf(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
}

const HandHistoryTool: React.FC<HandHistoryToolProps> = ({ user }) => {
  const [items, setItems] = useState<HandHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HandHistory | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sessionsById, setSessionsById] = useState<Map<string, BankrollSession>>(
    new Map()
  );

  const itemsRef = useRef<HandHistory[]>([]);
  itemsRef.current = items;

  const sortByNewest = (list: HandHistory[]) =>
    [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const shouldBlock = itemsRef.current.length === 0;
      try {
        if (shouldBlock) setLoading(true);
        setError(null);
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) {
          throw new Error(
            `We couldn't load your hand histories yet. (${res.status})`
          );
        }
        const data = (await res.json()) as HandHistory[];
        if (!cancelled) setItems(sortByNewest(data));
      } catch (e: unknown) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "We couldn't load your hand histories yet."
          );
        }
      } finally {
        if (!cancelled && shouldBlock) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load the user's bankroll sessions so linked hands can show their
  // session's date/location. Best-effort: labels are an enhancement, so
  // failures here are silent and don't block the hand list.
  useEffect(() => {
    if (!user) {
      setSessionsById(new Map());
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/bankroll?userId=${encodeURIComponent(user.uid)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as BankrollSession[];
        if (cancelled) return;
        const map = new Map<string, BankrollSession>();
        for (const s of data) map.set(s.id, s);
        setSessionsById(map);
      } catch {
        // ignore — session labels are non-critical
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = !!editing;
      const res = await authedFetch(
        isEdit ? `/api/handhistory/${editing!.id}` : "/api/handhistory",
        {
          method: isEdit ? "PUT" : "POST",
          body: JSON.stringify({
            rawText,
            sessionId: editing?.sessionId ?? null,
          }),
        }
      );
      if (!res.ok) {
        throw new Error(
          `Failed to ${isEdit ? "update" : "save"} hand history. (${res.status})`
        );
      }
      const saved = (await res.json()) as HandHistory;
      setItems((prev) =>
        sortByNewest(
          isEdit ? prev.map((i) => (i.id === saved.id ? saved : i)) : [saved, ...prev]
        )
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
    if (!user) return;
    if (!window.confirm("Delete this hand history? This can't be undone.")) return;
    const prev = itemsRef.current;
    setItems((p) => p.filter((i) => i.id !== hh.id));
    try {
      const res = await authedFetch(`/api/handhistory/${hh.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev); // rollback
      setError("We couldn't delete that hand history. Please try again.");
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-20 pb-12">
        <h1 className="text-xl font-semibold text-gray-900">Hand Histories</h1>
        <p className="mt-3 text-sm text-gray-600">
          Sign in to save and review your hand histories.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-16 pb-12">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300/40 bg-white/90 px-5 py-4 shadow-sm shadow-emerald-500/10 backdrop-blur-sm"
      >
        <div>
          <h1 className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-xl font-bold text-transparent">
            Hand Histories
          </h1>
          {/* <p className="text-xs text-gray-500">
            Paste in hands you've played and keep them in one place.
          </p> */}
        </div>
        <motion.button
          type="button"
          onClick={openCreate}
          whileHover={{ y: -2, scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
          className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 hover:bg-emerald-500"
        >
          + Add hand history
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingIndicator />
        </div>
      ) : items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="rounded-2xl border border-dashed border-emerald-300/50 bg-white/70 px-6 py-12 text-center backdrop-blur-sm"
        >
          <motion.div
            aria-hidden="true"
            animate={{ y: [0, -8, 0], rotate: [-4, 4, -4] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="mx-auto mb-3 w-fit text-4xl"
          >
            🂡
          </motion.div>
          <p className="text-sm text-gray-600">No hand histories yet.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
          >
            Add your first one
          </button>
        </motion.div>
      ) : (
        <motion.ul
          className="space-y-3"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence initial={false}>
          {items.map((hh) => {
            const expanded = expandedId === hh.id;
            return (
              <motion.li
                key={hh.id}
                layout
                variants={itemVariants}
                exit="exit"
                whileHover={{ y: -2 }}
                className="rounded-2xl border border-emerald-300/40 bg-white/90 p-4 shadow-sm shadow-emerald-500/10 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : hh.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={expanded}
                  >
                    <div className="truncate text-sm font-semibold text-gray-900">
                      Hand #{hh.id}
                    </div>
                    {hh.sessionId && sessionsById.get(hh.sessionId) ? (
                      <div className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-emerald-50 px-2 py-[1px] text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        🗓 {sessionLabel(sessionsById.get(hh.sessionId)!)}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatDate(hh.createdAt)}
                      </div>
                    )}
                    {!expanded && (
                      <div className="mt-1 truncate font-mono text-[11px] text-gray-500">
                        {previewOf(hh.rawText)}
                      </div>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(hh)}
                      className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(hh)}
                      className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
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
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800"
                    >
                      {hh.rawText}
                    </motion.pre>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
          </AnimatePresence>
        </motion.ul>
      )}

      {editorOpen && (
        <HandHistoryEditorModal
          initialRawText={editing?.rawText ?? null}
          isEdit={!!editing}
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

export default HandHistoryTool;
