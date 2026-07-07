// src/pages/handhistory/HandHistoryTool.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Play, Share2, Copy, Check, Trash2, MoreHorizontal } from "lucide-react";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { SHARE_ENABLED, createShareToken, shareUrl } from "@/lib/shareApi";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import HandHistorySecondaryNav from "./HandHistorySecondaryNav";
import RowActionButton from "./RowActionButton";
import HandPreview from "./HandPreview";
import FlyingCards from "./FlyingCards";
import { parseReplay, stripReplay } from "./create/replay";
import { TEST_HAND_ID, buildTestHandText, SHOW_TEST_HAND } from "./create/testHand";
import type {
  HandHistory,
  HandHistoryToolProps,
  LocalHandHistory,
} from "./types";
import type { BankrollSession } from "@/pages/bankroll/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

// A unified row for the list: server hands carry a numeric `id`, local
// (signed-out) hands carry a string `localId`. Normalizing both to a string
// `key` keeps rendering/expansion/editing free of id-type collisions.
type ToolRow = {
  key: string;
  isLocal: boolean;
  rawText: string;
  clean: string; // rawText with the embedded replay payload stripped (for display/copy)
  replayable: boolean; // has an embedded replay payload → the Replay button is shown
  createdAt: string;
  sessionId: string | null;
  server?: HandHistory; // present only for server-backed rows
  synthetic?: boolean; // dev-only "test" fixture row; not persisted
};

