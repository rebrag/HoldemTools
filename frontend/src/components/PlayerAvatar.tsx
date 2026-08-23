// src/components/PlayerAvatar.tsx
// Circular player avatar with an initials fallback. Reads the shared player
// roster and photo cache itself (no player-data props beyond the reference)
// so memoized list rows can render it without widening their prop contracts.
// Static by design - never animate avatars (battery discipline).
import React from "react";
import { usePlayerPhoto } from "@/hooks/usePlayerPhoto";
import type { Player } from "@/lib/playersApi";

export type PlayerAvatarSize = "xs" | "md" | "lg";

// Diameter matches usage: xs sits inline next to 11-12px text (icon ≈ its
// line-height), md overlaps table-seat badges, lg headlines the Players page.
const SIZES: Record<PlayerAvatarSize, { box: string; text: string }> = {
  xs: { box: "h-4 w-4", text: "text-[8px]" },
  md: { box: "h-7 w-7", text: "text-[11px]" },
  lg: { box: "h-16 w-16", text: "text-xl" },
};

// Muted fills that read on both the light list surface and the dark felt.
// Deterministic per player id so a player keeps their color everywhere.
const FALLBACK_FILLS = [
  "bg-emerald-200 text-emerald-900",
  "bg-sky-200 text-sky-900",
  "bg-violet-200 text-violet-900",
  "bg-amber-200 text-amber-900",
  "bg-rose-200 text-rose-900",
  "bg-teal-200 text-teal-900",
  "bg-indigo-200 text-indigo-900",
  "bg-orange-200 text-orange-900",
];

function fillFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return FALLBACK_FILLS[Math.abs(hash) % FALLBACK_FILLS.length];
}

// First letters of the first two words ("David sunglasses kid" -> "DS").
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export interface PlayerAvatarProps {
  player: Player | null | undefined;
  /** Named preset, or an exact diameter in px for contexts that scale with
   *  their container (the poker-table seats). */
  size?: PlayerAvatarSize | number;
  /** Fallback initials source when the player row is unavailable (dangling id,
   *  signed out): the seat's name snapshot still gives a recognizable chip. */
  name?: string;
  className?: string;
}

const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  player,
  size = "md",
  name,
  className = "",
}) => {
  const photoUrl = usePlayerPhoto(player);
  // 0.39 = md's 11px text on a 28px box, kept for the numeric path.
  const numeric = typeof size === "number";
  const boxClass = numeric ? "" : SIZES[size].box;
  const textClass = numeric ? "" : SIZES[size].text;
  const boxStyle: React.CSSProperties | undefined = numeric
    ? { width: size, height: size, fontSize: Math.round(size * 0.39) }
    : undefined;
  const label = player?.name ?? name ?? "";

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={label}
        title={label}
        draggable={false}
        style={boxStyle}
        className={`${boxClass} shrink-0 rounded-full object-cover ring-1 ring-black/10 select-none ${className}`}
      />
    );
  }

  const initials = initialsOf(label);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={boxStyle}
      className={`${boxClass} ${textClass} flex shrink-0 items-center justify-center rounded-full font-semibold uppercase leading-none ring-1 ring-black/10 select-none ${fillFor(
        player?.id ?? label
      )} ${className}`}
    >
      {initials || "?"}
    </span>
  );
};

export default PlayerAvatar;
