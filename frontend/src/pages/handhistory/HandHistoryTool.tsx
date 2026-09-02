// src/pages/handhistory/HandHistoryTool.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigate } from "@/components/layout/RouteProgress";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import { authedFetch } from "@/lib/api";
import { cacheHandTexts, forgetCachedHandText } from "@/lib/handTextCache";
import { useLocalHandHistories } from "@/hooks/useLocalHandHistories";
import useHandSolutions from "@/hooks/useHandSolutions";
import useNoOverscroll from "@/hooks/useNoOverscroll";
import { solutionOpenUrl } from "@/lib/solver/postflopLibrary";
import HandHistorySecondaryNav from "./HandHistorySecondaryNav";
import HandRow from "./HandRow";
import FlyingCards from "./FlyingCards";
import HandFilterMenu from "./HandFilterMenu";
import PlayerEditorDrawer from "./players/PlayerEditorDrawer";
import {
  HAND_FILTERS_KEY,
  defaultHandFilters,
  isFiltering as isFilteringHands,
  parseHandFiltersOrDefault,
  rowMatches,
  type HandFilterState,
} from "./handFilters";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { usePlayers } from "@/hooks/usePlayers";
import { summaryFromRawText, stripReplay } from "./create/replay";
import { TEST_HAND_ID, buildTestHandText, SHOW_TEST_HAND } from "./create/testHand";
import type {
  HandHistory,
  HandHistoryToolProps,
  LocalHandHistory,
  ToolRow,
} from "./types";
import type { BankrollSession } from "@/pages/bankroll/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

// Rows rendered initially and added per "Load more" click. Every row mounts a
// stack of PlayingCard nodes plus enter springs, so the list renders in pages
// instead of all at once (a long-running account can hold thousands of hands).
const PAGE_SIZE = 25;

// A hand linked to a session shows that session's location/blinds (the day is
// carried by the group header now, so the date is omitted here).
function sessionMeta(s: BankrollSession): string {
  return [s.location?.trim(), s.blinds?.trim()].filter(Boolean).join(" · ");
}

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