// A hand linked to a session shows that session's location/blinds (the day is
// carried by the group header now, so the date is omitted here).
function sessionMeta(s: BankrollSession): string {
  return [s.location?.trim(), s.blinds?.trim()].filter(Boolean).join(" · ");
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

// Section-header label for a day: "Today" / "Yesterday" for the two most recent
// calendar days, otherwise a plain date like "Jul 7, 2026".
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const HandHistoryTool: React.FC<HandHistoryToolProps> = ({ user }) => {
  const navigate = useNavigate();
  const [items, setItems] = useState<HandHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null); // which row's mobile action menu is open
  const [sessionsById, setSessionsById] = useState<Map<string, BankrollSession>>(
    new Map()
  );
  // Transient per-row confirmation ("copied"/"shared") shown on the action
  // buttons for ~1.5s, and the row whose share request is in flight.
  const [flash, setFlash] = useState<{ key: string; kind: "copied" | "shared" } | null>(
    null
  );
  const [sharingKey, setSharingKey] = useState<string | null>(null);

  // Local (signed-out) store. When signed in these are migrated to the server
  // and cleared (see the migration effect below).
  const { localHands, removeLocal, setLocal } = useLocalHandHistories();
  const localHandsRef = useRef<LocalHandHistory[]>(localHands);
  localHandsRef.current = localHands;

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
    // reloadNonce lets the migration effect force a refetch after uploading.
  }, [user, reloadNonce]);

  // Auto-migrate device-saved (signed-out) hands to the account on sign-in.
  // Runs once when `user` becomes set (or on mount if already signed in with a
  // non-empty store). Any hands that fail to upload stay in localStorage; we
  // don't auto-retry here to avoid hammering the API on a persistent failure.
  const migratingRef = useRef(false);
  useEffect(() => {
    if (!user || migratingRef.current) return;
    const pending = localHandsRef.current;
    if (pending.length === 0) return;
    migratingRef.current = true;
    let cancelled = false;
    (async () => {
      const failed: LocalHandHistory[] = [];
      for (const h of pending) {
        try {
          const res = await authedFetch("/api/handhistory", {
            method: "POST",
            body: JSON.stringify({ rawText: h.rawText, sessionId: null }),
          });
          if (!res.ok) throw new Error();
        } catch {
          failed.push(h);
        }
      }
      migratingRef.current = false;
      if (cancelled) return;
      setLocal(failed); // keep only failures; clears to [] on full success
      if (failed.length > 0) {
        setError(
          "We couldn't sync some hands saved on this device. They're still saved here."
        );
      }
      setReloadNonce((n) => n + 1); // refetch so migrated hands appear
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setLocal]);

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

  // Signed in → show server hands; signed out → show device-local hands.
  // (After sign-in the local store is migrated + cleared, so there's never a
  // lasting "both" state to reconcile.)
  // Dev-only "test" fixture: rendered through the live serializer so it tracks
  // any change to the output format. Computed once (recomputes on HMR reload).
  const testRawText = useMemo(
    () => (SHOW_TEST_HAND ? buildTestHandText() : ""),
    []
  );

  const rows: ToolRow[] = useMemo(() => {
    const base: ToolRow[] = user
      ? items.map((hh) => ({
          key: String(hh.id),
          isLocal: false,
          rawText: hh.rawText,
          clean: stripReplay(hh.rawText),
          replayable: parseReplay(hh.rawText) != null,
          createdAt: hh.createdAt,
          sessionId: hh.sessionId,
          server: hh,
        }))
      : localHands.map((h) => ({
          key: h.localId,
          isLocal: true,
          rawText: h.rawText,
          clean: stripReplay(h.rawText),
          replayable: parseReplay(h.rawText) != null,
          createdAt: h.createdAt,
          sessionId: null,
        }));
    base.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (SHOW_TEST_HAND) {
      // Always first, regardless of dates. Not persisted anywhere.
      base.unshift({
        key: TEST_HAND_ID,
        isLocal: false,
        rawText: testRawText,
        clean: stripReplay(testRawText),
        // Carries an embedded payload and is resolved by TEST_HAND_ID on the
        // replay route (rebuilt on demand since it isn't persisted).
        replayable: parseReplay(testRawText) != null,
        createdAt: "2020-01-01T00:00:00.000Z",
        sessionId: null,
        synthetic: true,
      });
    }
    return base;
  }, [user, items, localHands, testRawText]);

  // Group the (already date-sorted) rows by calendar day so the list shows one
  // day header instead of a timestamp on every row.
  const groups = useMemo(() => {
    const out: { day: string; rows: ToolRow[] }[] = [];
    for (const row of rows) {
      const day = formatDay(row.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(row);
      else out.push({ day, rows: [row] });
    }
    return out;
  }, [rows]);

  // Flash a transient "copied"/"shared" confirmation on a row's button.
  const flashRow = (key: string, kind: "copied" | "shared") => {
    setFlash({ key, kind });
    window.setTimeout(
      () => setFlash((f) => (f && f.key === key ? null : f)),
      1500
    );
  };

  const handleCopy = async (row: ToolRow) => {
    if (await copyText(row.clean)) flashRow(row.key, "copied");
  };

  // Mint a public share link for a server-backed hand and offer it via the
  // native share sheet (mobile) or the clipboard (desktop).
  const handleShare = async (row: ToolRow) => {
    if (!row.server) return;
    setSharingKey(row.key);
    setError(null);
    try {
      const token = await createShareToken(row.server.id);
      const url = shareUrl(token);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Poker hand replay", url });
          flashRow(row.key, "shared");
        } catch {
          /* user dismissed the share sheet — no-op */
        }
      } else if (await copyText(url)) {
        flashRow(row.key, "shared");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "We couldn't create a share link."
      );
    } finally {
      setSharingKey(null);
    }
  };

  const handleDelete = async (row: ToolRow) => {
    if (row.synthetic) return; // the test fixture isn't deletable
    if (!window.confirm("Delete this hand history? This can't be undone.")) return;
    // Signed out: delete from the device-local store.
    if (!user) {
      removeLocal(row.key);
      return;
    }
    const prev = itemsRef.current;
    setItems((p) => p.filter((i) => String(i.id) !== row.key));
    try {
      const res = await authedFetch(`/api/handhistory/${row.server!.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev); // rollback
      setError("We couldn't delete that hand history. Please try again.");
    }
  };

  return (
    <>
      <HandHistorySecondaryNav
        onCreate={() => navigate("/hand-history/create")}
      />

      <div className="mx-auto max-w-3xl px-4 pt-5 pb-12">
      <FlyingCards />

      <AnimatePresence>
        {!user && localHands.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            Saved on this device.{" "}
            <span className="font-semibold">Sign in</span> to sync your hand
            histories across devices.
          </motion.div>
        )}
      </AnimatePresence>

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
      ) : rows.length === 0 ? (
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
            onClick={() => navigate("/hand-history/create")}
            className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
          >
            Add your first one
          </button>
        </motion.div>
      ) : (
        <motion.ul
          className="divide-y divide-emerald-100 overflow-hidden rounded-2xl border border-emerald-300/40 bg-white/90 shadow-sm shadow-emerald-500/10 backdrop-blur-sm"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence initial={false}>
          {groups.flatMap((group) => [
            <li
              key={`day-${group.day}`}
              className="bg-emerald-50/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700/70"
            >
              {group.day}
            </li>,
            ...group.rows.map((row) => {
              const expanded = expandedKey === row.key;
              const menuOpen = menuKey === row.key;
              const session = row.sessionId ? sessionsById.get(row.sessionId) : null;
              const meta = session ? sessionMeta(session) : "";

              // Secondary actions, shared between the desktop inline row and the
              // mobile "⋯" drawer.
              const shareBtn =
                SHARE_ENABLED &&
                row.replayable &&
                !row.isLocal &&
                !row.synthetic &&
                !!row.server ? (
                  <RowActionButton
                    tone="share"
                    label="Share replay link"
                    disabled={sharingKey === row.key}
                    success={flash?.key === row.key && flash.kind === "shared"}
                    icon={
                      flash?.key === row.key && flash.kind === "shared" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Share2 className="h-4 w-4" />
                      )
                    }
                    onClick={() => handleShare(row)}
                  />
                ) : null;
              const copyBtn = (
                <RowActionButton
                  tone="copy"
                  label="Copy hand text"
                  success={flash?.key === row.key && flash.kind === "copied"}
                  icon={
                    flash?.key === row.key && flash.kind === "copied" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )
                  }
                  onClick={() => handleCopy(row)}
                />
              );
              const deleteBtn = !row.synthetic ? (
                <RowActionButton
                  tone="delete"
                  label="Delete hand"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => handleDelete(row)}
                />
              ) : null;

              return (
                <motion.li
                  key={row.key}
                  layout
                  variants={itemVariants}
                  exit="exit"
                  className="px-3 py-1.5 transition-colors hover:bg-emerald-50/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : row.key)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={expanded}
                    >
                      {session && meta && (
                        <div className="mb-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-emerald-50 px-2 py-[1px] text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                          🗓 {meta}
                        </div>
                      )}
                      {!expanded && <HandPreview rawText={row.rawText} />}
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.replayable && (
                        <RowActionButton
                          tone="replay"
                          label="Replay hand"
                          icon={<Play className="h-4 w-4" fill="currentColor" />}
                          onClick={() => navigate(`/hand-history/replay/${row.key}`)}
                        />
                      )}
                      {/* Desktop: secondary actions inline */}
                      <div className="hidden items-center gap-1.5 sm:flex">
                        {shareBtn}
                        {copyBtn}
                        {deleteBtn}
                      </div>
                      {/* Mobile: collapse secondary actions behind a ⋯ toggle */}
                      <div className="sm:hidden">
                        <RowActionButton
                          tone="copy"
                          label={menuOpen ? "Hide actions" : "More actions"}
                          icon={<MoreHorizontal className="h-4 w-4" />}
                          onClick={() => setMenuKey(menuOpen ? null : row.key)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Mobile secondary-action drawer: expands within the row so the
                      list's overflow-hidden never clips it. */}
                  <AnimatePresence initial={false}>
                    {menuOpen && (
                      <motion.div
                        key="menu"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18, ease: "easeInOut" }}
                        className="overflow-hidden sm:hidden"
                      >
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          {shareBtn}
                          {copyBtn}
                          {deleteBtn}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

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
                        {row.clean}
                      </motion.pre>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            }),
          ])}
          </AnimatePresence>
        </motion.ul>
      )}

      </div>
    </>
  );
};

export default HandHistoryTool;
