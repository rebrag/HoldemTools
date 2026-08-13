// src/pages/handhistory/HandRow.tsx
// One saved-hand row in the Hand History list. The row body (card fans, stat
// stack, action buttons) is the shared HandSummaryRow so hands look identical
// here, in the bankroll session drawer, and in the Solution Library; this
// wrapper adds what is list-specific: the expand/collapse raw-text panel and
// the enter/exit motion. The session label is a group header owned by
// HandHistoryTool, not a per-row pill. Memoized so top-level state changes in
// HandHistoryTool only reconcile the rows whose props actually changed.
import React from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import HandSummaryRow from "@/components/HandSummaryRow";
import { bestReplayUrl } from "@/lib/handHistoryLinks";
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
  /** Deep link to this hand's solved board on /solutions, or null when the
   *  hand has no solution. A plain string so React.memo stays effective. */
  solutionHref: string | null;
  expanded: boolean;
  onToggleExpand: (key: string) => void;
  onDelete: (row: ToolRow) => void;
  onError: (message: string) => void;
};

const HandRow: React.FC<HandRowProps> = ({
  row,
  solutionHref,
  expanded,
  onToggleExpand,
  onDelete,
  onError,
}) => (
  <motion.li
    variants={itemVariants}
    exit="exit"
    className="px-2 py-1.5 transition-colors hover:bg-emerald-50/60 sm:px-3"
  >
    <HandSummaryRow
      rawText={row.rawText}
      replayHref={
        row.replayable ? bestReplayUrl(row.key, row.server?.shareToken) : null
      }
      shareToken={row.server?.shareToken ?? null}
      solutionHref={solutionHref}
      shareId={
        row.replayable && !row.isLocal && !row.synthetic && row.server
          ? row.server.id
          : null
      }
      onDelete={row.synthetic ? undefined : () => onDelete(row)}
      onError={onError}
      onPreviewClick={() => onToggleExpand(row.key)}
      previewExpanded={expanded}
    />

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

export default React.memo(HandRow);
