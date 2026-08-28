// src/hooks/useSavedTrees.ts
// The user's saved-tree library. One module-level cache plus a subscriber set,
// the same machinery as useSavedRanges: the Trees panel lives inside the
// /compare tree-building drawer, which mounts and unmounts every time the
// drawer opens, and remounting should not re-pull the library.
//
// Auth is observed here rather than passed in, for the same reason: the panel
// renders deep inside a modal that has no user prop. Signed out, the library is
// empty and nothing is fetched - the engine's built-in benchmark spots still
// work, so the panel stays useful without an account.
import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  fetchTreeLibraryData,
  type TreeFolder,
  type TreeLibraryData,
  type SavedTree,
} from "@/lib/savedTreesApi";

export type { TreeFolder, SavedTree };

let library: TreeLibraryData = { folders: [], trees: [] };
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
function setLibrary(next: TreeLibraryData) {
  const byName = <T extends { name: string; createdAt: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt);
  library = {
    folders: [...next.folders].sort(byName),
    trees: [...next.trees].sort(byName),
  };
  notify();
}

async function refresh(): Promise<void> {
  if (loading || !signedIn) return;
  loading = true;
  error = null;
  notify();
  try {
    setLibrary(await fetchTreeLibraryData());
    loaded = true;
  } catch (e) {
    // Signed-out race or transient failure: keep whatever we had rather than
    // blanking a library the user can still see.
    error = e instanceof Error ? e.message : "Could not load your saved trees.";
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
      setLibrary({ folders: [], trees: [] });
    } else {
      void refresh();
    }
  });
  // onAuthStateChanged fires with the current user immediately, so no separate
  // initial fetch is needed.
}

/** Apply a create/rename/move/delete to the shared cache so the panel
 *  updates without a refetch. */
export function mutateTreeLibrary(patch: {
  folders?: TreeFolder[];
  trees?: SavedTree[];
  removeFolderIds?: string[];
  removeTreeIds?: string[];
}): void {
  const folders = new Map(library.folders.map((f) => [f.id, f]));
  const trees = new Map(library.trees.map((r) => [r.id, r]));

  for (const id of patch.removeFolderIds ?? []) folders.delete(id);
  for (const id of patch.removeTreeIds ?? []) trees.delete(id);
  for (const f of patch.folders ?? []) folders.set(f.id, f);
  for (const r of patch.trees ?? []) trees.set(r.id, r);

  setLibrary({ folders: [...folders.values()], trees: [...trees.values()] });
}

/**
 * Drop every folder in a deleted subtree and re-root the trees that were in
 * it, mirroring what the server does. Doing it locally keeps the folder tree
 * from flashing a stale subtree between the DELETE and the next read.
 */
export function pruneTreeFolderSubtree(rootId: string): void {
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

  mutateTreeLibrary({
    removeFolderIds: [...doomed],
    trees: library.trees
      .filter((r) => r.folderId && doomed.has(r.folderId))
      .map((r) => ({ ...r, folderId: null })),
  });
}

export interface UseSavedTreesResult {
  folders: TreeFolder[];
  trees: SavedTree[];
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
  mutate: typeof mutateTreeLibrary;
  pruneSubtree: typeof pruneTreeFolderSubtree;
}

export function useSavedTrees(): UseSavedTreesResult {
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
    trees: library.trees,
    loading,
    signedIn,
    error,
    refresh,
    mutate: mutateTreeLibrary,
    pruneSubtree: pruneTreeFolderSubtree,
  };
}
