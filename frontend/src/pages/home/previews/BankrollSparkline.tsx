import { JSX, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { NumberTicker } from "../shared/NumberTicker";

/**
 * The Bankroll tool's internals: a self-drawing cumulative-profit curve with a
 * gradient area fill, a pulsing endpoint, and count-up stats. The walk is
 * deterministic so the shape is stable across renders.
 */

const WIDTH = 320;
const HEIGHT = 132;
const PAD = 6;
const POINTS = 44;
const PROFIT = 4820;

// Deterministic upward random walk with drawdowns.
function buildWalk(): number[] {
  let seed = 20260701;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const vals: number[] = [];
  let v = 0;
  for (let i = 0; i < POINTS; i++) {
    const drift = 0.9;
    const swing = (rand() - 0.42) * 6;
    v = Math.max(-4, v + drift + swing);
    vals.push(v);
  }
  return vals;
}

function toPath(vals: number[]): { line: string; area: string } {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = (WIDTH - PAD * 2) / (vals.length - 1);
  const pts = vals.map((val, i) => {
    const x = PAD + i * stepX;
    const y = HEIGHT - PAD - ((val - min) / range) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${HEIGHT - PAD} L${PAD},${HEIGHT - PAD} Z`;
  return { line, area };
}

export function BankrollSparkline({ className }: { className?: string }): JSX.Element {
  const reduce = useReducedMotion();
  const { line, area, end } = useMemo(() => {
    const w = buildWalk();
    const { line, area } = toPath(w);
    const min = Math.min(...w);
    const max = Math.max(...w);
    const range = max - min || 1;
    const stepX = (WIDTH - PAD * 2) / (w.length - 1);
    const lastX = PAD + (w.length - 1) * stepX;
    const lastY = HEIGHT - PAD - ((w[w.length - 1] - min) / range) * (HEIGHT - PAD * 2);
    return { line, area, end: [lastX, lastY] as const };
  }, []);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/90">
            Cumulative profit
          </div>
          <div className="mt-0.5 text-2xl font-bold text-white">
            <NumberTicker value={PROFIT} prefix="+$" duration={1.6} />
          </div>
        </div>
        <div className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
          ▲ 12.4 bb/100
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Bankroll trending upward"
      >
        <defs>
          <linearGradient id="ht-bankroll-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(167,139,250,0.35)" />
            <stop offset="100%" stopColor="rgba(167,139,250,0)" />
          </linearGradient>
          <linearGradient id="ht-bankroll-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>

        {/* baseline gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={WIDTH - PAD}
            y1={HEIGHT * f}
            y2={HEIGHT * f}
            stroke="rgba(148,163,184,0.10)"
            strokeWidth={1}
          />
        ))}

        <motion.path
          d={area}
          fill="url(#ht-bankroll-fill)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: reduce ? 0 : 0.9 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="url(#ht-bankroll-line)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: reduce ? 0 : 1.5, ease: "easeInOut" }}
        />

        {/* pulsing endpoint */}
        <motion.circle
          cx={end[0]}
          cy={end[1]}
          r={3.5}
          fill="#34d399"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: reduce ? 0 : 1.5 }}
        />
        {!reduce && (
          <motion.circle
            cx={end[0]}
            cy={end[1]}
            r={3.5}
            fill="none"
            stroke="#34d399"
            strokeWidth={1.5}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, delay: 1.6 }}
            style={{ transformOrigin: `${end[0]}px ${end[1]}px` }}
          />
        )}
      </svg>

      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            { k: "Sessions", v: 128, dec: 0 },
            { k: "Win rate", v: 61, dec: 0, suffix: "%" },
            { k: "Hours", v: 342, dec: 0 },
          ] as { k: string; v: number; dec: number; suffix?: string }[]
        ).map((s) => (
          <div key={s.k} className="rounded-lg bg-white/[0.03] py-2 ring-1 ring-white/10">
            <div className="text-sm font-bold text-white">
              <NumberTicker value={s.v} decimals={s.dec} suffix={s.suffix ?? ""} />
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">{s.k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
