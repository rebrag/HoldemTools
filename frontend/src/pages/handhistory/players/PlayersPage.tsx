// src/pages/handhistory/players/PlayersPage.tsx
// Player roster management: photos, names, notes, and per-player hand counts.
// Reached from the hand-history secondary nav. Hand counts come from the same
// /api/handhistory fetch the list page uses, read via parseReplay (cheap JSON
// decode - no engine fold needed just to see which playerIds a hand links).
import React, { useEffect, useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import type { User } from "firebase/auth";
import { useAppNavigate } from "@/components/layout/RouteProgress";
import LoadingIndicator from "@/components/LoadingIndicator";
import PlayerAvatar from "@/components/PlayerAvatar";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { usePlayers } from "@/hooks/usePlayers";
import { authedFetch } from "@/lib/api";
import type { Player } from "@/lib/playersApi";
import type { BankrollSession } from "@/pages/bankroll/types";
import { parseReplay } from "../create/replay";
import type { HandHistory } from "../types";
import PlayerEditorDrawer from "./PlayerEditorDrawer";
import LinkHandsDrawer from "./LinkHandsDrawer";
import { scanUnlinkedNames } from "./relinkHands";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
};

const PlayersPage: React.FC<{ user: User | null }> = ({ user }) => {
  const navigate = useAppNavigate();
  const { players, loading: playersLoading } = usePlayers();
  const showSpinner = useDelayedLoading(playersLoading);

  // Editor state. `editing` stays set while the drawer animates closed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);
  const [linkDrawerOpen, setLinkDrawerOpen] = useState(false);

  // Hands-per-player, from one fetch of the user's hands.
  const [hands, setHands] = useState<HandHistory[] | null>(null);
  useEffect(() => {
    if (!user) {
      setHands(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) return;
        const data = (await res.json()) as HandHistory[];
        if (!cancelled) setHands(data);
      } catch {
        // Counts are an enhancement; the roster works without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Bankroll sessions, so the link wizard can label hands with the session's
  // location/stakes (the context that tells two same-named people apart).
  // Best-effort, like the hand list's own labels fetch.
  const [sessionsById, setSessionsById] = useState<Map<string, BankrollSession>>(
    new Map()
  );
  useEffect(() => {
    if (!user) {
      setSessionsById(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/bankroll?userId=${encodeURIComponent(user.uid)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as BankrollSession[];
        if (cancelled) return;
        setSessionsById(new Map(data.map((s) => [s.id, s])));
      } catch {
        // labels only - the wizard works without them
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // How many distinct unlinked names the wizard would offer - drives the
  // "link past hands" banner.
  const unlinkedNameCount = useMemo(
    () => (hands ? scanUnlinkedNames(hands).groups.length : 0),
    [hands]
  );

  const handCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hands ?? []) {
      const seats = parseReplay(h.rawText)?.state.seats;
      if (!seats) continue;
      // A player linked on several seats of one hand still counts once.
      const ids = new Set(seats.map((s) => s.playerId).filter(Boolean) as string[]);
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [hands]);

  const openEditor = (p: Player | null) => {
    setEditing(p);
    setDrawerOpen(true);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-5">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate("/hand-history")}
            className="text-[11px] font-medium text-emerald-200/80 transition-colors hover:text-emerald-100"
          >
            ← Hand histories
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-white">Players</h1>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-100/70">
            The people you play against - photos, notes, and their hands
          </p>
        </div>
        {user && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => openEditor(null)}
            className="inline-flex shrink-0 items-center rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/40 transition-colors hover:bg-emerald-400"
          >
            + Add player
          </motion.button>
        )}
      </div>

      {/* ── Retro-link call-out: only when the scan actually found names ── */}
      {user && unlinkedNameCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300/40 bg-emerald-50/90 px-4 py-3"
        >
          <p className="min-w-0 text-sm text-emerald-900">
            <span className="font-semibold">
              {unlinkedNameCount} name{unlinkedNameCount === 1 ? "" : "s"}
            </span>{" "}
            in your recorded hands {unlinkedNameCount === 1 ? "isn't" : "aren't"}{" "}
            linked to a player yet.
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => setLinkDrawerOpen(true)}
            className="shrink-0 rounded-full border border-emerald-400 bg-white px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100"
          >
            Link past hands
          </motion.button>
        </motion.div>
      )}

      {!user ? (
        <div className="rounded-2xl border border-dashed border-emerald-300/50 bg-white/70 px-6 py-12 text-center backdrop-blur-sm">
          <p className="text-sm text-gray-600">
            Sign in to build your player roster - photos and notes sync across
            your devices.
          </p>
        </div>
      ) : playersLoading ? (
        showSpinner ? (
          <div className="flex items-center justify-center py-16">
            <LoadingIndicator />
          </div>
        ) : null
      ) : players.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="rounded-2xl border border-dashed border-emerald-300/50 bg-white/70 px-6 py-12 text-center backdrop-blur-sm"
        >
          <div aria-hidden="true" className="mx-auto mb-3 w-fit text-4xl">
            🧑‍🤝‍🧑
          </div>
          <p className="text-sm text-gray-600">
            No players yet. Add one here, or link a seat to a player while
            recording a hand.
          </p>
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
          >
            Add your first player
          </button>
        </motion.div>
      ) : (
        <motion.ul
          className="divide-y divide-emerald-100 overflow-hidden rounded-2xl border border-emerald-300/40 bg-white shadow-sm shadow-emerald-500/10"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          {players.map((p) => {
            const count = handCounts.get(p.id) ?? 0;
            return (
              <motion.li key={p.id} variants={rowVariants}>
                <button
                  type="button"
                  onClick={() => openEditor(p)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-emerald-50/60 focus:outline-none focus-visible:bg-emerald-50"
                >
                  <PlayerAvatar player={p} size="lg" className="ring-emerald-200" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">
                      {p.name}
                    </span>
                    {p.notes && (
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {p.notes}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-[1px] text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                    {count} hand{count === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-gray-300">
                    ›
                  </span>
                </button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      <PlayerEditorDrawer
        open={drawerOpen}
        player={editing}
        handCount={editing ? handCounts.get(editing.id) ?? 0 : undefined}
        onClose={() => setDrawerOpen(false)}
      />

      <LinkHandsDrawer
        open={linkDrawerOpen}
        onClose={() => setLinkDrawerOpen(false)}
        hands={hands ?? []}
        sessionsById={sessionsById}
        onHandsUpdated={(updated) =>
          setHands((prev) => {
            if (!prev) return prev;
            const byId = new Map(updated.map((h) => [h.id, h]));
            return prev.map((h) => byId.get(h.id) ?? h);
          })
        }
      />
    </div>
  );
};

export default PlayersPage;
