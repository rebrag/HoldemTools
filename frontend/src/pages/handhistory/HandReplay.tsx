// src/pages/handhistory/HandReplay.tsx
// Hand replayer: watch a saved hand play out action-by-action on the same
// PokerTable the recorder uses. It resolves the hand from the URL (:key), reads
// the embedded replay payload, and reconstructs every engine snapshot via the
// exact same engine as the creator (buildEngine → applyAction → setWinners), so
// the replayed table is identical to what was recorded. Transport controls step
// through frames or auto-advance one action every 2 seconds.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { User } from "firebase/auth";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import PokerTable from "@/components/PokerTable";
import LoadingIndicator from "@/components/LoadingIndicator";
import { authedFetch } from "@/lib/api";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import { positionLabels } from "./create/positions";
import { buildTableSeats, TableCenter } from "./create/tableView";
import { parseReplay, reconstructFrames, stripReplay } from "./create/replay";
import { TEST_HAND_ID, buildTestHandText, SHOW_TEST_HAND } from "./create/testHand";
import { fetchSharedHand } from "@/lib/shareApi";
import type { HandHistory } from "./types";

const STEP_MS = 2000;

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; rawText: string };

const HandReplay: React.FC<{ user: User | null; shared?: boolean }> = ({
  user,
  shared = false,
}) => {
  const { key, token } = useParams<{ key: string; token: string }>();
  const navigate = useNavigate();
  const { localHands } = useLocalHandHistories();
  const reduce = useReducedMotion();

  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  // Resolve the hand's rawText. Shared mode → fetch the public endpoint by
  // token (works for anyone, signed in or not). Owner mode → the dev fixture,
  // then the signed-in server list, then the device-local store, matched on the
  // row's string key.
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });

    if (shared) {
      if (!token) {
        setLoad({ status: "missing" });
        return;
      }
      void (async () => {
        try {
          const rawText = await fetchSharedHand(token);
          if (!cancelled) setLoad({ status: "ready", rawText });
        } catch {
          if (!cancelled) setLoad({ status: "missing" });
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!key) {
      setLoad({ status: "missing" });
      return;
    }
    // Dev-only sample fixture: it isn't persisted anywhere, so resolve it by
    // rebuilding its text on demand (works on direct load / hard refresh).
    if (key === TEST_HAND_ID && SHOW_TEST_HAND) {
      setLoad({ status: "ready", rawText: buildTestHandText() });
      return;
    }
    if (!user) {
      const hit = localHands.find((h) => h.localId === key);
      setLoad(hit ? { status: "ready", rawText: hit.rawText } : { status: "missing" });
      return;
    }
    void (async () => {
      try {
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as HandHistory[];
        const hit = Array.isArray(data)
          ? data.find((h) => String(h.id) === key)
          : undefined;
        if (cancelled) return;
        setLoad(hit ? { status: "ready", rawText: hit.rawText } : { status: "missing" });
      } catch {
        if (!cancelled) setLoad({ status: "missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, token, shared, user, localHands]);

  const rawText = load.status === "ready" ? load.rawText : "";
  const data = useMemo(
    () => (load.status === "ready" ? parseReplay(rawText) : null),
    [load.status, rawText]
  );
  const replay = useMemo(() => (data ? reconstructFrames(data) : null), [data]);
  const labels = useMemo(
    () =>
      data ? positionLabels(data.state.tableSize, data.state.buttonSeat) : [],
    [data]
  );
  const title = useMemo(
    () => (rawText ? stripReplay(rawText).split("\n").find((l) => l.trim()) ?? "" : ""),
    [rawText]
  );

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [unitMode, setUnitMode] = useState<"bb" | "chips">("chips");

  const last = replay ? replay.frames.length - 1 : 0;

  // Restart from the top whenever a different hand is loaded.
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [rawText]);

  // Auto-advance one action every STEP_MS while playing. Re-armed on each step;
  // cleared on pause, unmount, and at the final frame. Reduced motion suppresses
  // the visual transitions elsewhere but playback still advances.
  useEffect(() => {
    if (!playing || !replay) return;
    if (cursor >= last) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setCursor((c) => (c >= last ? c : c + 1));
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, cursor, last, replay]);

  if (load.status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingIndicator />
      </div>
    );
  }

  // Missing hand, or a hand with no embedded replay payload (saved before this
  // feature, or imported/foreign text). Offer a way back.
  if (load.status === "missing" || !data || !replay) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div aria-hidden className="mb-3 text-4xl">🂠</div>
        <h1 className="text-lg font-semibold text-white">Replay unavailable</h1>
        <p className="mt-2 text-sm text-white/70">
          {shared
            ? "This shared link is invalid or has been revoked."
            : load.status === "missing"
            ? "We couldn't find that hand."
            : "This hand was saved before replays were supported, so there's no action data to play back."}
        </p>
        <button
          type="button"
          onClick={() => navigate(shared ? "/" : "/hand-history")}
          className="mt-5 inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition hover:bg-emerald-500"
        >
          {shared ? "Go to HoldemTools" : "← Back to hand histories"}
        </button>
      </div>
    );
  }

  const frame = replay.frames[cursor];
  const caption = replay.captions[cursor] ?? "";
  const atStart = cursor <= 0;
  const atEnd = cursor >= last;

  const tap = reduce ? undefined : { scale: 0.9 };

  const goFirst = () => {
    setPlaying(false);
    setCursor(0);
  };
  const goPrev = () => {
    setPlaying(false);
    setCursor((c) => Math.max(0, c - 1));
  };
  const goNext = () => {
    setPlaying(false);
    setCursor((c) => Math.min(last, c + 1));
  };
  const goLast = () => {
    setPlaying(false);
    setCursor(last);
  };
  const togglePlay = () => {
    if (atEnd) {
      // Replay from the top when pressing play at the end.
      setCursor(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  // Winner banner (final frame only).
  const winnerText = (() => {
    if (!atEnd) return null;
    const nameOf = (idx: number) => frame.players[idx]?.name ?? `Seat ${idx}`;
    const fmt = (w: number[] | null) =>
      w && w.length ? w.map(nameOf).join(" & ") : null;
    const w1 = fmt(frame.winners);
    if (data.state.numBoards === 2) {
      const w2 = fmt(frame.winners2);
      const parts = [w1 && `Board 1: ${w1}`, w2 && `Board 2: ${w2}`].filter(Boolean);
      return parts.length ? parts.join("  ·  ") : null;
    }
    return w1 ? (frame.winners!.length > 1 ? `Split: ${w1}` : `${w1} wins`) : null;
  })();

  const progressPct = last > 0 ? (cursor / last) * 100 : 0;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col px-4 pt-4 pb-6">
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(shared ? "/" : "/hand-history")}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-200/80 transition hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {shared ? "HoldemTools" : "Hand histories"}
          </button>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-white sm:text-base">
              {title || "Hand replay"}
            </h1>
            {shared && (
              <span className="shrink-0 rounded-full bg-sky-500/90 px-2 py-[1px] text-[10px] font-bold text-white">
                Shared
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setUnitMode((u) => (u === "bb" ? "chips" : "bb"))}
          className="shrink-0 rounded-full border border-emerald-300/40 bg-slate-900/70 px-3 py-1 text-[11px] font-medium text-emerald-100 transition hover:bg-slate-800 active:scale-95"
        >
          {unitMode === "bb" ? "Chips" : "BB"}
        </button>
      </div>

      {/* Table — must be a block wrapper with a definite width so PokerTable's
          aspect-ratio box derives a real height (a flex-centered wrapper
          collapses it and piles every seat into the center). */}
      <div className="w-full py-2">
        <PokerTable
          size={data.state.tableSize}
          seats={buildTableSeats({ state: data.state, engine: frame, labels, unitMode })}
          maxWidthClassName="max-w-2xl"
          center={
            <TableCenter
              state={data.state}
              engine={frame}
              unitMode={unitMode}
              editable={false}
            />
          }
        />
      </div>

      {/* Caption / winner */}
      <div className="min-h-[2.5rem] px-1 text-center">
        <AnimatePresence mode="wait">
          {winnerText ? (
            <motion.div
              key="winner"
              initial={reduce ? false : { opacity: 0, scale: 0.9, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-4 py-1.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/30"
            >
              🏆 {winnerText}
            </motion.div>
          ) : (
            <motion.div
              key={`cap-${cursor}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="inline-flex items-center rounded-full bg-slate-900/70 px-4 py-1.5 text-sm font-medium text-emerald-100"
            >
              {caption}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Progress bar */}
      <div className="mt-3 px-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300"
            animate={{ width: `${progressPct}%` }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-medium text-white/40">
          <span>Action {cursor} of {last}</span>
          <span>{atEnd ? "Showdown" : ""}</span>
        </div>
      </div>

      {/* Transport bar — pinned to the bottom (mobile thumb-zone) */}
      <div className="mt-auto flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/30 bg-slate-900/70 p-2 shadow-lg shadow-emerald-950/30">
        <TransportButton label="First action" onClick={goFirst} disabled={atStart} tap={tap}>
          <SkipBack className="h-5 w-5" />
        </TransportButton>
        <TransportButton label="Previous action" onClick={goPrev} disabled={atStart} tap={tap}>
          <ChevronLeft className="h-6 w-6" />
        </TransportButton>
        <TransportButton label={playing ? "Pause" : "Play"} onClick={togglePlay} primary tap={tap}>
          {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </TransportButton>
        <TransportButton label="Next action" onClick={goNext} disabled={atEnd} tap={tap}>
          <ChevronRight className="h-6 w-6" />
        </TransportButton>
        <TransportButton label="Last action" onClick={goLast} disabled={atEnd} tap={tap}>
          <SkipForward className="h-5 w-5" />
        </TransportButton>
      </div>
    </div>
  );
};

const TransportButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  tap?: { scale: number };
  children: React.ReactNode;
}> = ({ label, onClick, disabled, primary, tap, children }) => (
  <motion.button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    whileTap={disabled ? undefined : tap}
    className={
      primary
        ? "inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-900/40 transition hover:bg-emerald-400 disabled:opacity-40"
        : "inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-emerald-100 transition hover:bg-slate-700 disabled:opacity-30"
    }
  >
    {children}
  </motion.button>
);

export default HandReplay;
