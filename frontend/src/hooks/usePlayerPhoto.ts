// src/hooks/usePlayerPhoto.ts
// Player photos sit behind an [Authorize] endpoint (photos of real people are
// owner-only - no leak-by-link URLs), so a bare <img src> can't load them.
// This hook fetches the blob with a bearer token once per (player, version)
// and hands back an object URL, cached module-wide so every avatar of the
// same player shares one download. Purely event-driven: no timers, no polling.
import { useEffect, useSyncExternalStore } from "react";
import { authedFetch } from "@/lib/api";
import type { Player } from "@/lib/playersApi";

interface CacheEntry {
  version: string; // photoUpdatedAt at fetch time
  url: string | null; // null while loading or after a failed fetch
  promise: Promise<void> | null;
}

const cache = new Map<string, CacheEntry>();
const subscribers = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  subscribers.forEach((fn) => fn());
}

function ensureFetched(player: Player): void {
  const wanted = player.photoUpdatedAt ?? "";
  const existing = cache.get(player.id);
  if (existing?.version === wanted) return; // cached or already in flight

  // Photo replaced: drop the stale object URL before fetching the new one.
  if (existing?.url) URL.revokeObjectURL(existing.url);

  const entry: CacheEntry = { version: wanted, url: null, promise: null };
  entry.promise = authedFetch(`/api/players/${player.id}/photo`)
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      // A replace may have superseded this fetch while it ran.
      if (cache.get(player.id) !== entry) return;
      entry.url = URL.createObjectURL(blob);
    })
    .catch(() => {
      // Failed (signed out, deleted, offline): leave url null so the avatar
      // falls back to initials. A later photoUpdatedAt change retries.
    })
    .finally(() => {
      entry.promise = null;
      notify();
    });
  cache.set(player.id, entry);
}

/** Object URL for the player's current photo, or null (no photo / loading /
 *  unavailable). Triggers at most one authenticated fetch per photo version. */
export function usePlayerPhoto(player: Player | null | undefined): string | null {
  useSyncExternalStore(
    (onStoreChange) => {
      subscribers.add(onStoreChange);
      return () => subscribers.delete(onStoreChange);
    },
    () => version
  );

  const wantsPhoto = !!player?.hasPhoto;
  useEffect(() => {
    if (wantsPhoto && player) ensureFetched(player);
    // Object URLs are deliberately NOT revoked on unmount: the cache is shared
    // across every avatar and pages remount rows constantly; entries are only
    // revoked when superseded by a new photo version.
  }, [wantsPhoto, player?.id, player?.photoUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!player?.hasPhoto) return null;
  return cache.get(player.id)?.url ?? null;
}
