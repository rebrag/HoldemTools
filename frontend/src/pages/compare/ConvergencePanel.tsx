/** Exploitability against solver time, one line per htsolver core.
 *
 *  This is the panel that answers "which core converges faster": the engine
 *  stamps every checkpoint's (iteration, seconds, exploitable) into the
 *  artifact, and the two cores' traces are drawn on one pair of axes with
 *  the accuracy target as a line across them. The x axis is SOLVER time by
 *  default - seconds inside the iteration loop, excluding the exploitability
 *  measurements - because the measurement cadence is a harness choice, and
 *  a full vectorized best-response pass per checkpoint is a large share of
 *  the sampled core's wall clock. Wall clock is one toggle away.
 *
 *  Static SVG: nothing here animates, ticks, or repaints while idle. */
import { useMemo, useState } from "react";
import { secs } from "./PipelineTimingPanel";

/** The engine's `metadata.convergence`: parallel arrays, thinned to at most
 *  ~2000 points by a fixed stride that always keeps the last checkpoint. */
export interface ConvergenceTrace {
  iteration: number[];
  elapsed_s: number[];
  solve_s: number[];
  nashconv: number[];
  exploitable_chips: number[];
  points: number;
  total_points: number;
  stride: number;
}

export interface ConvergenceSeries {
  key: string;
  name: string;
  /** Series colour as a hex, for the SVG stroke. */
  color: string;
  /** Tailwind text class carrying the same identity in the table. */
  textClass: string;
  trace: ConvergenceTrace | null | undefined;
  /** Why the loop ended early, if it did ("time_budget" | "cancelled"). */
  stoppedReason?: string | null;
  /** The run's final iteration count, for the "ran to its cap" reading. */
  iterations?: number | null;
}

/** When a series first crossed the target, or null if it never did. */
export interface TargetCrossing {
  iteration: number;
  solve_s: number;
  elapsed_s: number;
}

export const targetCrossing = (
  trace: ConvergenceTrace | null | undefined,
  targetChips: number
): TargetCrossing | null => {
  if (!trace || !(targetChips > 0)) return null;
  for (let i = 0; i < trace.exploitable_chips.length; i++) {
    if (trace.exploitable_chips[i] <= targetChips) {
      return {
        iteration: trace.iteration[i],
        solve_s: trace.solve_s[i],
        elapsed_s: trace.elapsed_s[i],
      };
    }
  }
  return null;
};

interface Props {
  series: ConvergenceSeries[];
  /** Root pot in chips: exploitable chips are shown as a percent of it. */
  pot: number;
  /** The shared accuracy target, as a percent of the pot; null = none. */
  targetPct: number | null;
}

type Axis = "solve_s" | "elapsed_s";

const W = 640;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 30, left: 48 };

const fmtPct = (v: number): string =>
  v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3);

