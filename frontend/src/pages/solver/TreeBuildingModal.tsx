// TreeBuildingModal.tsx
//
// Chrome around the shared TreeBuilding panel, shown before a game tree is
// uploaded for solving. Two entry points:
//   - Solver: opens when a heads-up preflop call closes the action, prefilled
//     from the preflop sim (ranges from plates, pot/stacks from the line).
//   - Hand history: opens when a recorded hand that saw a heads-up flop
//     completes, prefilled from the recorded hand (pot, stacks, flop, bet
//     sizes derived from the actual bets, ranges from canned charts).
//
// This file owns the drawer, the header, the footer and the confirm gate. The
// fields themselves live in components/TreeBuilding.tsx, shared with /compare.
//
// The draft is ONE view object plus an untouched carry, not a per-field pile
// of useState. That matters beyond tidiness: round-tripping TreeParams through
// the view on every keystroke would erase anything the view cannot represent,
// and the carry is where the frozen chip scale lives (see treeParamsView.ts).
import { useMemo, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import TreeBuilding from "@/components/TreeBuilding";
import {
  inspectTreeView,
  parseBoardCards,
  type TreeBuildingView,
} from "@/components/treeBuildingView";
import { boardToCards } from "@/lib/solver/postflopNode";
import type { PostflopIndexEntry } from "@/lib/solver/postflopLibrary";
import { mergeTreeParams, splitTreeParams } from "@/lib/solver/treeParamsView";
import { pioRangeCodec } from "@/lib/solver/rangeTokens";
import type { TreeParams } from "@/lib/solver/treeConfig";

export interface TreeBuildingInit {
  params: TreeParams;
  flopCards: string[];
  oopLabel: string;
  ipLabel: string;
  /** Unit shown beside the pot and stacks. Sims are in big blinds; a recorded
   *  hand is in its own chips. */
  moneyLabel?: string;
}

interface TreeBuildingModalProps {
  init: TreeBuildingInit;
  /** Boards already solved for this line - offered as instant opens. */
  solvedForLine: PostflopIndexEntry[];
  busy: boolean;
  /** Success message shown after the upload lands (parent closes shortly after). */
  notice?: string | null;
  error?: string | null;
  onConfirm: (result: { params: TreeParams; flopCards: string[] }) => void;
  onClose: () => void;
  onOpenSolvedBoard?: (entry: PostflopIndexEntry) => void;
}

const TreeBuildingModal = ({
  init,
  solvedForLine,
  busy,
  notice,
  error,
  onConfirm,
  onClose,
  onOpenSolvedBoard,
}: TreeBuildingModalProps) => {
  /* Initialized once per mount; both parents mount this modal fresh. `carry`
   * is never written - it holds the fields this screen does not edit, the
   * frozen chip scale among them. */
  const [draft, setDraft] = useState(() => splitTreeParams(init.params, init.flopCards));

  const setView = (view: TreeBuildingView) => setDraft((d) => ({ ...d, view }));

  const { view, carry } = draft;

  const flopCards = useMemo(() => parseBoardCards(view.board), [view.board]);
  const issues = useMemo(
    () => inspectTreeView(view, { requireLeadSizePerStreet: true }),
    [view]
  );

  const potChips = Math.round(Number(view.pot) * carry.chipScale);
  const effChips = Math.round(Number(view.effectiveStacks) * carry.chipScale);

  const allStreetsHaveBet = issues.missingLead.length === 0;

  const canConfirm =
    !busy &&
    !notice &&
    flopCards.length === 3 &&
    new Set(flopCards).size === 3 &&
    Object.keys(view.oopRange).length > 0 &&
    Object.keys(view.ipRange).length > 0 &&
    Number.isFinite(potChips) &&
    potChips > 0 &&
    Number.isFinite(effChips) &&
    effChips > 0 &&
    issues.badSizes.length === 0 &&
    allStreetsHaveBet;

  const confirm = () => {
    if (!canConfirm) return;
    const { params, boardCards } = mergeTreeParams(carry, view);
    onConfirm({ params, flopCards: boardCards });
  };

  /* Already-solved shortcuts. Page-owned content: it is typed on a solver
     library entry, and dragging that type into src/components would point the
     dependency the wrong way, so it rides in as headerSlot instead. */
  const solvedStrip =
    solvedForLine.length > 0 && onOpenSolvedBoard ? (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
        <div className="mb-1 text-[11px] font-semibold text-emerald-200">
          Already solved for this line - open instantly:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {solvedForLine.map((entry) => (
            <button
              key={`${entry.node_name}-${entry.board}`}
              type="button"
              onClick={() => onOpenSolvedBoard(entry)}
              className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 px-1.5 py-1 transition-colors hover:bg-emerald-500/20"
              title={`Open ${entry.board}`}
            >
              {boardToCards(entry.board).map((code) => (
                <PlayingCard key={code} code={code} width="clamp(22px, 4vw, 30px)" />
              ))}
            </button>
          ))}
        </div>
      </div>
    ) : undefined;

  return (
    /* Both parents mount this modal conditionally (its draft state is
     * initialized once per mount), so `open` is a constant true and the
     * drawer's exit animation is skipped — an accepted trade-off here. */
    <ResponsiveDrawer
      open
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-3xl"
      zClassName="z-[80]"
      ariaLabel="Tree building parameters"
    >
      <>
        <div className="px-4 pt-2 sm:pt-4">
          <h2 className="text-base font-semibold">Tree building parameters</h2>
          <p className="mb-2 text-xs text-gray-400">
            Review the game tree before it's sent off to be solved. Every field is editable.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          <TreeBuilding
            value={view}
            onChange={setView}
            disabled={busy}
            boardMaxCards={3}
            boardVariant="slots"
            boardParse="strict"
            oopLabel={init.oopLabel}
            ipLabel={init.ipLabel}
            moneyLabel={init.moneyLabel ?? "bb"}
            requireLeadSizePerStreet
            pioChipLimits={{ chipScale: carry.chipScale }}
            rangeCodec={pioRangeCodec}
            headerSlot={solvedStrip}
          />
        </div>

        {/* Footer — pinned to the sheet's bottom edge on mobile, so pad for
            the iOS home indicator. */}
        <div className="border-t border-white/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {notice && (
            <div className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}
          {error && (
            <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          {!allStreetsHaveBet && (
            <p className="mb-2 text-[11px] text-red-400">
              Each street needs at least one bet size.
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-200 shadow-sm hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow
                ${
                  canConfirm
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "cursor-not-allowed bg-emerald-600/50 text-white/70"
                }`}
            >
              <span>{busy ? "Uploading…" : "Upload & solve"}</span>
              {!busy && <span aria-hidden="true">✓</span>}
            </button>
          </div>
        </div>
      </>
    </ResponsiveDrawer>
  );
};

export default TreeBuildingModal;
