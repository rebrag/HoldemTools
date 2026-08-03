import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  fetchPostflopIndex,
  setSolutionHidden,
  solutionKey,
  solutionRef,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";

/**
 * The viewer's library of solved postflop boards (authed; 10s server cache).
 * The server labels each entry's provenance and drops what this viewer must
 * not or does not want to see - see PostflopLibraryOverlay on the API side.
 * When the viewer is signed out the index 401s (or authedFetch throws before
 * the request) - surfaced as `signInRequired` so the UI can prompt.
 */
const without = (entries: PostflopIndexEntry[], drop: PostflopIndexEntry[]) => {
  const keys = new Set(drop.map(solutionKey));
  return entries.filter((e) => !keys.has(solutionKey(e)));
};

/** Add back only what is actually missing; the list groups and sorts itself,
 *  so appending is enough and a double-add would show a board twice. */
const merge = (entries: PostflopIndexEntry[], add: PostflopIndexEntry[]) => {
  const keys = new Set(entries.map(solutionKey));
  return [...entries, ...add.filter((e) => !keys.has(solutionKey(e)))];
};

const usePostflopIndex = (signedIn: boolean) => {
  const [entries, setEntries] = useState<PostflopIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const index = await fetchPostflopIndex();
      setEntries(index?.entries ?? []);
      setError(null);
      setSignInRequired(false);
    } catch (err) {
      const unauthenticated =
        (err instanceof ApiError && err.status === 401) ||
        (err instanceof Error && err.message.includes("signed in"));
      setEntries([]);
      setSignInRequired(unauthenticated);
      setError(unauthenticated ? null : "Error fetching postflop solutions index");
      if (!unauthenticated) console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, signedIn]);

  const entriesForLine = useCallback(
    (folder: string, preflopLine: string[]) =>
      entries.filter(
        (e) =>
          e.stacks === folder &&
          Array.isArray(e.preflop_line) &&
          e.preflop_line.join("|") === preflopLine.join("|")
      ),
    [entries]
  );

  /**
   * Remove boards from this viewer's library, optimistically. The server call
   * is per board and idempotent; if any of them fails the local list is put
   * back, because a row that reappears on the next refresh is worse than one
   * that never left.
   */
  const hide = useCallback(async (targets: PostflopIndexEntry[]) => {
    if (targets.length === 0) return;
    setEntries((prev) => without(prev, targets));
    try {
      await Promise.all(targets.map((e) => setSolutionHidden(solutionRef(e), true)));
    } catch (err) {
      console.error("Failed to remove solved board(s)", err);
      setEntries((prev) => merge(prev, targets));
      throw err;
    }
  }, []);

  /** Undo a hide. Restores the entries locally so the list does not have to
   *  wait on a refresh round trip. */
  const unhide = useCallback(async (targets: PostflopIndexEntry[]) => {
    if (targets.length === 0) return;
    setEntries((prev) => merge(prev, targets));
    try {
      await Promise.all(targets.map((e) => setSolutionHidden(solutionRef(e), false)));
    } catch (err) {
      console.error("Failed to restore solved board(s)", err);
      setEntries((prev) => without(prev, targets));
      throw err;
    }
  }, []);

  return { entries, loading, error, signInRequired, refresh, entriesForLine, hide, unhide };
};

export default usePostflopIndex;
