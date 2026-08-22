// src/hooks/usePlayers.ts
// Shared player roster. One module-level cache + subscriber set so every
// consumer (hand list rows, recorder, players page, replayer) shares a single
// fetch and a referentially-stable byId map - stability matters because
// HandSummaryRow/HandRow are React.memo'd and deep list rows read this hook
// directly (they can't take players as props without breaking their memo
// contract on rawText+tone).
//
// Auth is observed here rather than passed in: avatar components render deep
// inside memoized trees that have no user prop. Signed out, the roster is
// empty and nothing is fetched.
import { useEffect, useSyncExternalStore } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { listPlayers, type Player } from "@/lib/playersApi";

export type { Player };

let players: Player[] = [];
let byId: Map<string, Player> = new Map();
let loaded = false; // a fetch for the current sign-in has completed
let loading = false;
let signedIn = false;
let version = 0;

const subscribers = new Set<() => void>();

function notify() {
  version++;
  subscribers.forEach((fn) => fn());
}

function setPlayers(next: Player[]) {
  // Sort here so every consumer sees one canonical order (the API orders by
  // name too, but local mutations would drift without it).
  players = [...next].sort(
    (a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt)
  );
  byId = new Map(players.map((p) => [p.id, p]));
  notify();
}

async function fetchPlayers(): Promise<void> {
  if (loading || !signedIn) return;
  loading = true;
  notify();
  try {
    setPlayers(await listPlayers());
    loaded = true;
  } catch {
    // Signed-out race or transient failure: keep whatever we had. Consumers
    // degrade to initials/free-text; refresh() retries on demand.
  } finally {
    loading = false;
    notify();
  }
}

// Auth subscription is started lazily on the first hook mount and never torn
// down: it is one listener for the app's lifetime, not per-component.
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
      setPlayers([]);
    } else {
      void fetchPlayers();
    }
  });
  // onAuthStateChanged fires with the current user immediately, so no separate
  // initial fetch is needed.
}

/** Insert or replace players in the shared cache (after create/edit/upload)
 *  so all surfaces update without a refetch. */
export function mutatePlayers(upserts: Player[], removeIds: string[] = []): void {
  const next = new Map(byId);
  for (const id of removeIds) next.delete(id);
  for (const p of upserts) next.set(p.id, p);
  setPlayers([...next.values()]);
}

export interface UsePlayersResult {
  players: Player[];
  byId: Map<string, Player>;
  /** True only while the roster for the current sign-in hasn't loaded yet. */
  loading: boolean;
  signedIn: boolean;
  refresh: () => Promise<void>;
  mutate: typeof mutatePlayers;
}

export function usePlayers(): UsePlayersResult {
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
    if (signedIn && !loaded && !loading) void fetchPlayers();
  }, []);

  return {
    players,
    byId,
    loading: signedIn && !loaded,
    signedIn,
    refresh: fetchPlayers,
    mutate: mutatePlayers,
  };
}
