// src/pages/multiway/DrawdownChart.tsx
//
// P(biggest downswing in a session >= x), one curve per session length. A
// prefix of a session is a session of that length, so the shorter lengths
// come from the same simulated sessions.
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { SessionAnalysis } from "@/lib/sessionSim/types";

const COLORS = ["#fbbf24", "#38bdf8", "#34d399"];
const TICK = { fill: "rgba(255,255,255,0.75)", fontSize: 11 };

type Row = Record<string, number>;

function DrawdownTooltip(props: TooltipProps<number, string>) {
  const payload = props.payload;
  if (!payload || payload.length === 0) return null;
  const x = (payload[0].payload as Row).x;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 text-[11px] shadow-xl shadow-black/30">
      <div className="mb-1 font-semibold text-white/90">a downswing of {x} bb or more</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
        {payload.map((p) => (
          <span key={String(p.dataKey)} className="contents">
            <span className="text-white/60">{p.name}</span>
            <span className="text-right text-white/90">{((p.value ?? 0) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const DrawdownChart = ({
  curves,
  bankrolls,
  animate,
}: {
  curves: SessionAnalysis["drawdown"];
  bankrolls: number[];
  animate: boolean;
}) => {
  const data = useMemo<Row[]>(() => {
    const x = curves[0]?.x ?? [];
    return x.map((xv, i) => {
      const row: Row = { x: xv };
      for (const c of curves) row[`h${c.hands}`] = c.p[i];
      return row;
    });
  }, [curves]);
  const xMax = curves[0]?.x[curves[0].x.length - 1] ?? 0;
  return (
    <div className="h-[260px] w-full sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="rgba(255,255,255,0.12)" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, xMax]}
            tickLine={false}
            axisLine={false}
            tick={TICK}
            tickFormatter={(v: number) => `${v}`}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickLine={false}
            axisLine={false}
            tick={TICK}
            width={40}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          <Tooltip content={<DrawdownTooltip />} cursor={{ stroke: "rgba(255,255,255,0.25)" }} />
          <Legend
            verticalAlign="top"
            height={28}
            iconSize={10}
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}
          />
          {bankrolls
            .filter((b) => b <= xMax)
            .map((b) => (
              <ReferenceLine key={b} x={b} stroke="#f87171" strokeDasharray="4 4" />
            ))}
          {curves.map((c, i) => (
            <Line
              key={c.hands}
              dataKey={`h${c.hands}`}
              name={`${c.hands.toLocaleString("en-US")} hands`}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
              animationDuration={500}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DrawdownChart;
