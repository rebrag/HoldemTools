// src/pages/handhistory/create/SeatEditorModal.tsx
// Seat editor in the app's shared overlay shell (ResponsiveDrawer): a bottom
// sheet under 640px - thumb-reachable card entry mid-hand - and a centered
// modal above it, matching the board editor and quick setup.
//
// Dismissing (backdrop / Escape) COMMITS, same contract as BoardEditorModal:
// every edit is already visible in the form, so there is nothing hidden to
// discard, and "Cancel" stays as the explicit way to back out untouched.
//
// The parent keeps this mounted and toggles `open` so the sheet's exit
// animation plays; internal state re-seeds from props each time it opens.
import React, { useEffect, useId, useState } from "react";
import PlayingCard from "@/components/PlayingCard";
import RankSuitKeypad from "@/components/RankSuitKeypad";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import PlayerCombobox from "./PlayerCombobox";
import type { HoleCards, Seat } from "./types";

export interface SeatEditResult {
  seat: Seat;
  makeButton: boolean;
  makeHero: boolean;
  makeStraddle: boolean;
  straddleAmount: string;
}

interface Props {
  /** Mount permanently and toggle this, so the sheet's exit animation plays. */
  open: boolean;
  positionLabel: string;
  seat: Seat;
  isButton: boolean;
  isHero: boolean;
  isStraddle: boolean;
  /** 0-based order of this seat's straddle (existing, or the slot a fresh one
   *  would take): 0 = straddle, 1 = double straddle, 2 = triple straddle. */
  straddleOrder: number;
  /** Initial amount for the input: the seat's posted amount when it already
   *  straddles, otherwise double the previous straddle (or 2× BB for the first). */
  straddleAmount: string;
  canStraddle: boolean; // false once all straddle slots are taken by other seats
  capacity: number; // hole cards for this game (2 / 4 / 5)
  otherUsed: Set<string>; // cards assigned elsewhere (other seats + board)
  onSave: (result: SeatEditResult) => void;
  onClose: () => void;
  // Setup-phase structural actions on an occupied seat. Omitted during the
  // action phase, where changing who is in the hand isn't allowed.
  allowStructural?: boolean;
  onEmpty?: () => void; // remove the player, leaving an empty seat
  onMove?: () => void; // start moving this player to another seat
}

const fieldCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 transition-colors focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/40";

/** One row of the grouped toggle list: label left, checkbox right, the whole
 *  row tappable. Dimmed (not hidden) while sitting out, so the layout holds. */