const ConvergencePanel = ({ series, pot, targetPct }: Props) => {
  const [axis, setAxis] = useState<Axis>("solve_s");
  const present = series.filter((s) => s.trace && s.trace.points > 0);

  const geometry = useMemo(() => {
    if (present.length === 0 || !(pot > 0)) return null;
    let xMin = Infinity;
    let xMax = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    // Both axes are logarithmic. Time has to be: the vectorized core reaches
    // a river target in a few hundredths of a second where the sampled core
    // takes seconds, and on a linear axis the faster curve is a dot on the
    // left edge. A zero on either axis has no place on a log scale, so those
    // points (only ever the first checkpoint's time) are dropped.
    const pts = present.map((s) => {
      const t = s.trace!;
      const xs = t[axis];
      const out: { x: number; y: number; iteration: number }[] = [];
      for (let i = 0; i < t.exploitable_chips.length; i++) {
        const y = (100 * t.exploitable_chips[i]) / pot;
        const x = xs[i];
        if (!(y > 0) || !(x > 0)) continue;
        out.push({ x, y, iteration: t.iteration[i] });
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      return out;
    });
    if (targetPct != null && targetPct > 0) {
      yMin = Math.min(yMin, targetPct);
      yMax = Math.max(yMax, targetPct);
    }
    if (!(xMax > 0) || !(xMin > 0) || !(yMin > 0) || !(yMax >= yMin)) return null;
    // A little headroom each side keeps the target line and the end points
    // off the frame.
    const lo = Math.log10(yMin) - 0.15;
    const hi = Math.log10(yMax) + 0.15;
    const xlo = Math.log10(xMin) - 0.05;
    const xhi = Math.log10(xMax) + 0.05;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + ((Math.log10(x) - xlo) / (xhi - xlo)) * plotW;
    const sy = (y: number) => PAD.top + plotH - ((Math.log10(y) - lo) / (hi - lo)) * plotH;
    // Decade gridlines within each range; the ends when a range is narrower
    // than a decade.
    const decades = (a: number, b: number, fallback: number[]): number[] => {
      const out: number[] = [];
      for (let d = Math.ceil(a); d <= Math.floor(b); d++) out.push(10 ** d);
      return out.length >= 2 ? out : fallback;
    };
    const yTicks = decades(lo, hi, [yMin, yMax]);
    const xTicks = decades(xlo, xhi, [xMin, xMax]);
    return { pts, sx, sy, xMax, yTicks, xTicks };
  }, [present, axis, pot, targetPct]);

  if (present.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-[11px] text-slate-500">
        No convergence trace in these payloads - they were solved by an engine from
        before it recorded one. Re-run the spot to get the curve.
      </div>
    );
  }

  const targetChips = targetPct != null && targetPct > 0 ? (targetPct / 100) * pot : 0;

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Convergence
        </h3>
        <div className="flex items-center gap-3 text-[11px]">
          {/* Legend: identity is never colour alone - the name sits beside
              the swatch, and the table below repeats it. */}
          {present.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-slate-300">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: s.color }}
              />
              {s.name}
            </span>
          ))}
          <div className="flex overflow-hidden rounded-md border border-slate-700">
            {(
              [
                ["solve_s", "solver time"],
                ["elapsed_s", "wall clock"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAxis(key)}
                title={
                  key === "solve_s"
                    ? "Seconds inside the iteration loop only - the check cadence is a harness choice, so this is the like-for-like axis"
                    : "Seconds including every exploitability measurement"
                }
                className={`px-2 py-0.5 transition-colors ${
                  axis === key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {geometry && (
        <div className="mt-2 overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full max-w-[40rem]"
            role="img"
            aria-label="Exploitable percent of pot against seconds, one line per core, log scale"
          >
            {/* Recessive grid and axes. */}
            {geometry.yTicks.map((y) => (
              <g key={`y${y}`}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={geometry.sy(y)}
                  y2={geometry.sy(y)}
                  stroke="#1e293b"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={geometry.sy(y) + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="#64748b"
                >
                  {fmtPct(y)}%
                </text>
              </g>
            ))}
            {geometry.xTicks.map((x) => (
              <g key={`x${x}`}>
                <line
                  x1={geometry.sx(x)}
                  x2={geometry.sx(x)}
                  y1={PAD.top}
                  y2={H - PAD.bottom}
                  stroke="#1e293b"
                  strokeWidth={1}
                />
                <text
                  x={geometry.sx(x)}
                  y={H - PAD.bottom + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                >
                  {x < 1 ? `${x.toFixed(x < 0.1 ? 2 : 1)}s` : secs(x)}
                </text>
              </g>
            ))}
            <text
              x={W - PAD.right}
              y={H - 4}
              textAnchor="end"
              fontSize={9}
              fill="#64748b"
            >
              {axis === "solve_s" ? "solver seconds" : "wall seconds"} (log) · exploitable, %
              of pot (log)
            </text>
            {/* The shared target: the line both cores are racing to. */}
            {targetPct != null && targetPct > 0 && (
              <g>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={geometry.sy(targetPct)}
                  y2={geometry.sy(targetPct)}
                  stroke="#94a3b8"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                <text
                  x={W - PAD.right - 2}
                  y={geometry.sy(targetPct) - 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="#94a3b8"
                >
                  target {fmtPct(targetPct)}%
                </text>
              </g>
            )}
            {present.map((s, i) => {
              const pts = geometry.pts[i];
              if (pts.length === 0) return null;
              const d = pts
                .map((p, k) => `${k === 0 ? "M" : "L"}${geometry.sx(p.x).toFixed(1)},${geometry.sy(p.y).toFixed(1)}`)
                .join(" ");
              // Dots only where they stay legible; a 2000-point trace is a line.
              const dots = pts.length <= 60 ? pts : [];
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                  {dots.map((p) => (
                    <circle
                      key={p.iteration}
                      cx={geometry.sx(p.x)}
                      cy={geometry.sy(p.y)}
                      r={2.5}
                      fill={s.color}
                      stroke="#0f172a"
                      strokeWidth={1}
                    >
                      <title>
                        {`${s.name}: iteration ${p.iteration}, ${secs(p.x)}, ${fmtPct(p.y)}% of pot`}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* The headline as a table: when each core crossed the target, or why
          it did not. A ratio is only ever quoted between two crossings. */}
      <table className="mt-2 w-full text-[11px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-medium">core</th>
            <th className="font-medium">to target</th>
            <th className="font-medium">iterations</th>
            <th className="font-medium">solver time</th>
            <th className="font-medium">wall</th>
            <th className="font-medium">final</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-slate-300">
          {present.map((s) => {
            const t = s.trace!;
            const last = t.exploitable_chips.length - 1;
            const crossed = targetCrossing(t, targetChips);
            const finalPct = last >= 0 ? (100 * t.exploitable_chips[last]) / pot : null;
            const why =
              s.stoppedReason === "time_budget"
                ? "not reached · time budget"
                : s.stoppedReason === "cancelled"
                  ? "not reached · stopped"
                  : targetChips > 0
                    ? "not reached · iteration cap"
                    : "no target";
            return (
              <tr key={s.key}>
                <td className={`py-0.5 font-medium ${s.textClass}`}>{s.name}</td>
                <td>{crossed ? "reached" : why}</td>
                <td>{crossed ? crossed.iteration : t.iteration[last]}</td>
                <td>{crossed ? secs(crossed.solve_s) : secs(t.solve_s[last])}</td>
                <td>{crossed ? secs(crossed.elapsed_s) : secs(t.elapsed_s[last])}</td>
                <td>{finalPct == null ? "-" : `${fmtPct(finalPct)}% of pot`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        Same tree, same target. Solver time excludes the exploitability checks (each is a
        full best-response pass, and how often they run is a setting, not a property of
        the core); wall clock includes them. A sampled iteration walks one dealt runout
        where a vectorized one enumerates every runout, so iteration counts are not
        comparable between the two - only time is.
      </p>
    </div>
  );
};

export default ConvergencePanel;
