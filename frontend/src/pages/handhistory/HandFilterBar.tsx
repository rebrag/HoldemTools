// src/pages/handhistory/HandFilterBar.tsx
// The hand list's filter panel. It used to wrap the shared SessionFilterPanel
// for location / stakes / dates, but those are session attributes and belong
// to the bankroll tool; what this list is searched by is who was in the hand
// and whose cards are known. So the panel is now its own, and only borrows
// SessionFilterPanel's FILTER_THEMES so it still reads as the same control set
// (bankroll keeps the shared panel untouched).
import React from "react";
import PlayerAvatar from "@/components/PlayerAvatar";
import { FILTER_THEMES } from "@/components/filters/SessionFilterPanel";
import { usePlayers } from "@/hooks/usePlayers";
import type { HandFilterState } from "./handFilters";

interface Props {
  filters: HandFilterState;
  setFilters: React.Dispatch<React.SetStateAction<HandFilterState>>;
  filteredCount: number;
  totalCount: number;
  isFiltering: boolean;
  onReset: () => void;
  onHide?: () => void;
}

const t = FILTER_THEMES.light;

/** A labelled checkbox row styled to the shared panel's light theme. */
const FilterToggle: React.FC<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, disabled, title, onChange }) => (
  <label
    title={title}
    className={`inline-flex items-center gap-1.5 transition-opacity ${
      disabled ? "cursor-default opacity-40" : "cursor-pointer"
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 accent-emerald-600"
    />
    <span className={t.label}>{label}</span>
  </label>
);

const HandFilterBar: React.FC<Props> = ({
  filters,
  setFilters,
  filteredCount,
  totalCount,
  isFiltering,
  onReset,
  onHide,
}) => {
  const { players } = usePlayers();
  const selectedCount = filters.playerIds.length;

  // Duplicate names are expected ("Jonathan" x3), so a collide-prone row gets
  // its notes as a suffix; every row carries its avatar, which is what
  // actually disambiguates at a glance.
  const nameCounts = new Map<string, number>();
  for (const p of players) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const hintFor = (p: (typeof players)[number]): string | null => {
    if ((nameCounts.get(p.name) ?? 0) < 2) return null;
    const hint = p.notes?.trim().split("\n")[0];
    return hint
      ? hint.slice(0, 40)
      : `added ${new Date(p.createdAt).toLocaleDateString()}`;
  };

  const clearPlayers = () =>
    setFilters((prev) => ({
      ...prev,
      playerIds: [],
      playerSawFlop: false,
      playerShowed: false,
    }));

  const toggle = (id: string) =>
    setFilters((prev) => {
      const playerIds = prev.playerIds.includes(id)
        ? prev.playerIds.filter((x) => x !== id)
        : [...prev.playerIds, id];
      // Clearing the last player clears its qualifiers too.
      return playerIds.length
        ? { ...prev, playerIds }
        : { ...prev, playerIds, playerSawFlop: false, playerShowed: false };
    });

  return (
    <div className={t.panel}>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={t.label}>
            Players{" "}
            <span className="font-normal text-gray-500">
              {selectedCount > 0 ? `(any of ${selectedCount})` : "(any)"}
            </span>
          </span>
          {selectedCount > 0 && (
            <button type="button" onClick={clearPlayers} className={t.clearBtn}>
              Clear players
            </button>
          )}
        </div>

        {players.length === 0 ? (
          <p className={t.summary}>
            No players yet - add them on the Players page to filter by who was in
            the hand.
          </p>
        ) : (
          /* A checkbox list rather than a multiple <select>: the photo is what
             tells three "Jonathan"s apart, and a native multi-select can show
             neither a photo nor a comfortable thumb target. Selecting several
             ORs them. */
          <ul className="max-h-40 divide-y divide-emerald-100 overflow-y-auto overscroll-contain rounded-md border border-emerald-200 bg-white">
            {players.map((p) => {
              const checked = filters.playerIds.includes(p.id);
              const hint = hintFor(p);
              return (
                <li key={p.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors ${
                      checked ? "bg-emerald-50" : "hover:bg-emerald-50/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
                    />
                    <PlayerAvatar player={p} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-800">
                      {p.name}
                    </span>
                    {hint && (
                      <span className="max-w-[40%] shrink-0 truncate text-[10px] text-gray-500">
                        {hint}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Qualifiers apply to the seat that matched, so with several players
          selected they read as "one of them saw the flop", not "all did". */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <FilterToggle
          label="Saw the flop"
          checked={filters.playerSawFlop}
          disabled={selectedCount === 0}
          title={selectedCount ? undefined : "Pick a player first"}
          onChange={(on) => setFilters((prev) => ({ ...prev, playerSawFlop: on }))}
        />
        <FilterToggle
          label="Showed cards"
          checked={filters.playerShowed}
          disabled={selectedCount === 0}
          title={selectedCount ? undefined : "Pick a player first"}
          onChange={(on) => setFilters((prev) => ({ ...prev, playerShowed: on }))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className={t.label}>Quick range</span>
        <div>
          <button
            type="button"
            aria-pressed={filters.anyKnownCards}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                anyKnownCards: !prev.anyKnownCards,
              }))
            }
            title="Only hands where at least one player's hole cards were recorded"
            className={
              filters.anyKnownCards
                ? "inline-flex items-center justify-center rounded-md border border-emerald-600 bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-700"
                : t.quickBtn
            }
          >
            Any known cards
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className={t.summary}>
          Showing{" "}
          <span className="font-semibold">
            {filteredCount} / {totalCount}
          </span>{" "}
          hands.
        </p>
        <div className="flex items-center gap-2">
          {isFiltering && (
            <button type="button" onClick={onReset} className={t.clearBtn}>
              Clear filters
            </button>
          )}
          {onHide && (
            <button type="button" onClick={onHide} className={t.hideBtn}>
              Hide
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default HandFilterBar;