// Section-header label for a day: "Today" / "Yesterday" for the two most recent
// calendar days, otherwise a plain date like "Jul 7, 2026".
function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const HandHistoryTool: React.FC<HandHistoryToolProps> = ({ user }) => {
  const navigate = useAppNavigate();
  const reduce = useReducedMotion();
  // The list paginates rather than growing without bound, so the rubber-band
  // only ever reveals backdrop below the last row.
  useNoOverscroll();
  const [items, setItems] = useState<HandHistory[]>([]);
  // Seeded from whether a fetch is guaranteed on mount — see BankrollTracker;
  // starting at `false` flashes the "no hand histories yet" empty state first.
  const [loading, setLoading] = useState(!!user);
  // Gates only the spinner's visibility, never the loading/empty branch below —
  // see useDelayedLoading. A fast response renders a blank box, not "no hands".
  const showSpinner = useDelayedLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Two pieces of state, not one: the drawer stays mounted so its exit
  // animation plays, and it needs a player to render against while closing.
  const [playerDrawerOpen, setPlayerDrawerOpen] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sessionsById, setSessionsById] = useState<Map<string, BankrollSession>>(
    new Map()
  );

  // Search/filter state, persisted like bankroll's (tolerant parser: a stale
  // or malformed blob falls back to defaults field-by-field).
  const [filters, setFilters] = useLocalStorageState<HandFilterState>(
    HAND_FILTERS_KEY,
    defaultHandFilters,
    parseHandFiltersOrDefault
  );
  const filtering = isFilteringHands(filters);

  // A persisted player filter can outlive the player (deleted on the Players
  // page). Once the roster has loaded, drop the dangling ids - otherwise the
  // filter silently blanks the list with no row to explain why (the list can't
  // even display the selection any more).
  const {
    byId: knownPlayers,
    loading: playersLoading,
    signedIn: playersSignedIn,
  } = usePlayers();
  useEffect(() => {
    // `signedIn` gates this too, not just `loading`: usePlayers reports
    // loading=false while Firebase is still resolving auth, so without it a
    // reload sees an empty roster and wipes a perfectly good saved filter.
    if (!playersSignedIn || playersLoading || filters.playerIds.length === 0) return;
    if (filters.playerIds.every((id) => knownPlayers.has(id))) return;
    setFilters((prev) => {
      const playerIds = prev.playerIds.filter((id) => knownPlayers.has(id));
      return playerIds.length
        ? { ...prev, playerIds }
        : { ...prev, playerIds, playerSawFlop: false, playerShowed: false };
    });
  }, [playersSignedIn, playersLoading, knownPlayers, filters.playerIds, setFilters]);

  // Which saved hands have a solved board, for the "view solution" button.
  const solutionByHandId = useHandSolutions(Boolean(user));

  // Local (signed-out) store. When signed in these are migrated to the server
  // and cleared (see the migration effect below).
  const { localHands, removeLocal, setLocal } = useLocalHandHistories();
  const localHandsRef = useRef<LocalHandHistory[]>(localHands);
  localHandsRef.current = localHands;

  const itemsRef = useRef<HandHistory[]>([]);
  itemsRef.current = items;

  const sortByNewest = (list: HandHistory[]) =>
    [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const shouldBlock = itemsRef.current.length === 0;
      try {
        if (shouldBlock) setLoading(true);
        setError(null);
        const res = await authedFetch("/api/handhistory");
        if (!res.ok) {
          throw new Error(
            `We couldn't load your hand histories yet. (${res.status})`
          );
        }
        const data = (await res.json()) as HandHistory[];
        if (!cancelled) setItems(sortByNewest(data));
      } catch (e: unknown) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "We couldn't load your hand histories yet."
          );
        }
      } finally {
        if (!cancelled && shouldBlock) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // reloadNonce lets the migration effect force a refetch after uploading.
  }, [user, reloadNonce]);

  // Auto-migrate device-saved (signed-out) hands to the account on sign-in.
  // Runs once when `user` becomes set (or on mount if already signed in with a
  // non-empty store). Any hands that fail to upload stay in localStorage; we
  // don't auto-retry here to avoid hammering the API on a persistent failure.
  const migratingRef = useRef(false);
  useEffect(() => {
    if (!user || migratingRef.current) return;
    const pending = localHandsRef.current;
    if (pending.length === 0) return;
    migratingRef.current = true;
    let cancelled = false;
    (async () => {
      const failed: LocalHandHistory[] = [];
      for (const h of pending) {
        try {
          const res = await authedFetch("/api/handhistory", {
            method: "POST",
            body: JSON.stringify({ rawText: h.rawText, sessionId: null }),
          });
          if (!res.ok) throw new Error();
        } catch {
          failed.push(h);
        }
      }
      migratingRef.current = false;
      if (cancelled) return;
      setLocal(failed); // keep only failures; clears to [] on full success
      if (failed.length > 0) {
        setError(
          "We couldn't sync some hands saved on this device. They're still saved here."
        );
      }
      setReloadNonce((n) => n + 1); // refetch so migrated hands appear
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setLocal]);

  // Load the user's bankroll sessions so linked hands can show their
  // session's date/location. Best-effort: labels are an enhancement, so
  // failures here are silent and don't block the hand list.
  useEffect(() => {
    if (!user) {
      setSessionsById(new Map());
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/bankroll?userId=${encodeURIComponent(user.uid)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as BankrollSession[];
        if (cancelled) return;
        const map = new Map<string, BankrollSession>();
        for (const s of data) map.set(s.id, s);
        setSessionsById(map);
      } catch {
        // ignore — session labels are non-critical
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Signed in → show server hands; signed out → show device-local hands.
  // (After sign-in the local store is migrated + cleared, so there's never a
  // lasting "both" state to reconcile.)
  // Dev-only "test" fixture: rendered through the live serializer so it tracks
  // any change to the output format. Computed once (recomputes on HMR reload).
  const testRawText = useMemo(
    () => (SHOW_TEST_HAND ? buildTestHandText() : ""),
    []
  );

  const rows: ToolRow[] = useMemo(() => {
    const base: ToolRow[] = user
      ? items.map((hh) => ({
          key: String(hh.id),
          isLocal: false,
          rawText: hh.rawText,
          clean: stripReplay(hh.rawText),
          replayable: summaryFromRawText(hh.rawText) != null,
          createdAt: hh.createdAt,
          sessionId: hh.sessionId,
          server: hh,
        }))
      : localHands.map((h) => ({
          key: h.localId,
          isLocal: true,
          rawText: h.rawText,
          clean: stripReplay(h.rawText),
          replayable: summaryFromRawText(h.rawText) != null,
          createdAt: h.createdAt,
          sessionId: null,
        }));
    base.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (SHOW_TEST_HAND) {
      // Always first, regardless of dates. Not persisted anywhere.
      base.unshift({
        key: TEST_HAND_ID,
        isLocal: false,
        rawText: testRawText,
        clean: stripReplay(testRawText),
        // Carries an embedded payload and is resolved by TEST_HAND_ID on the
        // replay route (rebuilt on demand since it isn't persisted).
        replayable: summaryFromRawText(testRawText) != null,
        createdAt: "2020-01-01T00:00:00.000Z",
        sessionId: null,
        synthetic: true,
      });
    }
    return base;
  }, [user, items, localHands, testRawText]);

  // Filtering preserves the createdAt-desc order, so the day/session grouping
  // below keeps working on the filtered subset. The dev test fixture is always
  // shown (it exists to eyeball the serializer, not to be searched).
  const filteredRows = useMemo(
    () =>
      filtering
        ? rows.filter((r) => r.synthetic || rowMatches(r, filters))
        : rows,
    [rows, filtering, filters]
  );

  // Start back at the first page when switching between accounts/stores or
  // when the filter set changes (page N of one result set is meaningless in
  // another).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [user, filters]);

  // Only the visible page is grouped/rendered; the rest sit behind "Load more".
  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount]
  );
  const remaining = filteredRows.length - visibleRows.length;

  // Seed the cross-tab cache so the replay tab these rows link to paints
  // without waiting on auth + a round trip.
  useEffect(() => {
    cacheHandTexts(visibleRows.map((r) => [r.key, r.rawText] as [string, string]));
  }, [visibleRows]);

  // Group the (already date-sorted) visible rows twice over: by calendar day so
  // the list shows one day header instead of a timestamp on every row, then
  // within a day by bankroll session, so a night's worth of hands sits under a
  // single "Hard Rock Tampa · 2/5 NL" header rather than repeating that pill on
  // every row. Hands with no session are grouped together headerless - there's
  // nothing to label them with.
  const groups = useMemo(() => {
    type Block = { sessionId: string | null; meta: string; rows: ToolRow[] };
    const out: { day: string; blocks: Block[] }[] = [];
    for (const row of visibleRows) {
      const day = formatDay(row.createdAt);
      let group = out[out.length - 1];
      if (!group || group.day !== day) {
        group = { day, blocks: [] };
        out.push(group);
      }
      const last = group.blocks[group.blocks.length - 1];
      if (last && last.sessionId === row.sessionId) {
        last.rows.push(row);
      } else {
        const session = row.sessionId ? sessionsById.get(row.sessionId) : null;
        group.blocks.push({
          sessionId: row.sessionId,
          meta: session ? sessionMeta(session) : "",
          rows: [row],
        });
      }
    }
    return out;
  }, [visibleRows, sessionsById]);

  // Row callbacks are useCallback-stable so the memoized HandRow only
  // re-renders when its own expanded/menu/flash state changes.

  const handleDelete = useCallback(
    async (row: ToolRow) => {
      if (row.synthetic) return; // the test fixture isn't deletable
      if (!window.confirm("Delete this hand history? This can't be undone.")) return;
      // Signed out: delete from the device-local store.
      if (!user) {
        removeLocal(row.key);
        return;
      }
      const prev = itemsRef.current;
      setItems((p) => p.filter((i) => String(i.id) !== row.key));
      forgetCachedHandText(row.key);
      try {
        const res = await authedFetch(`/api/handhistory/${row.server!.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();
      } catch {
        setItems(prev); // rollback
        setError("We couldn't delete that hand history. Please try again.");
      }
    },
    [user, removeLocal]
  );

  const toggleExpand = useCallback(
    (key: string) => setExpandedKey((k) => (k === key ? null : key)),
    []
  );

  // Tapping a player's photo in a row opens their editor in place — the roster
  // page is no longer a stop on the way. useCallback with no deps (both
  // setters are stable) because this reference travels down through three
  // memoized components; see HandPreview.onPlayerClick.
  const handlePlayerClick = useCallback((playerId: string) => {
    setEditingPlayerId(playerId);
    setPlayerDrawerOpen(true);
  }, []);

  const resetFilters = () => setFilters(defaultHandFilters);

  // How many independent criteria are active - the badge on the Filters
  // button. The whole player selection is ONE criterion: the ids are ORed, so
  // adding a second name widens the result set rather than narrowing it.
  const hasPlayers = filters.playerIds.length > 0;
  const activeFilterCount =
    (hasPlayers ? 1 : 0) +
    (hasPlayers && filters.playerSawFlop ? 1 : 0) +
    (hasPlayers && filters.playerShowed ? 1 : 0) +
    (filters.anyKnownCards ? 1 : 0);

  return (
    <>
      <HandHistorySecondaryNav
        onCreate={() => navigate("/hand-history/create")}
        /* Signed-out users have no players to filter by, so the affordance is
           hidden entirely. */
        filters={
          user ? (
            <HandFilterMenu
              filters={filters}
              setFilters={setFilters}
              filteredCount={filteredRows.length}
              totalCount={rows.length}
              isFiltering={filtering}
              activeFilterCount={activeFilterCount}
              onReset={resetFilters}
            />
          ) : undefined
        }
      />

      {/* No top padding on phones: the list is full-bleed there, so any gap
          under the secondary nav reads as a stray band of backdrop rather than
          breathing room. Each child that isn't the list restores its own inset
          (mt-4) so nothing else ends up flush against the bar. */}
      <div className="mx-auto max-w-3xl px-4 pb-12 sm:pt-5">
      <FlyingCards />

      <AnimatePresence>
        {!user && localHands.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 mt-4 overflow-hidden rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:mt-0"
          >
            Saved on this device.{" "}
            <span className="font-semibold">Sign in</span> to sync your hand
            histories across devices.
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 mt-4 overflow-hidden rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:mt-0"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          {showSpinner && <LoadingIndicator />}
        </div>
      ) : rows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="mt-4 rounded-2xl border border-dashed border-emerald-300/50 bg-white/70 px-6 py-12 text-center backdrop-blur-sm sm:mt-0"
        >
          <motion.div
            aria-hidden="true"
            animate={reduce ? undefined : { y: [0, -8, 0], rotate: [-4, 4, -4] }}
            transition={
              reduce
                ? undefined
                : { duration: 4, repeat: Infinity, ease: "easeInOut" }
            }
            className="mx-auto mb-3 w-fit text-4xl"
          >
            🂡
          </motion.div>
          <p className="text-sm text-gray-600">No hand histories yet.</p>
          <button
            type="button"
            onClick={() => navigate("/hand-history/create")}
            className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
          >
            Add your first one
          </button>
        </motion.div>
      ) : (
        <>
        {filteredRows.length === 0 ? (
          /* Hands exist but none match — distinct from the no-hands-at-all
             state so it's obvious the filters (not the data) are the cause. */
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            className="mt-4 rounded-2xl border border-dashed border-emerald-300/50 bg-white/70 px-6 py-10 text-center backdrop-blur-sm sm:mt-0"
          >
            <p className="text-sm text-gray-600">
              No hands match the current filters.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600"
            >
              Clear filters
            </button>
          </motion.div>
        ) : (
        <>
        {/* Edge-to-edge on phones (the -mx-4 cancels the page gutter) so the
            card fans get the full screen width; a rounded card again from sm.
            On phones it starts flush under the secondary nav, whose own bottom
            border is the only rule needed between the two - hence border-b
            here, and all four sides only once the list becomes a card.
            The fill is fully opaque on purpose: FlyingCards animates behind
            every page, and a translucent list forces the browser to re-blend
            (and so repaint) every row against a moving backdrop on each scroll
            frame, which is what left card fans blank mid-scroll on iOS. */}
        <motion.ul
          className="-mx-4 divide-y divide-emerald-100 overflow-hidden border-b border-emerald-300/40 bg-white shadow-sm shadow-emerald-500/10 sm:mx-0 sm:rounded-2xl sm:border"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence initial={false}>
          {groups.flatMap((group) => [
            <li
              key={`day-${group.day}`}
              className="bg-emerald-50/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700/70"
            >
              {group.day}
            </li>,
            ...group.blocks.flatMap((block) => [
              ...(block.meta
                ? [
                    <li
                      key={`session-${block.rows[0].key}`}
                      className="flex items-center gap-1.5 px-3 pb-0.5 pt-1.5 text-[11px] font-semibold text-emerald-800"
                    >
                      <span aria-hidden="true">🗓</span>
                      <span className="truncate">{block.meta}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-50 px-2 py-[1px] text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        {block.rows.length} hand{block.rows.length === 1 ? "" : "s"}
                      </span>
                    </li>,
                  ]
                : []),
              ...block.rows.map((row) => {
                const solution = row.server ? solutionByHandId[row.server.id] : undefined;
                return (
                  <HandRow
                    key={row.key}
                    row={row}
                    solutionHref={solution ? solutionOpenUrl(solution) : null}
                    expanded={expandedKey === row.key}
                    onToggleExpand={toggleExpand}
                    onDelete={handleDelete}
                    onError={setError}
                    onPlayerClick={user ? handlePlayerClick : undefined}
                  />
                );
              }),
            ]),
          ])}
          </AnimatePresence>
        </motion.ul>

        {remaining > 0 && (
          <div className="mt-4 flex justify-center">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="rounded-xl border border-emerald-300 bg-white/90 px-5 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50"
            >
              Load {Math.min(PAGE_SIZE, remaining)} more
              <span className="ml-2 font-normal text-emerald-600/70">
                {remaining} remaining
              </span>
            </motion.button>
          </div>
        )}
        </>
        )}
        </>
      )}

      </div>

      {/* Mounted permanently (open toggles) so the sheet's exit animation
          plays. handCount is deliberately omitted: computing it means folding
          the replay of every hand, and a count over just the loaded page would
          be misleading. */}
      <PlayerEditorDrawer
        open={playerDrawerOpen}
        player={editingPlayerId ? knownPlayers.get(editingPlayerId) ?? null : null}
        onClose={() => setPlayerDrawerOpen(false)}
        onOpenRoster={() => navigate("/hand-history/players")}
      />
    </>
  );
};

export default HandHistoryTool;
