// src/pages/handhistory/HandFilterBar.tsx
// The hand list's filter panel: the shared SessionFilterPanel (location /
// stakes / dates — one source of truth with bankroll) plus the hand-specific
// controls: a player picker and its "saw flop" / "showed cards" qualifiers.
import React from "react";
import PlayerAvatar from "@/components/PlayerAvatar";
import SessionFilterPanel, {
  FILTER_THEMES,
} from "@/components/filters/SessionFilterPanel";
import { usePlayers } from "@/hooks/usePlayers";
import type { HandFilterState } from "./handFilters";

interface Props {
  filters: HandFilterState;
  setFilters: React.Dispatch<React.SetStateAction<HandFilterState>>;
  knownLocations: string[];
  knownGames: string[];
  filteredCount: number;
  totalCount: number;
  isFiltering: boolean;
  onReset: () => void;
  onThisYear: () => void;
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
  knownLocations,
  knownGames,
  filteredCount,
  totalCount,
  isFiltering,
  onReset,
  onThisYear,
  onHide,
}) => {
  const { players, byId } = usePlayers();
  const selectedPlayer = filters.playerId ? byId.get(filters.playerId) : undefined;

  // Duplicate names are expected ("Jonathan" ×3) and a native <select> can't
  // show photos, so collide-prone options get their notes as a suffix; the
  // chip below the select carries the avatar for visual confirmation.
  const nameCounts = new Map<string, number>();
  for (const p of players) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const optionLabel = (p: (typeof players)[number]): string => {
    if ((nameCounts.get(p.name) ?? 0) < 2) return p.name;
    const hint = p.notes?.trim().split("\n")[0];
    return hint ? `${p.name} — ${hint.slice(0, 40)}` : `${p.name} (added ${new Date(p.createdAt).toLocaleDateString()})`;
  };

  return (
    <SessionFilterPanel
      filters={filters}
      setFilters={setFilters}
      knownLocations={knownLocations}
      knownGames={knownGames}
      filteredCount={filteredCount}
      totalCount={totalCount}
      countNoun="hands"
      /* The panel lives in a ~416px popout, so it asks for two columns rather
         than the default five - see SessionFilterPanel.gridClassName. */
      gridClassName="grid gap-2 sm:grid-cols-2"
      isFiltering={isFiltering}
      onReset={onReset}
      onThisYear={onThisYear}
      onHide={onHide}
      extraFields={
        <div className="flex flex-col gap-1">
          <span className={t.label}>Player</span>
          <select
            className={t.control}
            value={filters.playerId}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                playerId: e.target.value,
                // A cleared player clears its qualifiers too.
                playerSawFlop: e.target.value ? prev.playerSawFlop : false,
                playerShowed: e.target.value ? prev.playerShowed : false,
              }))
            }
          >
            <option value="">All players</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
        </div>
      }
      extraRows={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {selectedPlayer && (
            /* Visual confirmation of WHICH namesake is selected. */
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 py-0.5 pl-1 pr-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
              <PlayerAvatar player={selectedPlayer} size="xs" />
              <span className="max-w-[10rem] truncate">{selectedPlayer.name}</span>
              <button
                type="button"
                aria-label="Clear player filter"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    playerId: "",
                    playerSawFlop: false,
                    playerShowed: false,
                  }))
                }
                className="text-emerald-700/70 transition-colors hover:text-emerald-900"
              >
                ✕
              </button>
            </span>
          )}
          <FilterToggle
            label={selectedPlayer ? `${selectedPlayer.name} saw the flop` : "Player saw the flop"}
            checked={filters.playerSawFlop}
            disabled={!filters.playerId}
            title={filters.playerId ? undefined : "Pick a player first"}
            onChange={(on) => setFilters((prev) => ({ ...prev, playerSawFlop: on }))}
          />
          <FilterToggle
            label={selectedPlayer ? `${selectedPlayer.name} showed cards` : "Player showed cards"}
            checked={filters.playerShowed}
            disabled={!filters.playerId}
            title={filters.playerId ? undefined : "Pick a player first"}
            onChange={(on) => setFilters((prev) => ({ ...prev, playerShowed: on }))}
          />
        </div>
      }
    />
  );
};

export default HandFilterBar;
