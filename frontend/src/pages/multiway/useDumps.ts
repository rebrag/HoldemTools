// src/pages/multiway/useDumps.ts
//
// The page's one copy of each result payload. A dump is a few hundred KB and
// three things want it - the open result, a group's ranges view, and the
// session simulator's rotation - so fetches go through one promise cache per
// page and a group opened and then simulated is downloaded once.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPushFoldDump } from "./fetchPushFoldDump";
import type { PushFoldDump } from "./pushfoldResult";

export type LoadedDump = { dump: PushFoldDump } | { error: string };

export interface DumpCache {
  /** The payload for a job, fetched at most once while it succeeds. */
  getDump: (id: string) => Promise<PushFoldDump>;
  /** Forget a job's payload (it was deleted). */
  evict: (id: string) => void;
}

export function useDumpCache(): DumpCache {
  const cache = useRef(new Map<string, Promise<PushFoldDump>>());
  const getDump = useCallback((id: string) => {
    const hit = cache.current.get(id);
    if (hit) return hit;
    const p = fetchPushFoldDump(id);
    // A failure is not cached: the next ask retries rather than replaying
    // the same error forever.
    p.catch(() => {
      if (cache.current.get(id) === p) cache.current.delete(id);
    });
    cache.current.set(id, p);
    return p;
  }, []);
  const evict = useCallback((id: string) => {
    cache.current.delete(id);
  }, []);
  return { getDump, evict };
}

/** Load a set of payloads and expose them by id as they land. Entries are
 *  never dropped, so switching between groups that share a solve does not
 *  flash it back to loading. A failed id is retried the next time it is
 *  asked for. */
export function useLoadedDumps(
  ids: string[],
  getDump: (id: string) => Promise<PushFoldDump>
): Record<string, LoadedDump> {
  const [loaded, setLoaded] = useState<Record<string, LoadedDump>>({});
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const key = ids.join("|");
  useEffect(() => {
    const wanted = Array.from(new Set(key ? key.split("|") : []));
    for (const id of wanted) {
      if (inFlight.current.has(id)) continue;
      inFlight.current.add(id);
      void getDump(id)
        .then((dump) => {
          if (mounted.current) setLoaded((cur) => ({ ...cur, [id]: { dump } }));
        })
        .catch((e: unknown) => {
          inFlight.current.delete(id);
          if (mounted.current) {
            setLoaded((cur) => ({
              ...cur,
              [id]: { error: e instanceof Error ? e.message : String(e) },
            }));
          }
        });
    }
  }, [key, getDump]);

  return loaded;
}
