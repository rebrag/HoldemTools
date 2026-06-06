import React, { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { formatMoney } from "./utils";
import type { BankrollSession, CumulativePoint } from "./types";

type ChartDatum = {
  idx: number;
  hours: number;
  profit: number;
  session: BankrollSession | null;
};


type Props = {
  points: CumulativePoint[];
  hoverIndex: number | null;
  onHoverIndexChange: (idx: number | null) => void;
};

function niceNum(range: number, round: boolean): number {
  if (!Number.isFinite(range) || range <= 0) return 1;

  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);

  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * Math.pow(10, exponent);
}

function buildNiceDomainAndTicks(maxValue: number, maxTicks: number): { max: number; ticks: number[]; step: number } {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const step = niceNum(safeMax / Math.max(1, maxTicks - 1), true);

  const max = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];

  for (let v = 0; v <= max + step * 0.0001; v += step) {
    const rounded = Math.round(v * 1000) / 1000;
    ticks.push(rounded);
  }

  return { max, ticks, step };
}

function buildNiceYDomain(values: number[], maxTicks: number): { min: number; max: number; ticks: number[]; step: number } {
  let min = 0;
  let max = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = niceNum(max - min || 1, false);
  const step = niceNum(range / Math.max(1, maxTicks - 1), true);

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.0001; v += step) {
    const rounded = Math.round(v * 1000) / 1000;
    ticks.push(rounded);
  }

  return { min: niceMin, max: niceMax, ticks, step };
}

function fmtHoursTick(v: number, step: number): string {
  if (!Number.isFinite(v)) return "";
  const decimals = step < 1 ? 1 : 0;
  return v.toFixed(decimals);
}

function fmtMoneyTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  return `$${formatMoney(v)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function ChartTooltipContent(props: TooltipProps<number, string>): React.ReactElement | null {
  const payload = props.payload;
  if (!payload || payload.length === 0) return null;

  const first = payload[0];
  const datum = first?.payload as ChartDatum | undefined;
  if (!datum) return null;

  const s = datum.session;

  const profit = s?.profit ?? datum.profit;
  const buyIn = s?.buyIn;
  const cashOut = s?.cashOut;
  const hours = s?.hours ?? datum.hours;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 shadow-xl shadow-black/30">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-semibold text-white/90">
          Session {datum.idx}
        </div>
        <div className="text-[11px] text-white/70">{fmtDate(s?.start)}</div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div className="text-white/70">Profit</div>
        <div className="text-right font-semibold text-white">{fmtMoneyTick(profit)}</div>

        <div className="text-white/70">Hours</div>
        <div className="text-right text-white/90">{hours.toFixed(2)}</div>

        <div className="text-white/70">Buy-in</div>
        <div className="text-right text-white/90">{buyIn == null ? "—" : fmtMoneyTick(buyIn)}</div>

        <div className="text-white/70">Cash-out</div>
        <div className="text-right text-white/90">{cashOut == null ? "—" : fmtMoneyTick(cashOut)}</div>

        <div className="text-white/70">Location</div>
        <div className="text-right text-white/90">{s?.location?.trim() ? s.location : "—"}</div>

        <div className="text-white/70">Game</div>
        <div className="text-right text-white/90">{s?.blinds?.trim() ? s.blinds : "—"}</div>
      </div>
    </div>
  );
}

const BankrollChartShadcn: React.FC<Props> = ({ points, onHoverIndexChange }) => {
  const location = useLocation();
  const chartRemountKey = location.key;

  const hasData = points.length > 1;

  const data: ChartDatum[] = useMemo((): ChartDatum[] => {
    return points.map((p, idx) => ({
      idx,
      hours: p.x,
      profit: p.y,
      session: p.session,
    }));
  }, [points]);

  const xMaxRaw = useMemo((): number => {
    let m = 0;
    for (const d of data) {
      if (Number.isFinite(d.hours) && d.hours > m) m = d.hours;
    }
    return m;
  }, [data]);

  const yValues = useMemo((): number[] => data.map((d) => d.profit), [data]);

  const xAxis = useMemo(() => buildNiceDomainAndTicks(xMaxRaw, 6), [xMaxRaw]);
  const yAxis = useMemo(() => buildNiceYDomain(yValues, 6), [yValues]);

  const [isInteracting, setIsInteracting] = useState(false);

  if (!hasData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-emerald-200/90">
        Add a session above to see your profit curve come to life.
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          key={chartRemountKey}
          data={data}
          margin={{ top: 12, right: 14, bottom: 18, left: 10 }}
          onMouseMove={(state) => {
            const ap = state.activePayload;
            if (!ap || ap.length === 0) return;
            const d = ap[0]?.payload as ChartDatum | undefined;
            if (!d) return;
            setIsInteracting(true);
            onHoverIndexChange(d.idx);
          }}
          onMouseLeave={() => {
            setIsInteracting(false);
            onHoverIndexChange(null);
          }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="rgba(255,255,255,0.12)" />

          <XAxis
            type="number"
            dataKey="hours"
            domain={[0, xAxis.max]}
            ticks={xAxis.ticks}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.85)", fontSize: 11 }}
            tickFormatter={(v: number) => fmtHoursTick(v, xAxis.step)}
            padding={{ left: 0, right: 0 }}
            label={{ value: "Hours", position: "insideBottom", offset: -10, fill: "rgba(255,255,255,0.8)", fontSize: 12 }}
          />

          <YAxis
            type="number"
            domain={[yAxis.min, yAxis.max]}
            ticks={yAxis.ticks}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "rgba(255,255,255,0.85)", fontSize: 11 }}
            tickFormatter={(v: number) => fmtMoneyTick(v)}
            label={{ value: "Profit", angle: -90, position: "insideLeft", fill: "rgba(255,255,255,0.8)", fontSize: 12 }}
          />

          <Tooltip
            cursor={isInteracting ? { stroke: "rgba(255,255,255,0.35)", strokeDasharray: "4 4" } : false}
            content={<ChartTooltipContent />}
          />

          <Line
            type="monotone"
            dataKey="profit"
            stroke="#34d399"
            strokeWidth={2.6}
            dot={false}
            activeDot={{ r: 4.5, strokeWidth: 0, fill: "#34d399" }}
            isAnimationActive={true}
            animationDuration={550}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BankrollChartShadcn;
