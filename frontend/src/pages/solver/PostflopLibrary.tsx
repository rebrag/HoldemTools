// Library of previously solved postflop boards, split by where the solve came
// from: hands the viewer recorded (previewed and linked back to the hand) and
// boards solved off a preflop sim line. Click a board to reopen it; remove one
// to take it out of this viewer's library (reversible - see SolutionsController).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import PlayingCard from "@/components/PlayingCard";
import HandSummaryRow from "@/components/HandSummaryRow";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { boardToCards } from "@/lib/solver/postflopNode";
import { summaryFromRawText } from "@/pages/handhistory/create/replay";
import {
  solutionKey,
  solutionOpenUrl,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";

export interface PostflopLibraryProps {
  /** Parent stays mounted and toggles this so the drawer's exit animation plays. */
  open: boolean;
  entries: PostflopIndexEntry[];
  loading: boolean;
  signInRequired?: boolean;
  onSignIn?: () => void;
  onOpen: (entry: PostflopIndexEntry) => void;
  onClose: () => void;
  /** Remove boards from this viewer's library. */
  onRemove?: (entries: PostflopIndexEntry[]) => Promise<void>;
  /** Put them back (Undo). */
  onRestore?: (entries: PostflopIndexEntry[]) => Promise<void>;
  /** Saved hand id -> rawText, for the preview above each hand's boards. */
  handTextById?: Record<number, string>;
  /** Delete the hand history itself (confirm + API + cache eviction live in
   *  the host). Board removal stays on the per-tile trash button. */
  onDeleteHand?: (id: number) => void | Promise<void>;
}

type LineGroup = {
  key: string;
  stacks: string;
  lineLabel: string;
  icm: boolean;
  boards: PostflopIndexEntry[];
};

type HandGroup = {
  key: string;
  handHistoryId: number | null;
  newest: string;
  boards: PostflopIndexEntry[];
};

const newestFirst = (a: PostflopIndexEntry, b: PostflopIndexEntry) =>
  (b.created_utc || "").localeCompare(a.created_utc || "");

/** One board: a card trio that opens it, with a remove affordance on top.
 *  The remove button is a sibling rather than a child - a button inside a
 *  button is invalid markup, and the click would have to be swallowed. */
const BoardTile: React.FC<{
  entry: PostflopIndexEntry;
  onOpen: () => void;
  onRemove?: () => void;
  busy?: boolean;
}> = ({ entry, onOpen, onRemove, busy }) => (
  <div className="relative">
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-400/50 px-2 py-1.5 shadow-sm transition-all hover:-translate-y-0.5 disabled:opacity-50"
      title={`Open ${entry.board}`}
      disabled={busy}
      data-testid="library-board"
      data-board={entry.board}
    >
      {boardToCards(entry.board).map((code) => (
        <PlayingCard key={code} code={code} width="clamp(26px, 5vw, 38px)" />
      ))}
    </button>
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove ${entry.board} from library`}
        title="Remove from library"
        data-testid="library-remove"
        className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-slate-800 text-gray-400 opacity-70 shadow transition-all hover:scale-110 hover:bg-rose-600 hover:text-white hover:opacity-100 disabled:opacity-40"
      >
        <Trash2 size={10} />
      </button>
    )}
  </div>
);

const PostflopLibrary: React.FC<PostflopLibraryProps> = ({
  open,
  entries,
  loading,
  signInRequired,
  onSignIn,
  onOpen,
  onClose,
  onRemove,
  onRestore,
  handTextById,
  onDeleteHand,
}) => {
  /* What the last remove took out, so it can be put back. Cleared on a timer
     so the pill doesn't linger over the list forever. */
  const [undo, setUndo] = useState<{ entries: PostflopIndexEntry[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const undoTimer = useRef<number | null>(null);

  const offerUndo = (removed: PostflopIndexEntry[], label: string) => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo({ entries: removed, label });
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };

  const remove = async (targets: PostflopIndexEntry[], label: string) => {
    if (!onRemove || targets.length === 0) return;
    setBusy(true);
    try {
      await onRemove(targets);
      offerUndo(targets, label);
    } catch {
      /* the hook restores the list; nothing to offer undoing */
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!undo || !onRestore) return;
    const targets = undo.entries;
    setUndo(null);
    setBusy(true);
    try {
      await onRestore(targets);
    } finally {
      setBusy(false);
    }
  };

  /* Hand-history solves: one group per recorded hand. Entries queued before
     provenance was tracked have no id and share a single unlabelled group. */
  const handGroups: HandGroup[] = useMemo(() => {
    const byKey = new Map<string, HandGroup>();
    for (const e of entries) {
      if (e.source !== "handHistory") continue;
      const id = typeof e.hand_history_id === "number" ? e.hand_history_id : null;
      const key = id == null ? "unlinked" : `hh-${id}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, handHistoryId: id, newest: "", boards: [] };
        byKey.set(key, group);
      }
      group.boards.push(e);
    }
    for (const g of byKey.values()) {
      g.boards.sort(newestFirst);
      g.newest = g.boards[0]?.created_utc ?? "";
    }
    return [...byKey.values()].sort((a, b) => b.newest.localeCompare(a.newest));
  }, [entries]);

  /* Sim solves keep the original grouping: sim folder + preflop line. */
  const lineGroups: LineGroup[] = useMemo(() => {
    const byKey = new Map<string, LineGroup>();
    for (const e of entries) {
      if (e.source === "handHistory") continue;
      const lineLabel =
        Array.isArray(e.preflop_line) && e.preflop_line.length > 1
          ? e.preflop_line.slice(1).join(" · ")
          : "Unknown line";
      const key = `${e.stacks}|${lineLabel}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, stacks: e.stacks, lineLabel, icm: e.icm, boards: [] };
        byKey.set(key, group);
      }
      group.boards.push(e);
    }
    for (const g of byKey.values()) g.boards.sort(newestFirst);
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [entries]);

  const isEmpty = handGroups.length === 0 && lineGroups.length === 0;

  /* The component stays mounted across open/close now, so an undo pill from a
     previous visit would otherwise greet the next open. */
  useEffect(() => {
    if (open) return;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndo(null);
  }, [open]);

  return (
    <ResponsiveDrawer
      open={open}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-2xl"
      zClassName="z-[80]"
      ariaLabelledBy="solution-library-title"
    >
      <div className="px-4 pt-2 sm:pt-4 pr-12">
        <h2 id="solution-library-title" className="text-base font-semibold mb-1">
          Solution Library
        </h2>
        <p className="text-xs text-gray-300 mb-3">
          Every board that has been solved. Open one to browse its postflop strategy.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
          {signInRequired ? (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-gray-300">
                Sign in to browse your solution library.
              </p>
              <button
                type="button"
                onClick={onSignIn}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 shadow"
              >
                Sign in
              </button>
            </div>
          ) : loading ? (
            <div className="py-8 text-center text-sm text-gray-400 animate-pulse">
              Loading solved boards…
            </div>
          ) : isEmpty ? (
            <div className="py-8 text-center text-sm text-gray-400">
              No solutions yet. Walk a heads-up preflop line to a Call and pick a flop
              to request the first one.
            </div>
          ) : (
            <div className="space-y-6">
              {handGroups.length > 0 && (
                <section data-testid="library-hand-section">
                  <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-emerald-300">
                    From your hands
                  </h3>
                  <div className="space-y-3">
                    {handGroups.map((group) => {
                      const rawText =
                        group.handHistoryId != null
                          ? handTextById?.[group.handHistoryId]
                          : undefined;
                      /* The preview's board fan is the click target that opens
                         the solution, so the separate flop tiles only render
                         when the preview can't show a board (no saved text, or
                         a legacy hand without a replay payload). */
                      const boardInPreview = rawText
                        ? (summaryFromRawText(rawText)?.board.length ?? 0) > 0
                        : false;
                      return (
                        <div
                          key={group.key}
                          className="rounded-xl border border-white/10 bg-white/[0.03] p-2"
                        >
                          <div className={boardInPreview ? "" : "mb-2"}>
                            {rawText ? (
                              <HandSummaryRow
                                rawText={rawText}
                                tone="dark"
                                replayHref={`/hand-history/replay/${group.handHistoryId}`}
                                solutionHref={solutionOpenUrl(group.boards[0])}
                                onOpenSolution={() => onOpen(group.boards[0])}
                                onBoardClick={() => {
                                  onOpen(group.boards[0]);
                                  onClose();
                                }}
                                shareId={group.handHistoryId}
                                onDelete={
                                  onDeleteHand
                                    ? () => void onDeleteHand(group.handHistoryId!)
                                    : undefined
                                }
                                onNavigate={onClose}
                              />
                            ) : (
                              <span className="text-[0.7rem] text-gray-400">
                                {group.handHistoryId == null
                                  ? "Recorded hand"
                                  : "Hand no longer saved"}
                              </span>
                            )}
                          </div>
                          {!boardInPreview && (
                            <div className="flex flex-wrap gap-2">
                              {group.boards.map((entry) => (
                                <BoardTile
                                  key={solutionKey(entry)}
                                  entry={entry}
                                  busy={busy}
                                  onOpen={() => onOpen(entry)}
                                  onRemove={
                                    onRemove
                                      ? () => void remove([entry], `${entry.board} removed`)
                                      : undefined
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {lineGroups.length > 0 && (
                <section data-testid="library-sim-section">
                  {handGroups.length > 0 && (
                    <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-gray-400">
                      From preflop sims
                    </h3>
                  )}
                  <div className="space-y-4">
                    {lineGroups.map((group) => (
                      <div key={group.key}>
                        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-semibold text-gray-100">
                            {group.lineLabel}
                          </span>
                          <span
                            className="truncate text-[0.65rem] text-gray-400"
                            title={group.stacks}
                          >
                            {group.stacks}
                          </span>
                          {group.icm && (
                            <span className="rounded-full bg-amber-500/15 border border-amber-400/40 px-1.5 text-[0.6rem] text-amber-200">
                              ICM
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.boards.map((entry) => (
                            <BoardTile
                              key={solutionKey(entry)}
                              entry={entry}
                              busy={busy}
                              onOpen={() => onOpen(entry)}
                              onRemove={
                                onRemove
                                  ? () => void remove([entry], `${entry.board} removed`)
                                  : undefined
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

      {undo && onRestore && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/15 bg-slate-800/95 px-3 py-1.5 text-[0.7rem] text-gray-200 shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
            <span>{undo.label}</span>
            <button
              type="button"
              onClick={() => void restore()}
              className="font-semibold text-emerald-300 hover:text-emerald-200"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </ResponsiveDrawer>
  );
};

export default PostflopLibrary;