const ToggleRow: React.FC<{
  label: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, disabled, onChange }) => (
  <label
    className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${
      disabled ? "cursor-default opacity-40" : "hover:bg-white/5"
    }`}
  >
    <span className="text-sm text-slate-200">{label}</span>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 accent-emerald-500"
    />
  </label>
);

const SeatEditorModal: React.FC<Props> = ({
  open,
  positionLabel,
  seat,
  isButton,
  isHero,
  isStraddle,
  straddleOrder,
  straddleAmount,
  canStraddle,
  capacity,
  otherUsed,
  onSave,
  onClose,
  allowStructural,
  onEmpty,
  onMove,
}) => {
  const titleId = useId();
  const nameInputId = useId();
  const [name, setName] = useState(seat.name);
  // Durable player link; the combobox clears it whenever the name text is
  // edited, so name and playerId can never silently disagree.
  const [playerId, setPlayerId] = useState(seat.playerId);
  const [stack, setStack] = useState(seat.stack);
  const [hole, setHole] = useState<HoleCards>(seat.holeCards);
  const [makeButton, setMakeButton] = useState(isButton);
  const [makeHero, setMakeHero] = useState(isHero);
  const [makeStraddle, setMakeStraddle] = useState(isStraddle);
  const [sittingOut, setSittingOut] = useState(!!seat.sittingOut);
  // Default: hide non-hero cards until showdown, show the hero's. An explicit
  // prior choice wins; `undefined` means "use the default", which we preserve on
  // save (below) so the default keeps following the hero if it's reassigned.
  const [hideCards, setHideCards] = useState(seat.hideUntilShowdown ?? !isHero);
  const [hideTouched, setHideTouched] = useState(false);
  const [straddleAmt, setStraddleAmt] = useState(straddleAmount);

  // Re-seed from the live seat each time the sheet opens. The component stays
  // mounted for its exit animation, so the initializers only ever run once.
  useEffect(() => {
    if (!open) return;
    setName(seat.name);
    setPlayerId(seat.playerId);
    setStack(seat.stack);
    setHole(seat.holeCards);
    setMakeButton(isButton);
    setMakeHero(isHero);
    setMakeStraddle(isStraddle);
    setSittingOut(!!seat.sittingOut);
    setHideCards(seat.hideUntilShowdown ?? !isHero);
    setHideTouched(false);
    setStraddleAmt(straddleAmount);
    // Props are intentionally not dependencies: re-syncing while the sheet is
    // open would fight the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = hole.filter((c): c is string => !!c);
  const gridUsed = new Set<string>([...otherUsed, ...selected]);

  const pad = (arr: string[]): HoleCards =>
    Array.from({ length: capacity }, (_, i) => arr[i] ?? null);

  const handlePick = (code: string) => {
    setHole((prev) => {
      const arr = prev.filter((c): c is string => !!c);
      if (arr.includes(code)) return pad(arr.filter((c) => c !== code));
      if (otherUsed.has(code)) return prev; // used elsewhere
      if (arr.length >= capacity) return prev;
      return pad([...arr, code]);
    });
  };

  const save = () => {
    // Don't resurrect a deliberately-empty seat on a no-op save (e.g. tapping the
    // backdrop): it only becomes occupied once something is entered.
    const filled =
      name.trim() !== "" || stack.trim() !== "" || hole.some((c) => !!c) || sittingOut;
    onSave({
      seat: {
        occupied: seat.occupied || filled,
        name: name.trim(),
        playerId,
        stack: stack.trim(),
        // A sitting-out seat isn't dealt in — drop its cards so they don't
        // count as used elsewhere.
        holeCards: sittingOut ? pad([]) : pad(hole.filter((c): c is string => !!c)),
        sittingOut,
        // Preserve "unset" (undefined) unless the user toggled the checkbox, so
        // the hero/non-hero default is derived at replay time.
        hideUntilShowdown: sittingOut
          ? undefined
          : hideTouched
            ? hideCards
            : seat.hideUntilShowdown,
      },
      makeButton: !sittingOut && makeButton,
      makeHero: !sittingOut && makeHero,
      makeStraddle: !sittingOut && canStraddle && makeStraddle,
      straddleAmount: straddleAmt.trim() || straddleAmount,
    });
  };

  return (
    <ResponsiveDrawer
      open={open}
      onClose={save}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-sm"
      /* Above the recorder's own overlays, matching the board editor. */
      zClassName="z-[1300]"
      showCloseButton={false}
      ariaLabelledBy={titleId}
    >
      <>
        {/* ── Header: the seat being edited is the headline ─────────────── */}
        <div className="px-5 pt-2 sm:pt-5 pb-3">
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-white">
            {positionLabel}
            <span className="ml-2 text-sm font-medium text-slate-400">seat</span>
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* ── Who's sitting here ────────────────────────────────────── */}
          <div className="grid grid-cols-[1fr_112px] gap-3">
            <div className="flex flex-col gap-1">
              {/* htmlFor instead of a wrapping <label>: wrapped, the linked
                  chip's unlink button would become the label's click target. */}
              <label htmlFor={nameInputId} className="text-xs font-medium text-slate-300">
                Name <span className="text-slate-500">(optional)</span>
              </label>
              <PlayerCombobox
                inputId={nameInputId}
                name={name}
                playerId={playerId}
                onChange={(nextName, nextPlayerId) => {
                  setName(nextName);
                  setPlayerId(nextPlayerId);
                }}
                placeholder={positionLabel}
                fieldClassName={fieldCls}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-300">Stack</span>
              <input
                type="tel"
                inputMode="decimal"
                value={stack}
                onChange={(e) => setStack(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="100"
                className={fieldCls}
              />
            </label>
          </div>

          {/* ── Table roles, grouped in one contained list ────────────── */}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-1">
            <ToggleRow
              label="Dealer button here"
              checked={!sittingOut && makeButton}
              disabled={sittingOut}
              onChange={setMakeButton}
            />
            <ToggleRow
              label="This is my hand (hero)"
              checked={!sittingOut && makeHero}
              disabled={sittingOut}
              onChange={(on) => {
                setMakeHero(on);
                // Follow the hero/non-hero hide default until the user overrides it.
                if (!hideTouched) setHideCards(!on);
              }}
            />
            {canStraddle && (
              <>
                <ToggleRow
                  label={
                    ["Posts a straddle", "Posts the double straddle", "Posts the triple straddle"][
                      straddleOrder
                    ] ?? "Posts a straddle"
                  }
                  checked={!sittingOut && makeStraddle}
                  disabled={sittingOut}
                  onChange={setMakeStraddle}
                />
                {!sittingOut && makeStraddle && (
                  <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-0.5">
                    <span className="text-xs text-slate-400">
                      {["Straddle", "Double straddle", "Triple straddle"][straddleOrder] ??
                        "Straddle"}{" "}
                      amount
                    </span>
                    <input
                      type="tel"
                      inputMode="decimal"
                      value={straddleAmt}
                      onChange={(e) => setStraddleAmt(e.target.value)}
                      className={`${fieldCls} w-24 py-1.5 text-right`}
                    />
                  </div>
                )}
              </>
            )}
            {!sittingOut && (
              <ToggleRow
                label={
                  <>
                    Hide cards until showdown{" "}
                    <span className="text-slate-500">(replays only)</span>
                  </>
                }
                checked={hideCards}
                onChange={(on) => {
                  setHideCards(on);
                  setHideTouched(true);
                }}
              />
            )}
            {allowStructural && (
              <ToggleRow
                label="Sitting out"
                checked={sittingOut}
                onChange={(on) => {
                  setSittingOut(on);
                  if (on) {
                    setMakeButton(false);
                    setMakeHero(false);
                    setMakeStraddle(false);
                  }
                }}
              />
            )}
          </div>

          {/* ── Hole cards (a sitting-out seat isn't dealt any) ───────── */}
          {!sittingOut && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Hole cards</span>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setHole(pad([]))}
                    className="text-[11px] text-slate-400 underline underline-offset-2 transition-colors hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                {Array.from({ length: capacity }, (_, i) => hole[i] ?? null).map((c, i) =>
                  c ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handlePick(c)}
                      aria-label={`Remove ${c}`}
                      className="rounded-lg transition-transform hover:-translate-y-[1px] active:scale-95"
                    >
                      <PlayingCard code={c} size="md" width={40} />
                    </button>
                  ) : (
                    <div
                      key={i}
                      className={`flex aspect-[3/4] w-10 items-center justify-center rounded-lg border border-dashed text-[10px] transition-colors ${
                        // The slot the keypad fills next, so it's obvious where
                        // the tapped card will land.
                        i === selected.length
                          ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                          : "border-white/20 bg-white/5 text-slate-500"
                      }`}
                    >
                      ?
                    </div>
                  )
                )}
              </div>
              <RankSuitKeypad
                used={gridUsed}
                onPick={handlePick}
                targetLabel={
                  selected.length < capacity ? name.trim() || positionLabel : undefined
                }
                className="rounded-xl border border-slate-700 bg-slate-900 p-2.5"
              />
            </div>
          )}

          {/* ── Setup-phase structural actions ────────────────────────── */}
          {allowStructural && seat.occupied && (
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => onMove?.()}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                ↔ Move player
              </button>
              <button
                type="button"
                onClick={() => onEmpty?.()}
                className="flex-1 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-400/20 hover:text-rose-200"
              >
                ✕ Empty seat
              </button>
            </div>
          )}
        </div>

        {/* ── Pinned footer ───────────────────────────────────────────── */}
        <div className="flex gap-2 border-t border-hairline px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-xl border border-hairline bg-white/5 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="flex-1 cursor-pointer rounded-xl bg-accent py-2.5 text-sm font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Done
          </button>
        </div>
      </>
    </ResponsiveDrawer>
  );
};

export default SeatEditorModal;
