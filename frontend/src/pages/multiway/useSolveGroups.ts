// src/pages/multiway/useSolveGroups.ts
//
// The page's copy of its saved solve groups, with the writes the drawer and
// the simulator make. One instance, owned by MultiwaySolver and passed down:
// the drawer renames and deletes, the simulator creates and updates, and
// both need to see each other's changes at once.
//
// Writes are applied to local state from the server's response rather than
// optimistically: a group is saved once per session, not on every keystroke,
// and showing what was actually stored is worth the round trip.
import { useCallback, useEffect, useState } from "react";
import {
  createSolveGroup,
  deleteSolveGroup,
  fetchSolveGroups,
  updateSolveGroup,
  type SolveGroup,
} from "./solveGroupsApi";

export type { SolveGroup };

export interface SolveGroupsStore {
  groups: SolveGroup[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (name: string, jobIds: string[]) => Promise<SolveGroup>;
  update: (id: string, name: string, jobIds: string[]) => Promise<SolveGroup>;
  remove: (id: string) => Promise<void>;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useSolveGroups(): SolveGroupsStore {
  const [groups, setGroups] = useState<SolveGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await fetchSolveGroups());
      setError(null);
    } catch (e) {
      // Keep whatever was showing: a failed refresh is not an empty library.
      setError(message(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (name: string, jobIds: string[]) => {
    const created = await createSolveGroup(name, jobIds);
    setGroups((cur) => [...cur, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, name: string, jobIds: string[]) => {
    const updated = await updateSolveGroup(id, name, jobIds);
    setGroups((cur) => cur.map((g) => (g.id === id ? updated : g)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteSolveGroup(id);
    setGroups((cur) => cur.filter((g) => g.id !== id));
  }, []);

  return { groups, loaded, error, refresh, create, update, remove };
}
