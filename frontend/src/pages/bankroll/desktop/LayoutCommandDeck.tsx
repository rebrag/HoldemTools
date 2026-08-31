// src/bankroll/desktop/LayoutCommandDeck.tsx
// Option A — "Command Deck": full dark-glass dashboard grid. Hero profit +
// chart share one large card, the breakdown panel sits beside it, and the
// session history stretches full width underneath.
import React, { useState } from "react";
import LoadingIndicator from "@/components/LoadingIndicator";
import BankrollChartShadcn from "../BankrollChartShadcn";
import BreakdownTable, { type BreakdownTableMode } from "../BreakdownTable";
import SessionHistoryTable from "../SessionHistoryTable";
import SessionFilterPanel from "@/components/filters/SessionFilterPanel";
import HoursRangeFields from "@/components/filters/HoursRangeFields";
import {
  type DesktopLayoutProps,
  GlassCard,
  SlidingMoney,
  humanHoursLabel,
  AddSessionButton,
  ErrorBanner,
  SegmentedControl,
  FilterToggleButton,
} from "./shared";

const LayoutCommandDeck: React.FC<DesktopLayoutProps> = (props) => {
  const {
    stats,
    displayStats,
    isHoveringChart,
    loading,
    error,
    cumulativePoints,
    chartNonce,
    onHoverIndexChange,
    filteredSessions,
    totalSessions,
    filteredCount,
    isFiltering,
    filters,
    setFilters,
    knownLocations,
    knownGames,
    onResetFilters,
    onThisYear,
    onAddSession,
    onEditSession,
    onDeleteSession,
  } = props;

  const active = isHoveringChart ? displayStats : stats;
  const [breakdown, setBreakdown] = useState<BreakdownTableMode>("month");
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Bankroll Tracker
          </h1>
          <p className="mt-1 text-sm text-emerald-100/80">
            Log each session, watch your profit curve grow, and keep your grind
            on track.
          </p>
        </div>
        <AddSessionButton onClick={onAddSession} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-12 gap-5">
        {/* hero: profit + chart */}
        <GlassCard className="col-span-8 overflow-hidden">
          <div className="flex items-start justify-between gap-6 px-6 pt-5">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-emerald-100/70">
                {isHoveringChart ? "Profit at hover" : "Total profit"}
              </div>
              <div className="mt-1">
                <SlidingMoney
                  value={active.totalProfit}
                  className="text-5xl font-semibold"
                />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-1">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-emerald-100/60">
                  Hours
                </div>
                <div className="mt-1 text-sm font-semibold text-emerald-50 whitespace-nowrap">
                  {humanHoursLabel(active.totalHours)}
                </div>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-emerald-100/60">
                  Sessions
                </div>
                <div className="mt-1 text-sm font-semibold text-emerald-50 tabular-nums">
                  {active.numSessions}
                </div>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-emerald-100/60">
                  Winrate
                </div>
                <div className="mt-1 text-sm font-semibold whitespace-nowrap">
                  <SlidingMoney value={active.hourly} decimalPlaces={2} />
                  <span className="ml-0.5 text-[10px] font-normal text-emerald-100/60">
                    /hr
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 px-2 pb-2">
            {loading ? (
              <div className="flex h-[340px] items-center justify-center">
                <LoadingIndicator />
              </div>
            ) : cumulativePoints.length === 0 ? (
              <div className="flex h-[340px] items-center justify-center text-xs text-emerald-100/80">
                No sessions match the current filters.
              </div>
            ) : (
              <BankrollChartShadcn
                key={`bankroll-chart-deck-${chartNonce}`}
                points={cumulativePoints}
                onHoverIndexChange={onHoverIndexChange}
                heightClass="h-[340px]"
              />
            )}
          </div>
        </GlassCard>

        {/* breakdown */}
        <GlassCard className="col-span-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-emerald-50">Breakdown</h2>
            <SegmentedControl
              options={[
                { key: "weekday", label: "Weekday" },
                { key: "month", label: "Month" },
                { key: "year", label: "Year" },
                { key: "game", label: "Game" },
              ]}
              value={breakdown}
              onChange={setBreakdown}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            <BreakdownTable
              sessions={filteredSessions}
              mode={breakdown}
              theme="dark"
            />
          </div>
        </GlassCard>
      </div>

      {/* session history */}
      <GlassCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-emerald-50">
              Session history
            </h2>
            <span className="text-xs text-emerald-100/70">
              {isFiltering
                ? `${filteredCount} of ${totalSessions} sessions shown`
                : `${totalSessions} session${totalSessions === 1 ? "" : "s"} logged`}
            </span>
          </div>
          <FilterToggleButton
            active={showFilters}
            isFiltering={isFiltering}
            onClick={() => setShowFilters((v) => !v)}
          />
        </div>

        {showFilters && (
          <SessionFilterPanel
            theme="dark"
            filters={filters}
            setFilters={setFilters}
            knownLocations={knownLocations}
            knownGames={knownGames}
            filteredCount={filteredCount}
            totalCount={totalSessions}
            countNoun="sessions"
            isFiltering={isFiltering}
            onReset={onResetFilters}
            onThisYear={onThisYear}
            onHide={() => setShowFilters(false)}
            extraRows={
              <HoursRangeFields
                theme="dark"
                minHours={filters.minHours}
                maxHours={filters.maxHours}
                onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
              />
            }
          />
        )}

        <SessionHistoryTable
          sessions={filteredSessions}
          onEdit={onEditSession}
          onDelete={onDeleteSession}
          theme="dark"
        />
      </GlassCard>
    </div>
  );
};

export default LayoutCommandDeck;
