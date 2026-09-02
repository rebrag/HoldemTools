// src/pages/multiway/SessionFanChart.tsx
//
// The shape of a session: percentile bands of the team's cumulative result
// over the hands of one session, the median, the expectation, and one real
// simulated session so the bands read as what they are - the envelope of
// paths like that one.
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { SessionAnalysis } from "@/lib/sessionSim/types";

const MEDIAN = "#34d399";
const EXPECTED = "#94a3b8";
const SAMPLE = "#fbbf24";
const TICK = { fill: "rgba(255,255,255,0.75)", fontSize: 11 };

interface Row {
  hands: number;
  band90: [number, number];
  band50: [number, number];
  p50: number;
  expected: number;
  sample: number;
}

const fmtBb = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")}`;

function FanTooltip(props: TooltipProps<number, string>) {
  const row = props.payload?.[0]?.payload as Row | undefined;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 text-[11px] shadow-xl shadow-black/30">
      <div className="mb-1 font-semibold text-white/90">
        after {row.hands.toLocaleString("en-US")} hands
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
        <span className="text-white/60">5th to 95th</span>
        <span className="text-right text-white/90">
          {fmtBb(row.band90[0])} to {fmtBb(row.band90[1])} bb
        </span>
        <span className="text-white/60">25th to 75th</span>
        <span className="text-right text-white/90">
          {fmtBb(row.band50[0])} to {fmtBb(row.band50[1])} bb
        </span>
        <span className="text-white/60">median</span>
        <span className="text-right text-white">{fmtBb(row.p50)} bb</span>
        <span className="text-white/60">expectation</span>
        <span className="text-right text-white/90">{fmtBb(row.expected)} bb</span>
        <span className="text-white/60">one session</span>
        <span className="text-right text-white/90">{fmtBb(row.sample)} bb</span>
      </div>
    </div>
  );
}

const SessionFanChart = ({
  fan,
  bankroll,
  animate,
}: {
  fan: SessionAnalysis["fan"];
  /** Drawn as a reference line at -bankroll, when it is on screen. */
  bankroll?: number;
  /** One finite draw animation when a result arrives; never continuous. */
  animate: boolean;
}) => {
  const data = useMemo<Row[]>(
    () =>
      fan.hands.map((hands, i) => ({
        hands,
        band90: [fan.p5[i], fan.p95[i]],
        band50: [fan.p25[i], fan.p75[i]],
        p50: fan.p50[i],
        expected: fan.expected[i],
        sample: fan.sample[i],
      })),
    [fan]
  );
  return (
    <div className="h-[280px] w-full sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="rgba(255,255,255,0.12)" />
          <XAxis
            type="number"
            dataKey="hands"
            domain={[0, "dataMax"]}
            tickLine={false}
            axisLine={false}
            tick={TICK}
            tickFormatter={(v: number) => v.toLocaleString("en-US")}
          />
          <YAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={TICK}
            width={52}
            tickFormatter={(v: number) => Math.round(v).toLocaleString("en-US")}
          />
          <Tooltip content={<FanTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
          <Legend
            verticalAlign="top"
            height={28}
            iconSize={10}
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" />
          {bankroll != null && (
            <ReferenceLine
              y={-bankroll}
              stroke="#f87171"
              strokeDasharray="4 4"
              label={{ value: `bust at -${bankroll} bb`, fill: "#f87171", fontSize: 10, position: "insideBottomRight" }}
            />
          )}
          <Area
            dataKey="band90"
            name="5th to 95th percentile"
            fill={MEDIAN}
            fillOpacity={0.12}
            stroke="none"
            isAnimationActive={animate}
            animationDuration={500}
          />
          <Area
            dataKey="band50"
            name="25th to 75th percentile"
            fill={MEDIAN}
            fillOpacity={0.22}
            stroke="none"
            isAnimationActive={animate}
            animationDuration={500}
          />
          <Line
            dataKey="p50"
            name="median session"
            stroke={MEDIAN}
            strokeWidth={2}
            dot={false}
            isAnimationActive={animate}
            animationDuration={500}
          />
          <Line
            dataKey="expected"
            name="expectation"
            stroke={EXPECTED}
            strokeWidth={1.2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="sample"
            name="one simulated session"
            stroke={SAMPLE}
            strokeWidth={1.2}
            dot={false}
            isAnimationActive={animate}
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SessionFanChart;
