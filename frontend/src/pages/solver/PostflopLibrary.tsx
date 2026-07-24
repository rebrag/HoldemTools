// Library of previously solved postflop boards: grouped by sim folder and
// preflop line, each board shown as three mini cards. Click to reopen.
import React, { useMemo } from "react";
import { X } from "lucide-react";
import PlayingCard from "@/components/PlayingCard";
import { boardToCards } from "@/lib/solver/postflopNode";
import type { PostflopIndexEntry } from "@/lib/solver/postflopLibrary";

export interface PostflopLibraryProps {
  entries: PostflopIndexEntry[];
  loading: boolean;
  onOpen: (entry: PostflopIndexEntry) => void;
  onClose: () => void;
}

type LineGroup = {
  key: string;
  stacks: string;
  lineLabel: string;
  icm: boolean;
  boards: PostflopIndexEntry[];
};

const PostflopLibrary: React.FC<PostflopLibraryProps> = ({
  entries,
  loading,
  onOpen,
  onClose,
}) => {
  const groups: LineGroup[] = useMemo(() => {
    const byKey = new Map<string, LineGroup>();
    for (const e of entries) {
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
    for (const g of byKey.values()) {
      g.boards.sort((a, b) => (b.created_utc || "").localeCompare(a.created_utc || ""));
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [entries]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-3 max-h-[85vh] flex flex-col rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl p-4 text-gray-100"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white border border-white/10 shadow-sm"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <h2 className="text-base font-semibold mb-1">Solved flops</h2>
        <p className="text-xs text-gray-300 mb-3">
          Every board that has been solved. Open one to browse its postflop strategy.
        </p>

        <div className="overflow-y-auto pr-1 -mr-1">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400 animate-pulse">
              Loading solved boards…
            </div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              No solved flops yet. Walk a heads-up preflop line to a Call and pick a flop
              to request the first one.
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.key}>
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold text-gray-100">
                      {group.lineLabel}
                    </span>
                    <span className="truncate text-[0.65rem] text-gray-400" title={group.stacks}>
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
                      <button
                        key={`${entry.node_name}-${entry.board}`}
                        type="button"
                        onClick={() => onOpen(entry)}
                        className="group flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-400/50 px-2 py-1.5 shadow-sm transition-all hover:-translate-y-0.5"
                        title={`Open ${entry.board}`}
                      >
                        {boardToCards(entry.board).map((code) => (
                          <PlayingCard key={code} code={code} width="clamp(26px, 5vw, 38px)" />
                        ))}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostflopLibrary;
