import { useCallback, useEffect, useState } from "react";
import {
  fetchPostflopIndex,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";

/**
 * Library index of all solved postflop boards (piosolutions-index.json via
 * the API, 60s server cache). `refresh` refetches, e.g. after a new solve.
 */
const usePostflopIndex = (API_BASE_URL: string) => {
  const [entries, setEntries] = useState<PostflopIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const index = await fetchPostflopIndex(API_BASE_URL);
      setEntries(index?.entries ?? []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Error fetching postflop solutions index");
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return { entries, loading, error, refresh, entriesForLine };
};

export default usePostflopIndex;
