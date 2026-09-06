// src/pages/handhistory/players/PlayerEditorDrawer.tsx
// Create/edit drawer for a player: name, notes, photo upload (downscaled
// client-side before the authenticated multipart PUT), photo removal, delete,
// and the hands in which the player showed cards. Uses the app's shared
// dark-glass overlay shell (ResponsiveDrawer), same as the recorder's seat
// editor.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ZoomIn } from "lucide-react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import PlayerAvatar from "@/components/PlayerAvatar";
import HandPreview from "@/components/HandPreview";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import useHandHistoryTexts from "@/hooks/useHandHistoryTexts";
import { mutatePlayers } from "@/hooks/usePlayers";
import {
  createPlayer,
  deletePlayer,
  deletePlayerPhoto,
  updatePlayer,
  uploadPlayerPhoto,
  type Player,
} from "@/lib/playersApi";
import type { HandHistory } from "../types";
import PlayerPhotoLightbox from "./PlayerPhotoLightbox";
import { selectShowdownHands } from "./playerHands";

const fieldCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 transition-colors focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/40";

// Showdown hands shown before "Show all": a regular with hundreds of hands
// should not dump hundreds of card fans into a bottom sheet at once.
const SHOWDOWN_PAGE = 25;

// Downscale to a small JPEG before upload: phones shoot 10MB+ photos, and the
// server (which stores bytes verbatim in v1) caps uploads at 5MB. 1024px keeps
// the enlarged view crisp on a 3x phone screen (a 512px photo scaled up to a
// 390px-wide viewport reads soft) at roughly 150-300KB. `from-image` applies
// EXIF rotation so portrait phone shots don't upload sideways. Falls back to
// the original file when decoding fails (e.g. an already-small image in an
// odd container).
async function downscalePhoto(file: File, maxDim = 1024): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
        "image/jpeg",
        0.85
      )
    );
  } catch {
    return file;
  }
}

// "Jul 7", or "Jul 7, 2025" once the hand is from another year.
function fmtHandDate(iso: string): string {
  const d = new Date(iso);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
  });
}

interface Props {
  /** Mount permanently and toggle this, so the sheet's exit animation plays. */
  open: boolean;
  /** Existing player to edit, or null to create a new one. */
  player: Player | null;
  /** Hands this player appears in (shown next to Delete as context). */
  handCount?: number;
  /** The user's saved hands, for the "Showdown hands" section. An array is
   *  the host's own list (no request; deletes there show here live), null
   *  means the host is still loading it. Omit it entirely when the host has
   *  no list (the recorder): the drawer then downloads one itself, once per
   *  mount. */
  hands?: HandHistory[] | null;
  onClose: () => void;
  /** Adds an "All players & link hands" link to the footer. Omitted where it
   *  would be a no-op (the roster page itself) or destructive (the recorder,
   *  where navigating away discards the in-progress hand). */
  onOpenRoster?: () => void;
  /** Stacking context, when the host layers other overlays (the recorder's
   *  seat editor sits at z-[1300]). Defaults to ResponsiveDrawer's z-50. */
  zClassName?: string;
}

