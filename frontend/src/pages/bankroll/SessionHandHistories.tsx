// src/pages/bankroll/SessionHandHistories.tsx
// Hand-history management embedded in the session modal. Two modes:
//   - "session": a saved session, server-backed via /api/handhistory (hands
//     carry the real sessionId).
//   - "draft":   the current/in-progress session, which has no database id yet.
//     Hands are held in memory and persisted+linked when the session is saved
//     (see BankrollTracker.handleSave).
// Hands are associated with the session, so they inherit its date/time rather
// than carrying their own.
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AnimatePresence, motion } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import HandSummaryRow from "@/components/HandSummaryRow";
import { authedFetch } from "@/lib/api";
import useHandSolutions from "@/hooks/useHandSolutions";
import { solutionOpenUrl } from "@/lib/solver/postflopLibrary";
import { summaryFromRawText } from "@/pages/handhistory/create/replay";
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
  /** Has an embedded replay payload, so /hand-history/replay/{key} works.
   *  Always false for draft hands: they have no server id to route to. */
  replayable: boolean;
  /** Deep link to this hand's solved board on /solutions, or null. */
  solutionHref: string | null;
  /** Server hand id (session mode), for the Share button. */
  serverId: number | null;
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

export function makeLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `lh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Which of this session's hands have a solved board on /solutions.
  const solutionByHandId = useHandSolutions(mode === "session" && Boolean(user));

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

  // Memoized: summaryFromRawText decodes a base64 JSON payload per hand (its
  // module cache makes repeats cheap, but no reason to churn it per render).
  const rows: Row[] = useMemo(
    () =>
      mode === "session"
        ? items.map((h) => {
            const solution = solutionByHandId[h.id];
            return {
              key: String(h.id),
              label: `Hand #${h.id}`,
              rawText: h.rawText,
              replayable: summaryFromRawText(h.rawText) != null,
              solutionHref: solution ? solutionOpenUrl(solution) : null,
              serverId: h.id,
            };
          })
        : (draftHands ?? []).map((h, i) => ({
            key: h.localId,
            label: `Hand ${i + 1}`,
            rawText: h.rawText,
            replayable: false,
            solutionHref: null,
            serverId: null,
          })),
    [mode, items, draftHands, solutionByHandId]
  );

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
    <div className="mt-5 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">
          Hand Histories
          {rows.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-slate-400">
              ({rows.length})
            </span>
          )}
        </h3>
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-rose-500/40 bg-rose-950/60 px-2.5 py-1.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <LoadingIndicator />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-4 text-center text-xs text-slate-400">
          No hands logged for this session yet.
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const expanded = expandedKey === row.key;
              const { solutionHref } = row;
              return (
                <motion.li
                  key={row.key}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="rounded-lg border border-white/10 bg-white/5 p-2.5"
                >
                  <div className="text-[11px] font-semibold text-slate-300">
                    {row.label}
                  </div>
                  <HandSummaryRow
                    rawText={row.rawText}
                    tone="dark"
                    replayHref={
                      row.replayable ? `/hand-history/replay/${row.key}` : null
                    }
                    solutionHref={solutionHref}
                    shareId={row.replayable ? row.serverId : null}
                    onDelete={() => void handleDelete(row.key)}
                    onError={setError}
                    onPreviewClick={() => setExpandedKey(expanded ? null : row.key)}
                    previewExpanded={expanded}
                  />

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.pre
                        key="raw"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-slate-200"
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
    </div>
  );
};

export default SessionHandHistories;
