// Postflop breadcrumb: preflop context chip, board cards, then one chip per
// postflop action. Clicking a chip jumps back to that node.
import React from "react";
import { RotateCcw, X } from "lucide-react";
import PlayingCard from "@/components/PlayingCard";
import { getColorForAction, stringToColor } from "@/lib/solver/utils";
import type { PostflopLineItem } from "@/hooks/usePostflopSession";

export interface PostflopLineProps {
  preflopLine: string[] | null;
  board: string[];
  line: PostflopLineItem[];
  currentNodeId: string;
  notice: string | null;
  onJump: (nodeId: string) => void;
  onExit: () => void;
  matchWidth?: number;
}

const chipColor = (label: string) => getColorForAction(label) || stringToColor(label);

const PostflopLine: React.FC<PostflopLineProps> = ({
  preflopLine,
  board,
  line,
  currentNodeId,
  notice,
  onJump,
  onExit,
  matchWidth,
}) => {
  const preflopSummary =
    preflopLine && preflopLine.length > 1 ? preflopLine.slice(1).join(" · ") : null;

  return (
    <div className="w-full mx-auto select-none" style={{ maxWidth: matchWidth || undefined }}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-slate-900/70 px-2 py-1.5 animate-[fadeSlideIn_0.25s_ease-out]">
        {/* Exit postflop */}
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-1.5 py-1 text-[0.6rem] text-gray-300 transition-colors"
          title="Exit postflop view"
        >
          <X size={12} />
          <span>Preflop</span>
        </button>

        {/* Preflop context */}
        {preflopSummary && (
          <span
            className="max-w-[10rem] truncate text-[0.6rem] text-gray-400"
            title={preflopSummary}
          >
            {preflopSummary}
          </span>
        )}

        {/* Board */}
        <div className="inline-flex items-center gap-1 px-1">
          {board.map((code) => (
            <PlayingCard key={code} code={code} width="clamp(22px, 4vw, 34px)" />
          ))}
        </div>

        {/* Root chip */}
        <button
          type="button"
          onClick={() => onJump("r:0")}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.65rem] font-medium transition-colors ${
            currentNodeId === "r:0"
              ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/50"
              : "bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10"
          }`}
          title="Back to the flop decision"
        >
          <RotateCcw size={11} />
          <span>Flop</span>
        </button>

        {/* Action / dealt-card chips */}
        {line.map((item) => {
          const isCurrent = item.nodeId === currentNodeId;
          const chipClass = `inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.65rem] font-medium transition-colors ${
            isCurrent
              ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/50"
              : "bg-white/5 text-gray-200 border border-white/10 hover:bg-white/10"
          }`;
          if (item.kind === "card") {
            return (
              <button
                key={item.nodeId}
                type="button"
                onClick={() => onJump(item.nodeId)}
                className={chipClass}
                title={`Jump to the ${item.label} deal`}
              >
                <PlayingCard code={item.label} width="clamp(18px, 3.4vw, 26px)" />
              </button>
            );
          }
          return (
            <button
              key={item.nodeId}
              type="button"
              onClick={() => onJump(item.nodeId)}
              className={chipClass}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-[2px]"
                style={{ backgroundColor: chipColor(item.label) }}
              />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}

        {notice && (
          <span className="ml-1 rounded-md bg-amber-500/15 border border-amber-400/40 px-2 py-1 text-[0.6rem] text-amber-200">
            {notice}
          </span>
        )}
      </div>
    </div>
  );
};

export default PostflopLine;
