// src/hooks/useSavedRanges.ts
// The user's saved-range library. One module-level cache plus a subscriber set,
// modelled on usePlayers: the picker can open from more than one place (both
// tree-building screens, twice each for OOP and IP), and they should share one
// fetch rather than each pulling the library on mount.
//
// Auth is observed here rather than passed in, for the same reason as
// usePlayers: the picker renders deep inside modals that have no user prop.
// Signed out, the library is empty and nothing is fetched - the built-in
// presets still work, so the panel stays useful without an account.
import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  fetchRangeLibrary,
  type RangeFolder,
  type RangeLibrary,
  type SavedRange,
} from "@/lib/savedRangesApi";

export type { RangeFolder, SavedRange };

let library: RangeLibrary = { folders: [], ranges: [] };
let loaded = false; // a fetch for the current sign-in has completed
let loading = false;
let signedIn = false;
let error: string | null = null;
let version = 0;

const subscribers = new Set<() => void>();

function notify() {
  version++;
  subscribers.forEach((fn) => fn());
}

/** Sort here so every consumer sees one canonical order even after a local
 *  mutation (the API orders too, but local upserts would drift without it). */
function setLibrary(next: RangeLibrary) {
  const byName = <T extends { name: string; createdAt: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt);
  library = {
    folders: [...next.folders].sort(byName),
    ranges: [...next.ranges].sort(byName),
  };
  notify();
}

async function refresh(): Promise<void> {
  if (loading || !signedIn) return;
  loading = true;
  error = null;
  notify();
  try {
    setLibrary(await fetchRangeLibrary());
    loaded = true;
  } catch (e) {
    // Signed-out race or transient failure: keep whatever we had rather than
    // blanking a library the user can still see.
    error = e instanceof Error ? e.message : "Could not load your saved ranges.";
  } finally {
    loading = false;
    notify();
  }
}

// Started lazily on the first hook mount and never torn down: one listener for
// the app's lifetime, not per-component.
let authWatched = false;
function watchAuth() {
  if (authWatched) return;
  authWatched = true;
  onAuthStateChanged(getAuth(), (user) => {
    const nowSignedIn = !!user;
    if (nowSignedIn === signedIn && (loaded || !nowSignedIn)) return;
    signedIn = nowSignedIn;
    if (!nowSignedIn) {
      loaded = false;
      setLibrary({ folders: [], ranges: [] });
    } else {
      void refresh();
    }
  });
  // onAuthStateChanged fires with the current user immediately, so no separate
  // initial fetch is needed.
}

/** Apply a create/rename/move/delete to the shared cache so every open picker
 *  updates without a refetch. */
export function mutateLibrary(patch: {
  folders?: RangeFolder[];
  ranges?: SavedRange[];
  removeFolderIds?: string[];
  removeRangeIds?: string[];
}): void {
  const folders = new Map(library.folders.map((f) => [f.id, f]));
  const ranges = new Map(library.ranges.map((r) => [r.id, r]));

  for (const id of patch.removeFolderIds ?? []) folders.delete(id);
  for (const id of patch.removeRangeIds ?? []) ranges.delete(id);
  for (const f of patch.folders ?? []) folders.set(f.id, f);
  for (const r of patch.ranges ?? []) ranges.set(r.id, r);

  setLibrary({ folders: [...folders.values()], ranges: [...ranges.values()] });
}

/**
 * Drop every folder in a deleted subtree and re-root the ranges that were in
 * it, mirroring what the server does. Doing it locally keeps the tree from
 * flashing a stale subtree between the DELETE and the next read.
 */
export function pruneFolderSubtree(rootId: string): void {
  const doomed = new Set<string>([rootId]);
  // Bounded by the folder count: each pass can only add folders whose parent is
  // already doomed, so it converges.
  for (let pass = 0; pass < library.folders.length; pass++) {
    let grew = false;
    for (const f of library.folders) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
        doomed.add(f.id);
        grew = true;
      }
    }
    if (!grew) break;
  }

  mutateLibrary({
    removeFolderIds: [...doomed],
    ranges: library.ranges
      .filter((r) => r.folderId && doomed.has(r.folderId))
      .map((r) => ({ ...r, folderId: null })),
  });
}

export interface UseSavedRangesResult {
  folders: RangeFolder[];
  ranges: SavedRange[];
  /**
   * True only while a request is actually in flight.
   *
   * NOT `signedIn && !loaded`: a fetch that fails never sets `loaded`, so that
   * form leaves the picker showing a spinner forever instead of the error it
   * just recorded. Callers render `loading` first, so the two have to be
   * distinguishable.
   */
  loading: boolean;
  signedIn: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  mutate: typeof mutateLibrary;
  pruneSubtree: typeof pruneFolderSubtree;
}

export function useSavedRanges(): UseSavedRangesResult {
  useSyncExternalStore(
    (onStoreChange) => {
      subscribers.add(onStoreChange);
      return () => subscribers.delete(onStoreChange);
    },
    () => version
  );

  useEffect(() => {
    watchAuth();
    // A consumer mounting after a failed fetch retries once; no polling.
    if (signedIn && !loaded && !loading) void refresh();
  }, []);

  return {
    folders: library.folders,
    ranges: library.ranges,
    loading,
    signedIn,
    error,
    refresh,
    mutate: mutateLibrary,
    pruneSubtree: pruneFolderSubtree,
  };
}
