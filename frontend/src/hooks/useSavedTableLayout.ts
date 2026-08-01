// src/hooks/useSavedTableLayout.ts
// Single quick-save slot for the hand-history recorder's table setup. Stores
// the same shape the seed-from-last-hand pass uses (HandDefaults: game,
// blinds, ante, table size, per-seat name/stack/occupied/sitting-out) plus
// the hero seat, which is a stable session-level property. The button seat is
// deliberately excluded — it rotates every hand, exactly why
// parseHandDefaults ignores it too.
import * as React from "react";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import {
  defaultsFromState,
  type HandDefaults,
} from "@/pages/handhistory/create/parseHandDefaults";
import type { AdvancedHandState } from "@/pages/handhistory/create/types";

const LAYOUT_KEY = "ht_table_layout_v1";

export interface SavedTableLayout {
  v: 1;
  /** ISO timestamp of the save, for display. */
  savedAt: string;
  defaults: HandDefaults;
  heroSeat?: number;
}

// Defined at module scope: useLocalStorageState lists parse/serialize in its
// effect deps, so inline functions would re-subscribe the storage listener on
// every render.
const serialize = (v: SavedTableLayout | null): string => JSON.stringify(v);

// Tolerant of stale/corrupt blobs: anything that doesn't look like a v1
// layout reads as "nothing saved" instead of crashing the page.
const parse = (raw: string): SavedTableLayout | null => {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (rec.v !== 1) return null;
  const defaults = rec.defaults as HandDefaults | undefined;
  if (!defaults || typeof defaults !== "object") return null;
  if (!Array.isArray(defaults.seats)) return null;
  const size = defaults.tableSize;
  if (typeof size !== "number" || size < 2 || size > 9) return null;
  return {
    v: 1,
    savedAt: typeof rec.savedAt === "string" ? rec.savedAt : "",
    defaults,
    heroSeat: typeof rec.heroSeat === "number" ? rec.heroSeat : undefined,
  };
};

export interface UseSavedTableLayout {
  layout: SavedTableLayout | null;
  saveLayout: (state: AdvancedHandState) => void;
  clearLayout: () => void;
}

export function useSavedTableLayout(): UseSavedTableLayout {
  const [layout, setLayout] = useLocalStorageState<SavedTableLayout | null>(
    LAYOUT_KEY,
    null,
    parse,
    serialize
  );

  const saveLayout = React.useCallback(
    (state: AdvancedHandState): void => {
      setLayout({
        v: 1,
        savedAt: new Date().toISOString(),
        defaults: defaultsFromState(state),
        heroSeat: state.heroSeat,
      });
    },
    [setLayout]
  );

  const clearLayout = React.useCallback((): void => setLayout(null), [setLayout]);

  return { layout, saveLayout, clearLayout };
}
