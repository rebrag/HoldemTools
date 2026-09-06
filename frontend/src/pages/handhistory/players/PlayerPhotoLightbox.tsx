// src/pages/handhistory/players/PlayerPhotoLightbox.tsx
// The player's photo at full size, so a face is actually recognisable (the
// editor's avatar is 64px). Built on the shared overlay shell so it is a
// bottom sheet on a phone and a centered modal on desktop, like every other
// dialog. The image comes from the same cached object URL every avatar of the
// player shares (usePlayerPhoto), so opening it costs no request.
import React from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import { usePlayerPhoto } from "@/hooks/usePlayerPhoto";
import type { Player } from "@/lib/playersApi";

interface Props {
  open: boolean;
  player: Player | null;
  onClose: () => void;
}

const PlayerPhotoLightbox: React.FC<Props> = ({ open, player, onClose }) => {
  const photoUrl = usePlayerPhoto(player);
  const name = player?.name ?? "";

  return (
    <ResponsiveDrawer
      open={open && !!photoUrl}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-lg"
      // Always above whichever editor opened it: the editor sits at z-50 on
      // the list and roster pages but at z-[1300] inside the recorder.
      zClassName="z-[1400]"
      ariaLabel={`${name}, enlarged`}
    >
      {/* Tapping the photo dismisses it too: one tap in, one tap out on a
          phone, where the close button is a small target. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {photoUrl && (
          <img
            src={photoUrl}
            alt={name}
            draggable={false}
            className="max-h-[80vh] w-full rounded-xl object-contain select-none"
          />
        )}
        <span className="text-sm font-semibold text-white">{name}</span>
      </button>
    </ResponsiveDrawer>
  );
};

export default PlayerPhotoLightbox;
