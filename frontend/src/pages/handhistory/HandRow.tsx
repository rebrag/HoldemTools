// src/pages/handhistory/HandRow.tsx
// One saved-hand row in the Hand History list. Memoized so top-level state
// changes in HandHistoryTool (expanding another row, a copy/share flash, the
// mobile menu) don't reconcile every row's PlayingCard tree — only the rows
// whose props actually changed re-render.
import React from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { Play, Share2, Copy, Check, Trash2, MoreHorizontal } from "lucide-react";
import { SHARE_ENABLED } from "@/lib/shareApi";
import RowActionButton from "./RowActionButton";
import HandPreview from "./HandPreview";
import type { ToolRow } from "./types";

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

type HandRowProps = {
  row: ToolRow;
  /** Linked bankroll-session label ("location · blinds"), or "". */
  meta: string;
  expanded: boolean;
  menuOpen: boolean;
  flashKind: "copied" | "shared" | null;
  sharing: boolean;
  onToggleExpand: (key: string) => void;
  onToggleMenu: (key: string) => void;
  onCopy: (row: ToolRow) => void;
  onShare: (row: ToolRow) => void;
  onDelete: (row: ToolRow) => void;
  onReplay: (key: string) => void;
};

const HandRow: React.FC<HandRowProps> = ({
  row,
  meta,
  expanded,
  menuOpen,
  flashKind,
  sharing,
  onToggleExpand,
  onToggleMenu,
  onCopy,
  onShare,
  onDelete,
  onReplay,
}) => {
  // Secondary actions, shared between the desktop inline row and the
  // mobile "⋯" drawer.
  const shareBtn =
    SHARE_ENABLED && row.replayable && !row.isLocal && !row.synthetic && !!row.server ? (
      <RowActionButton
        tone="share"
        label="Share replay link"
        disabled={sharing}
        success={flashKind === "shared"}
        icon={
          flashKind === "shared" ? (
            <Check className="h-4 w-4" />
          ) : (
            <Share2 className="h-4 w-4" />
          )
        }
        onClick={() => onShare(row)}
      />
    ) : null;
  const copyBtn = (
    <RowActionButton
      tone="copy"
      label="Copy hand text"
      success={flashKind === "copied"}
      icon={
        flashKind === "copied" ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )
      }
      onClick={() => onCopy(row)}
    />
  );
  const deleteBtn = !row.synthetic ? (
    <RowActionButton
      tone="delete"
      label="Delete hand"
      icon={<Trash2 className="h-4 w-4" />}
      onClick={() => onDelete(row)}
    />
  ) : null;

  return (
    <motion.li
      variants={itemVariants}
      exit="exit"
      className="px-3 py-1.5 transition-colors hover:bg-emerald-50/60"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onToggleExpand(row.key)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          {meta && (
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
              onClick={() => onReplay(row.key)}
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
              onClick={() => onToggleMenu(row.key)}
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
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="sm:hidden"
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
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800"
          >
            {row.clean}
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.li>
  );
};

export default React.memo(HandRow);
