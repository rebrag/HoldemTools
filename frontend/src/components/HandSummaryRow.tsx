// src/components/HandSummaryRow.tsx
// The complete saved-hand row, shared verbatim by the hand-history list, the
// bankroll session drawer, and the Solution Library so a hand looks identical
// everywhere: card fans (HandPreview) · a stacked stat block (flop pot, final
// pot, flop SPR) · the full action set (Replay, View solution, Share, Copy,
// Delete). Hosts control which actions exist by passing/omitting the matching
// prop; the row owns Copy and Share end to end so every surface gets them
// without re-implementing clipboard/token plumbing.
import React, { useMemo, useState } from "react";
import { Play, Library, Share2, Copy, Check, Trash2 } from "lucide-react";
import RowActionButton, { rowActionClasses } from "@/components/RowActionButton";
import HandPreview from "@/components/HandPreview";
import { summaryFromRawText, stripReplay } from "@/pages/handhistory/create/replay";
import { fmtChips } from "@/pages/handhistory/create/engine";
import { copyText } from "@/lib/clipboard";
import { SHARE_ENABLED, createShareToken, shareUrl } from "@/lib/shareApi";

// SPR reads as an integer once it stops being a decision-relevant fraction.
function fmtSpr(spr: number): string {
  return spr >= 10 ? String(Math.round(spr)) : (Math.round(spr * 10) / 10).toString();
}

export interface HandSummaryRowProps {
  rawText: string;
  /** Palette: "light" (hand-history page) or "dark" (drawer surfaces). */
  tone?: "light" | "dark";
  /** Replay route ("Replay hand"). Opens in a new tab. Omit to hide. */
  replayHref?: string | null;
  /** Solution deep link. Opens in a new tab unless onOpenSolution overrides
   *  (the Solution Library opens the board in place, since the viewer is
   *  already on /solutions). */
  solutionHref?: string | null;
  onOpenSolution?: () => void;
  /** Server hand id — enables Share (gated by SHARE_ENABLED). */
  shareId?: number | null;
  /** Delete the hand. The host owns confirm + API + list state. */
  onDelete?: () => void;
  /** Called after an in-place solution open, so a hosting drawer can close
   *  over the board it just loaded. The new-tab actions never fire it: the
   *  host page is exactly where the user left it. */
  onNavigate?: () => void;
  /** Surface Share failures; defaults to console.warn. */
  onError?: (message: string) => void;
  /** When set, the card-fan region becomes an expand/collapse toggle. */
  onPreviewClick?: () => void;
  previewExpanded?: boolean;
  /** Makes the preview's board fan clickable (see HandPreview.onBoardClick).
   *  Mutually exclusive with onPreviewClick — nested buttons are invalid. */
  onBoardClick?: () => void;
}

