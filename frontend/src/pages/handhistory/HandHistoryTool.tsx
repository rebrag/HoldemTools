// src/pages/handhistory/HandHistoryTool.tsx
import React, { useEffect, useRef, useState } from "react";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import HandHistoryEditorModal from "./HandHistoryEditorModal";
import type { HandHistory, HandHistoryDraft, HandHistoryToolProps } from "./types";

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

  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const handleSave = async ({ title, rawText }: HandHistoryDraft) => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = !!editing;
      const res = await authedFetch(
        isEdit
          ? `/api/handhistory/${encodeURIComponent(editing!.id)}`
          : "/api/handhistory",
        {
          method: isEdit ? "PUT" : "POST",
          body: JSON.stringify({
            title: title || null,
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
      const res = await authedFetch(
        `/api/handhistory/${encodeURIComponent(hh.id)}`,
        { method: "DELETE" }
      );
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
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Hand Histories</h1>
          <p className="text-xs text-gray-500">
            Paste in hands you've played and keep them in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px]"
        >
          + Add hand history
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingIndicator />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center">
          <p className="text-sm text-gray-600">No hand histories yet.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
          >
            Add your first one
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((hh) => {
            const expanded = expandedId === hh.id;
            return (
              <li
                key={hh.id}
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
                      {hh.title?.trim() || "Untitled hand"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {formatDate(hh.createdAt)}
                    </div>
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

                {expanded && (
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800">
                    {hh.rawText}
                  </pre>
                )}
              </li>
            );
          })}
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

export default HandHistoryTool;
