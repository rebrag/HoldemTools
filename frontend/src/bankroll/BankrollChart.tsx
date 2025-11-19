// src/bankroll/BankrollChart.tsx
import React, { useEffect, useRef } from "react";
import type { CumulativePoint } from "./types";

interface BankrollChartProps {
  points: CumulativePoint[];
  hoverIndex: number | null;
  onHoverIndexChange: (idx: number | null) => void;
}

const BankrollChart: React.FC<BankrollChartProps> = ({
  points,
  hoverIndex,
  onHoverIndexChange,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const crosshairRef = useRef<SVGLineElement | null>(null);
  const svgRectRef = useRef<DOMRect | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef<number | null>(null);

  if (points.length <= 1) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-emerald-200/90">
        Add a session above to see your profit curve come to life.
      </div>
    );
  }

  const width = 800;
  const height = 300;
  const paddingLeft = 44;
  const paddingRight = 20;
  const paddingTop = 24;
  const paddingBottom = 32;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const niceNum = (range: number, round: boolean): number => {
    if (range <= 0) return 1;
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
  };

  const makeNiceY = (
    min: number,
    max: number,
    maxTicks = 6
  ): { min: number; max: number; ticks: number[]; step: number } => {
    if (min === max) {
      if (max === 0) max = 1;
      else min = 0;
    }
    const range = niceNum(max - min, false);
    const step = niceNum(range / (maxTicks - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;

    const ticks: number[] = [];
    for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
      ticks.push(v);
    }
    return { min: niceMin, max: niceMax, ticks, step };
  };

  // X axis domain: 0 -> total hours
  const rawMaxX = Math.max(...xs, 1);
  const minX = 0;
  const maxX = rawMaxX;
  const xSpan = maxX - minX || 1;

  const maxXTicks = 6;
  const xStep = niceNum(rawMaxX / (maxXTicks - 1), true);
  const xTicks: number[] = [];
  for (let v = 0; v <= rawMaxX + xStep * 0.25; v += xStep) {
    xTicks.push(v);
  }

  // Y axis domain: include 0, then “nice” it
  const rawMinY = Math.min(...ys, 0);
  const rawMaxY = Math.max(...ys, 0);
  const yAxis = makeNiceY(rawMinY, rawMaxY, 6);
  const minY = yAxis.min;
  const maxY = yAxis.max;
  const yTicks = yAxis.ticks;
  const ySpan = maxY - minY || 1;
  const yStep = yAxis.step;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const toCoords = (p: { x: number; y: number }) => {
    const nx = (p.x - minX) / xSpan;
    const ny = (p.y - minY) / ySpan;
    const x = paddingLeft + nx * plotWidth;
    const y = height - paddingBottom - ny * plotHeight;
    return { x, y };
  };

  const coords = points.map(toCoords);

  const pathD = coords
    .map((c, idx) => (idx === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`))
    .join(" ");

  const formatTick = (val: number, step: number) => {
    const absStep = Math.abs(step);
    const decimals = absStep >= 1 ? 0 : absStep >= 0.1 ? 1 : 2;
    return val.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  // pointer handling + rAF
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || points.length <= 1) return;

    const updateFromClientX = (clientX: number) => {
      let rect = svgRectRef.current;
      if (!rect) {
        rect = svg.getBoundingClientRect();
        svgRectRef.current = rect;
      }

      const relativeX = ((clientX - rect.left) / rect.width) * width;
      const plotStart = paddingLeft;
      const plotEnd = paddingLeft + plotWidth;
      const clamped = Math.max(plotStart, Math.min(plotEnd, relativeX));

      const t = (clamped - plotStart) / plotWidth;
      const domainX = minX + t * xSpan;

      // find nearest session index
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.abs(points[i].x - domainX);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }

      const coord = coords[nearestIdx];

      if (crosshairRef.current) {
        const line = crosshairRef.current;
        line.setAttribute("x1", String(coord.x));
        line.setAttribute("x2", String(coord.x));
        line.style.opacity = "1";
      }

      onHoverIndexChange(nearestIdx);
    };

    const scheduleUpdate = (clientX: number) => {
      lastClientXRef.current = clientX;
      if (rafIdRef.current != null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (lastClientXRef.current == null) return;
        updateFromClientX(lastClientXRef.current);
      });
    };

    const handlePointerMove = (ev: PointerEvent) => {
      scheduleUpdate(ev.clientX);
    };

    const handlePointerDown = (ev: PointerEvent) => {
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      scheduleUpdate(ev.clientX);
    };

    const clearHover = () => {
      onHoverIndexChange(null);
      svgRectRef.current = null;
      if (crosshairRef.current) {
        crosshairRef.current.style.opacity = "0";
      }
    };

    const handlePointerUp = (ev: PointerEvent) => {
      if (svg.hasPointerCapture(ev.pointerId)) {
        svg.releasePointerCapture(ev.pointerId);
      }
      clearHover();
    };

    const handlePointerLeave = () => {
      clearHover();
    };

    svg.addEventListener("pointerdown", handlePointerDown);
    svg.addEventListener("pointermove", handlePointerMove);
    svg.addEventListener("pointerup", handlePointerUp);
    svg.addEventListener("pointercancel", handlePointerUp);
    svg.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      svg.removeEventListener("pointerdown", handlePointerDown);
      svg.removeEventListener("pointermove", handlePointerMove);
      svg.removeEventListener("pointerup", handlePointerUp);
      svg.removeEventListener("pointercancel", handlePointerUp);
      svg.removeEventListener("pointerleave", handlePointerLeave);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, coords, minX, xSpan, plotWidth, paddingLeft]);

  const hasHover =
    hoverIndex != null &&
    hoverIndex >= 0 &&
    hoverIndex < coords.length &&
    points.length > 1;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full bg-transparent touch-none select-none"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* horizontal gridlines */}
      {yTicks.map((tick) => {
        const { y } = toCoords({ x: minX, y: tick });
        const isZero = Math.abs(tick) < yStep * 0.001;
        return (
          <g key={`y-${tick}`}>
            <line
              x1={paddingLeft}
              x2={paddingLeft + plotWidth}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={isZero ? 1.4 : 0.6}
              className={isZero ? "text-emerald-500/90" : "text-emerald-200/60"}
              strokeDasharray={isZero ? undefined : "3,4"}
            />
            <text
              x={paddingLeft - 6}
              y={y + 3}
              textAnchor="end"
              className="text-[9px] fill-gray-300"
            >
              {formatTick(tick, yStep)}
            </text>
          </g>
        );
      })}

      {/* vertical gridlines + x-axis ticks */}
      {xTicks.map((tick) => {
        const { x } = toCoords({ x: tick, y: minY });
        return (
          <g key={`x-${tick}`}>
            <line
              x1={x}
              x2={x}
              y1={paddingTop}
              y2={height - paddingBottom}
              stroke="currentColor"
              strokeWidth={0.6}
              className="text-emerald-200/60"
              strokeDasharray="3,4"
            />
            <line
              x1={x}
              x2={x}
              y1={height - paddingBottom}
              y2={height - paddingBottom + 4}
              stroke="currentColor"
              className="text-gray-300"
              strokeWidth={0.75}
            />
            <text
              x={x}
              y={height - paddingBottom + 16}
              textAnchor="middle"
              className="text-[9px] fill-gray-400"
            >
              {formatTick(tick, xStep)}
            </text>
          </g>
        );
      })}

      {/* axis labels */}
      <text
        x={paddingLeft - 10}
        y={height / 2 - 17}
        transform={`rotate(-90 ${paddingLeft - 10} ${height / 2})`}
        textAnchor="middle"
        className="text-[15px] fill-gray-400"
      >
        Profit ($)
      </text>

      <text
        x={paddingLeft + plotWidth / 2}
        y={height - 4}
        textAnchor="middle"
        className="text-[10px] fill-gray-400"
      >
        Hours played
      </text>

      {/* crosshair */}
      <line
        ref={crosshairRef}
        x1={paddingLeft}
        x2={paddingLeft}
        y1={paddingTop}
        y2={height - paddingBottom}
        stroke="currentColor"
        strokeWidth={1}
        className="text-emerald-300/80 pointer-events-none"
        strokeDasharray="4,3"
        style={{ opacity: 0 }}
      />

      {/* profit line */}
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        className="text-emerald-400"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* points */}
      {coords.map((c, idx) => {
        const p = points[idx];
        const isLast = idx === coords.length - 1;
        const isHovered = hasHover && hoverIndex === idx;
        const radius = isHovered ? 5 : isLast ? 4 : 3;

        return (
          <circle
            key={p.session?.id ?? idx}
            cx={c.x}
            cy={c.y}
            r={radius}
            fill={isHovered ? "#22c55e" : isLast ? "#10b981" : "#34d399"}
          />
        );
      })}
    </svg>
  );
};

export default BankrollChart;
