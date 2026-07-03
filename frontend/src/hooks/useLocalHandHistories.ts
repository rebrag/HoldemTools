// src/hooks/useLocalHandHistories.ts
// Local (signed-out) hand-history store. Lets logged-out users create and keep
// hand histories in the browser; HandHistoryTool auto-migrates these to the
// server once the user signs in. Built on the shared useLocalStorageState hook
// and mirrors the bankroll draft pattern (LocalHand + makeLocalId).
import * as React from "react";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { makeLocalId } from "@/pages/bankroll/SessionHandHistories";
import type { LocalHandHistory } from "@/pages/handhistory/types";

const LOCAL_HH_KEY = "ht_handhistory_local_v1";

// Defined at module scope: useLocalStorageState lists parse/serialize in its
// effect deps, so inline functions would re-subscribe the storage listener on
// every render.
const serialize = (v: LocalHandHistory[]): string => JSON.stringify(v);

// Tolerant of stale/corrupt blobs: keep only well-formed entries and backfill
// any missing localId/createdAt so an old shape never crashes the page.
const parse = (raw: string): LocalHandHistory[] => {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) return [];
  const out: LocalHandHistory[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.rawText !== "string") continue;
    out.push({
      localId: typeof rec.localId === "string" ? rec.localId : makeLocalId(),
      rawText: rec.rawText,
      createdAt:
        typeof rec.createdAt === "string"
          ? rec.createdAt
          : new Date().toISOString(),
    });
  }
  return out;
};

export interface UseLocalHandHistories {
  localHands: LocalHandHistory[];
  addLocal: (rawText: string) => LocalHandHistory;
  updateLocal: (localId: string, rawText: string) => void;
  removeLocal: (localId: string) => void;
  clearLocal: () => void;
  /** Replace the whole store (used by migration to keep only failed hands). */
  setLocal: React.Dispatch<React.SetStateAction<LocalHandHistory[]>>;
}

export function useLocalHandHistories(): UseLocalHandHistories {
  const [localHands, setLocal] = useLocalStorageState<LocalHandHistory[]>(
    LOCAL_HH_KEY,
    [],
    parse,
    serialize
  );

  const addLocal = React.useCallback(
    (rawText: string): LocalHandHistory => {
      const hand: LocalHandHistory = {
        localId: makeLocalId(),
        rawText,
        createdAt: new Date().toISOString(),
      };
      setLocal((prev) => [hand, ...prev]); // newest first
      return hand;
    },
    [setLocal]
  );

  const updateLocal = React.useCallback(
    (localId: string, rawText: string): void => {
      setLocal((prev) =>
        prev.map((h) => (h.localId === localId ? { ...h, rawText } : h))
      );
    },
    [setLocal]
  );

  const removeLocal = React.useCallback(
    (localId: string): void => {
      setLocal((prev) => prev.filter((h) => h.localId !== localId));
    },
    [setLocal]
  );

  const clearLocal = React.useCallback((): void => setLocal([]), [setLocal]);

  return { localHands, addLocal, updateLocal, removeLocal, clearLocal, setLocal };
}