const HandSummaryRow: React.FC<HandSummaryRowProps> = ({
  rawText,
  tone = "light",
  replayHref,
  solutionHref,
  onOpenSolution,
  shareId,
  onDelete,
  onNavigate,
  onError,
  onPreviewClick,
  previewExpanded,
  onBoardClick,
}) => {
  const summary = useMemo(() => summaryFromRawText(rawText), [rawText]);
  const [flash, setFlash] = useState<"copied" | "shared" | null>(null);
  const [sharing, setSharing] = useState(false);

  const dark = tone === "dark";
  const label = dark ? "text-slate-400" : "text-gray-500";
  const value = dark ? "text-slate-100" : "text-gray-800";

  const flashBriefly = (kind: "copied" | "shared") => {
    setFlash(kind);
    window.setTimeout(() => setFlash((f) => (f === kind ? null : f)), 1500);
  };

  const handleCopy = async () => {
    if (await copyText(stripReplay(rawText))) flashBriefly("copied");
  };

  // Mint a public share link and offer it via the native share sheet (mobile)
  // or the clipboard (desktop) — same flow the hand-history page always had.
  const handleShare = async () => {
    if (shareId == null) return;
    setSharing(true);
    try {
      const url = shareUrl(await createShareToken(shareId));
      if (navigator.share) {
        try {
          await navigator.share({ title: "Poker hand replay", url });
          flashBriefly("shared");
        } catch {
          /* user dismissed the share sheet — no-op */
        }
      } else if (await copyText(url)) {
        flashBriefly("shared");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "We couldn't create a share link.";
      if (onError) onError(message);
      else console.warn(message);
    } finally {
      setSharing(false);
    }
  };

  const fans = (
    <HandPreview
      rawText={rawText}
      tone={tone}
      onBoardClick={onPreviewClick ? undefined : onBoardClick}
    />
  );

  const stat = (text: string, v: string | null) => (
    <div className="flex items-baseline justify-between gap-1.5 leading-tight">
      <span className={`font-medium ${label}`}>{text}</span>
      <span className={`font-semibold tabular-nums ${v == null ? label : value}`}>
        {v ?? "-"}
      </span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {onPreviewClick ? (
        <button
          type="button"
          onClick={onPreviewClick}
          aria-expanded={previewExpanded}
          className="min-w-0 flex-1 text-left"
        >
          {fans}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{fans}</div>
      )}

      {/* Stats + actions travel as one unit so narrow screens wrap them below
          the fans together instead of orphaning the stat stack. */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {summary && (
          <div className="min-w-[76px] text-[10px]">
            {stat("Flop", summary.potAtFlop != null ? `$${fmtChips(summary.potAtFlop)}` : null)}
            {stat("Pot", `$${fmtChips(summary.finalPot)}`)}
            {stat("SPR", summary.flopSpr != null ? fmtSpr(summary.flopSpr) : null)}
            {stat(
              "Players",
              summary.playersAtFlop != null ? String(summary.playersAtFlop) : null
            )}
          </div>
        )}

        <ActionGrid>
          {/* Replay and Solution both leave the page the row is sitting on, so
              both open in a new tab and the list stays exactly where it was.
              Real anchors rather than window.open, so middle-click, ⌘-click and
              "open in new tab" all behave the way the icon promises. */}
          {replayHref && (
            <a
              key="replay"
              href={replayHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Replay hand"
              title="Replay hand"
              className={rowActionClasses("replay", tone, false, "sm")}
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" />
            </a>
          )}
          {/* The one exception: the Solution Library is itself on /solutions,
              so it overrides with onOpenSolution and loads the board in place
              rather than booting a second copy of the app. */}
          {solutionHref &&
            (onOpenSolution ? (
              <RowActionButton
                key="solution"
                tone="solution"
                variant={tone}
                size="sm"
                label="View solution"
                icon={<Library className="h-3.5 w-3.5" />}
                onClick={() => {
                  onOpenSolution();
                  onNavigate?.();
                }}
              />
            ) : (
              <a
                key="solution"
                href={solutionHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View solution"
                title="View solution"
                className={rowActionClasses("solution", tone, false, "sm")}
              >
                <Library className="h-3.5 w-3.5" />
              </a>
            ))}
          {SHARE_ENABLED && shareId != null && (
            <RowActionButton
              key="share"
              tone="share"
              variant={tone}
              size="sm"
              label="Share replay link"
              disabled={sharing}
              success={flash === "shared"}
              icon={
                flash === "shared" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Share2 className="h-3.5 w-3.5" />
                )
              }
              onClick={() => void handleShare()}
            />
          )}
          <RowActionButton
            key="copy"
            tone="copy"
            variant={tone}
            size="sm"
            label="Copy hand text"
            success={flash === "copied"}
            icon={
              flash === "copied" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )
            }
            onClick={() => void handleCopy()}
          />
          {onDelete && (
            <RowActionButton
              key="delete"
              tone="delete"
              variant={tone}
              size="sm"
              label="Delete hand"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={onDelete}
            />
          )}
        </ActionGrid>
      </div>
    </div>
  );
};

/** Stacks the action buttons two rows tall instead of one long row, so the
 *  card fans keep the horizontal space: 5 actions -> 3+2, 4 -> 2+2, 3 -> 2+1;
 *  1-2 stay a single row. The wrap width is computed from the column count
 *  (h-7 buttons + gap-1) and justify-end keeps a short last row right-aligned.
 *  Children are the conditional buttons; React.Children.toArray drops the
 *  falsy ones before counting. */
const BUTTON_PX = 28; // h-7 / w-7
const GAP_PX = 4; // gap-1

const ActionGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const items = React.Children.toArray(children);
  const cols = items.length <= 2 ? Math.max(items.length, 1) : Math.ceil(items.length / 2);
  return (
    <div
      className="flex shrink-0 flex-wrap justify-end gap-1"
      style={{ width: cols * BUTTON_PX + (cols - 1) * GAP_PX }}
    >
      {items}
    </div>
  );
};

export default React.memo(HandSummaryRow);
