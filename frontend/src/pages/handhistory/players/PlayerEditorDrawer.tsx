// src/pages/handhistory/players/PlayerEditorDrawer.tsx
// Create/edit drawer for a player: name, notes, photo upload (downscaled
// client-side before the authenticated multipart PUT), photo removal, and
// delete. Uses the app's shared dark-glass overlay shell (ResponsiveDrawer),
// same as the recorder's seat editor.
import React, { useEffect, useId, useRef, useState } from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import PlayerAvatar from "@/components/PlayerAvatar";
import { mutatePlayers } from "@/hooks/usePlayers";
import {
  createPlayer,
  deletePlayer,
  deletePlayerPhoto,
  updatePlayer,
  uploadPlayerPhoto,
  type Player,
} from "@/lib/playersApi";

const fieldCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 transition-colors focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/40";

// Downscale to a small JPEG before upload: avatars never need more than
// ~512px, phones shoot 10MB+ photos, and the server (which stores bytes
// verbatim in v1) caps uploads at 5MB. `from-image` applies EXIF rotation so
// portrait phone shots don't upload sideways. Falls back to the original file
// when decoding fails (e.g. an already-small image in an odd container).
async function downscalePhoto(file: File, maxDim = 512): Promise<Blob> {
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

interface Props {
  /** Mount permanently and toggle this, so the sheet's exit animation plays. */
  open: boolean;
  /** Existing player to edit, or null to create a new one. */
  player: Player | null;
  /** Hands this player appears in (shown next to Delete as context). */
  handCount?: number;
  onClose: () => void;
}

const PlayerEditorDrawer: React.FC<Props> = ({ open, player, handCount, onClose }) => {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "save" | "photo" | "removePhoto" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  // The saved row this drawer is working on (set after create, so a photo can
  // be added in the same visit).
  const [current, setCurrent] = useState<Player | null>(player);

  useEffect(() => {
    if (!open) return;
    setCurrent(player);
    setName(player?.name ?? "");
    setNotes(player?.notes ?? "");
    setBusy(null);
    setError(null);
    // Re-seed only when (re)opened; re-syncing while open would fight edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSave = name.trim().length > 0 && busy == null;

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
    const hands =
      handCount != null && handCount > 0
        ? ` Hands they appear in are kept (the name stays on them).`
        : "";
    if (!window.confirm(`Delete ${current.name}? This can't be undone.${hands}`)) return;
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

  return (
    <ResponsiveDrawer
      open={open}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-sm"
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy === "photo"}
              aria-label={current?.hasPhoto ? "Change photo" : "Add photo"}
              className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <PlayerAvatar
                player={current}
                name={name}
                size="lg"
                className="ring-white/20"
              />
              {/* Hover/press overlay makes the avatar's tap-to-change
                  affordance explicit. Always faintly visible when no photo. */}
              <span
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[10px] font-semibold text-white transition-opacity ${
                  busy === "photo"
                    ? "opacity-100"
                    : current?.hasPhoto
                      ? "opacity-0 group-hover:opacity-100"
                      : "opacity-80"
                }`}
              >
                {busy === "photo" ? "Uploading…" : current?.hasPhoto ? "Change" : "📷 Add"}
              </span>
            </button>
            <div className="min-w-0 text-xs text-slate-400">
              <p>A face photo makes the same player easy to spot next session.</p>
              {current?.hasPhoto && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={busy != null}
                  className="mt-1 text-rose-300 underline underline-offset-2 transition-colors hover:text-rose-200 disabled:opacity-40"
                >
                  {busy === "removePhoto" ? "Removing…" : "Remove photo"}
                </button>
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
        </div>

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
      </>
    </ResponsiveDrawer>
  );
};

export default PlayerEditorDrawer;
