import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  fetchPostflopIndex,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";

/**
 * Library index of all solved postflop boards (authed; 60s server cache).
 * When the viewer is signed out the index 401s (or authedFetch throws before
 * the request) - surfaced as `signInRequired` so the UI can prompt.
 */
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

  return { entries, loading, error, signInRequired, refresh, entriesForLine };
};

export default usePostflopIndex;