const PlayerEditorDrawer: React.FC<Props> = ({
  open,
  player,
  handCount,
  hands,
  onClose,
  onOpenRoster,
  zClassName,
}) => {
  const titleId = useId();
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "save" | "photo" | "removePhoto" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  // The saved row this drawer is working on (set after create, so a photo can
  // be added in the same visit).
  const [current, setCurrent] = useState<Player | null>(player);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [showAllHands, setShowAllHands] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent(player);
    setName(player?.name ?? "");
    setNotes(player?.notes ?? "");
    setBusy(null);
    setError(null);
    setPhotoOpen(false);
    setShowAllHands(false);
    // Re-seed only when (re)opened; re-syncing while open would fight edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Showdown hands source ──────────────────────────────────────────────
  // Hosts with the hand list pass it in. Without one, fetch our own - latched
  // on the first open with a saved player and never re-armed, so a live
  // session in the recorder pays one list download per mount, not per tap
  // (hands saved during that visit show up after the next mount).
  const [wantOwnHands, setWantOwnHands] = useState(false);
  useEffect(() => {
    if (open && current && hands === undefined) setWantOwnHands(true);
  }, [open, current, hands]);
  const own = useHandHistoryTexts(wantOwnHands);
  const source: HandHistory[] | null = hands !== undefined ? hands : own.rows;
  const handsFailed = hands === undefined && own.failed;
  const handsPending = !!current && source === null && !handsFailed;
  const showHandsSpinner = useDelayedLoading(handsPending);

  const showdownHands = useMemo(
    () => (current && source ? selectShowdownHands(source, current.id) : []),
    [current, source]
  );
  const visibleHands = showAllHands ? showdownHands : showdownHands.slice(0, SHOWDOWN_PAGE);

  const canSave = name.trim().length > 0 && busy == null;

  // ResponsiveDrawer binds Escape on `window` per open drawer, so with the
  // lightbox up both would close on one press. The lightbox's own listener
  // closes it; this one stands down until it is gone.
  const close = () => {
    if (photoOpen) return;
    onClose();
  };

  const save = async () => {
    if (!canSave) return;
    setBusy("save");
    setError(null);
    try {
      const saved = current
        ? await updatePlayer(current.id, { name: name.trim(), notes: notes.trim() || null })
        : await createPlayer(name.trim(), notes.trim() || undefined);
      mutatePlayers([saved]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this player.");
    } finally {
      setBusy(null);
    }
  };

  // Photo actions need a saved row; for a brand-new player we create it from
  // the typed name first, then attach the photo, so "add player with photo"
  // is one visit instead of two.
  const ensureSaved = async (): Promise<Player | null> => {
    if (current) return current;
    if (!name.trim()) {
      setError("Give the player a name first.");
      return null;
    }
    const created = await createPlayer(name.trim(), notes.trim() || undefined);
    mutatePlayers([created]);
    setCurrent(created);
    return created;
  };

  const handlePhotoPicked = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy("photo");
    setError(null);
    try {
      const target = await ensureSaved();
      if (!target) return;
      const blob = await downscalePhoto(file);
      const saved = await uploadPlayerPhoto(target.id, blob);
      mutatePlayers([saved]);
      setCurrent(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload that photo.");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    if (!current?.hasPhoto || busy) return;
    setBusy("removePhoto");
    setError(null);
    try {
      await deletePlayerPhoto(current.id);
      const next: Player = { ...current, hasPhoto: false, photoUpdatedAt: null };
      mutatePlayers([next]);
      setCurrent(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the photo.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!current || busy) return;
    const kept =
      handCount != null && handCount > 0
        ? ` Hands they appear in are kept (the name stays on them).`
        : "";
    if (!window.confirm(`Delete ${current.name}? This can't be undone.${kept}`)) return;
    setBusy("delete");
    setError(null);
    try {
      await deletePlayer(current.id);
      mutatePlayers([], [current.id]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this player.");
    } finally {
      setBusy(null);
    }
  };

  const hasPhoto = !!current?.hasPhoto;
  const pickPhoto = () => fileInputRef.current?.click();

  return (
    <ResponsiveDrawer
      open={open}
      onClose={close}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-sm"
      zClassName={zClassName}
      showCloseButton={false}
      ariaLabelledBy={titleId}
    >
      <>
        <div className="px-5 pt-2 sm:pt-5 pb-3">
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-white">
            {current ? "Edit player" : "New player"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {/* ── Photo ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            {/* With a photo the avatar opens it full size - that is what a
                photo is for. Without one it opens the picker. Changing an
                existing photo moved to the text link beside "Remove photo". */}
            <button
              type="button"
              onClick={hasPhoto ? () => setPhotoOpen(true) : pickPhoto}
              disabled={busy === "photo"}
              aria-label={hasPhoto ? "View photo" : "Add photo"}
              className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <PlayerAvatar
                player={current}
                name={name}
                size="lg"
                className="ring-white/20"
              />
              {/* Hover/press overlay makes the avatar's tap affordance
                  explicit. Always faintly visible when no photo. */}
              <span
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[10px] font-semibold text-white transition-opacity ${
                  busy === "photo"
                    ? "opacity-100"
                    : hasPhoto
                      ? "opacity-0 group-hover:opacity-100"
                      : "opacity-80"
                }`}
              >
                {busy === "photo" ? (
                  "Uploading…"
                ) : hasPhoto ? (
                  <ZoomIn className="h-5 w-5" aria-hidden="true" />
                ) : (
                  "📷 Add"
                )}
              </span>
            </button>
            <div className="min-w-0 text-xs text-slate-400">
              <p>
                {hasPhoto
                  ? "Tap the photo to see it full size."
                  : "A face photo makes the same player easy to spot next session."}
              </p>
              {hasPhoto && (
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    onClick={pickPhoto}
                    disabled={busy != null}
                    className="text-accent underline underline-offset-2 transition-colors hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === "photo" ? "Uploading…" : "Change photo"}
                  </button>
                  <button
                    type="button"
                    onClick={removePhoto}
                    disabled={busy != null}
                    className="text-rose-300 underline underline-offset-2 transition-colors hover:text-rose-200 disabled:opacity-40"
                  >
                    {busy === "removePhoto" ? "Removing…" : "Remove photo"}
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handlePhotoPicked(e.target.files?.[0])}
            />
          </div>

          {/* ── Name / notes ──────────────────────────────────────────── */}
          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-300">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jonathan"
              maxLength={100}
              className={fieldCls}
            />
          </label>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-300">
              Notes <span className="text-slate-500">(only you see these)</span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sunglasses, limps everything, overfolds rivers…"
              rows={3}
              maxLength={4000}
              className={`${fieldCls} resize-none`}
            />
          </label>

          {error && (
            <p className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}

          {/* ── Danger zone ───────────────────────────────────────────── */}
          {current && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <span className="text-[11px] text-slate-500">
                {handCount != null
                  ? `Appears in ${handCount} hand${handCount === 1 ? "" : "s"}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={remove}
                disabled={busy != null}
                className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-400/20 hover:text-rose-200 disabled:opacity-40"
              >
                {busy === "delete" ? "Deleting…" : "✕ Delete player"}
              </button>
            </div>
          )}

          {/* ── Showdown hands ────────────────────────────────────────── */}
          {current && (
            <section
              aria-label="Showdown hands"
              className="mt-4 border-t border-white/10 pt-3"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-300">Showdown hands</h3>
                {source && (
                  <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium text-slate-300">
                    {showdownHands.length} hand{showdownHands.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {handsPending ? (
                showHandsSpinner ? (
                  <div className="flex items-center justify-center py-4">
                    <LoadingIndicator size={32} />
                  </div>
                ) : (
                  <div className="h-12" />
                )
              ) : handsFailed ? (
                <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                  Couldn't load your hands.
                </p>
              ) : showdownHands.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-3 text-center text-xs text-slate-400">
                  No hands where {current.name} showed cards yet.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-white/10">
                    {visibleHands.map((h, i) => (
                      <motion.li
                        key={h.id}
                        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay: Math.min(i, 10) * 0.03 }}
                        className="flex items-center gap-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <HandPreview rawText={h.rawText} tone="dark" />
                        </div>
                        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                          {fmtHandDate(h.createdAt)}
                        </span>
                      </motion.li>
                    ))}
                  </ul>
                  {!showAllHands && showdownHands.length > visibleHands.length && (
                    <button
                      type="button"
                      onClick={() => setShowAllHands(true)}
                      className="mt-2 w-full rounded-lg border border-hairline bg-white/5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
                    >
                      Show all {showdownHands.length}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        {onOpenRoster && (
          <div className="border-t border-hairline px-5 py-2">
            <button
              type="button"
              onClick={onOpenRoster}
              className="text-xs font-medium text-accent underline underline-offset-2 transition-colors hover:brightness-110"
            >
              All players &amp; link hands →
            </button>
          </div>
        )}

        <div className="flex gap-2 border-t border-hairline px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy != null}
            className="flex-1 cursor-pointer rounded-xl border border-hairline bg-white/5 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="flex-1 cursor-pointer rounded-xl bg-accent py-2.5 text-sm font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default disabled:opacity-40"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>

        <PlayerPhotoLightbox
          open={photoOpen}
          player={current}
          onClose={() => setPhotoOpen(false)}
        />
      </>
    </ResponsiveDrawer>
  );
};

export default PlayerEditorDrawer;
