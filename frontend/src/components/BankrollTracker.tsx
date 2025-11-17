// src/components/BankrollTracker.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import LoadingIndicator from "./LoadingIndicator";
import AutoFitText from "./AutoFitText";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

const formatMoney = (val: number | null | undefined): string => {
  if (val == null) return "—";

  const rounded = Math.round(val * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toLocaleString();
  }

  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatHours = (val: number | null | undefined): string => {
  if (val == null) return "—";

  const rounded = Math.round(val * 100) / 100;
  if (Number.isInteger(rounded)) {
    return rounded.toString();
  }
  return rounded.toFixed(1);
};

export interface BankrollSession {
  id: string;
  userId: string;
  type: string;
  start: string | null; // ISO
  end: string | null;
  hours: number | null;
  location: string | null;
  game: string | null;
  blinds: string | null;
  buyIn: number | null;
  cashOut: number | null;
  profit: number;
}

interface BankrollTrackerProps {
  user: User | null;
}

interface FormState {
  type: string;
  start: string; // datetime-local
  end: string;
  location: string;
  blinds: string;
  buyIn: string;
  cashOut: string;
  profit: string;
}

const defaultForm: FormState = {
  type: "Cash",
  start: "",
  end: "",
  location: "",
  blinds: "1/2 NLH",
  buyIn: "",
  cashOut: "",
  profit: "",
};

const toLocalInputValue = (iso: string | null): string => {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

/* ───────────────── AnimatedNumber helper ───────────────── */

type AnimatedNumberProps = {
  value: number;
  format?: (value: number) => string;
  className?: string;
  animate?: boolean;
  durationMs?: number;
};

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format = (v) => v.toString(),
  className,
  animate = true,
  durationMs = 450,
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!animate || durationMs <= 0) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      previousValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const start = previousValueRef.current;
    const end = value;

    if (start === end) return;

    const duration = durationMs;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      const next = start + (end - start) * eased;
      setDisplayValue(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    previousValueRef.current = end;

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [value, animate, durationMs]);

  return <span className={className}>{format(displayValue)}</span>;
};

/* ───────────────── Chart component ───────────────── */

type CumulativePoint = {
  x: number;
  y: number;
  session: BankrollSession | null;
};

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

  // native pointer handling + rAF for max snappiness
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

      // move the crosshair line imperatively
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
      className="w-full bg-transparent touch-none"
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
        y={height / 2}
        transform={`rotate(-90 ${paddingLeft - 10} ${height / 2})`}
        textAnchor="middle"
        className="text-[10px] fill-gray-400"
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

      {/* crosshair vertical line (imperative updates) */}
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

/* ───────────────── main tracker ───────────────── */

const BankrollTracker: React.FC<BankrollTrackerProps> = ({ user }) => {
  const [sessions, setSessions] = useState<BankrollSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // which cumulative point is hovered in the chart (0 = baseline)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // ───────────────── load sessions ─────────────────
  useEffect(() => {
    if (!user) return;

    const fetchSessions = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${API_BASE_URL}/api/bankroll?userId=${encodeURIComponent(user.uid)}`
        );
        if (!res.ok) {
          throw new Error(`Failed to load bankroll sessions (${res.status})`);
        }
        const data = (await res.json()) as BankrollSession[];
        data.sort((a, b) => {
          const aTime = a.start ? new Date(a.start).getTime() : 0;
          const bTime = b.start ? new Date(b.start).getTime() : 0;
          return aTime - bTime;
        });
        setSessions(data);
      } catch (e: unknown) {
        console.error(e);
        setError(
          e instanceof Error ? e.message : "Failed to load bankroll sessions"
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchSessions();
  }, [user]);

  const onChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // ───────────────── datetime helpers ─────────────────
  const setStartToNow = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const isoLocal = local.toISOString().slice(0, 16);
    setForm((prev) => ({ ...prev, start: isoLocal }));
  };

  const setEndToNow = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const isoLocal = local.toISOString().slice(0, 16);
    setForm((prev) => ({ ...prev, end: isoLocal }));
  };

  const parsedHours: number | null = useMemo(() => {
    if (!form.start || !form.end) return null;
    const start = new Date(form.start);
    const end = new Date(form.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return null;
    const hours = diffMs / (1000 * 60 * 60);
    return Math.round(hours * 100) / 100;
  }, [form.start, form.end]);

  // ───────────────── derived values ─────────────────
  const autoProfit = useMemo(() => {
    const buyRaw = form.buyIn.trim();
    const cashRaw = form.cashOut.trim();
    if (!buyRaw || !cashRaw) return null;
    const buyNum = Number(buyRaw);
    const cashNum = Number(cashRaw);
    if (!Number.isFinite(buyNum) || !Number.isFinite(cashNum)) return null;
    return cashNum - buyNum;
  }, [form.buyIn, form.cashOut]);

  const profitInputValue =
    form.profit !== ""
      ? form.profit
      : autoProfit !== null
      ? autoProfit.toString()
      : "";

  const stats = useMemo(() => {
    if (!sessions.length) {
      return { totalProfit: 0, totalHours: 0, numSessions: 0, hourly: 0 };
    }
    const totalProfit = sessions.reduce(
      (sum, s) => sum + (s.profit || 0),
      0
    );
    const totalHours = sessions.reduce((sum, s) => sum + (s.hours || 0), 0);
    const numSessions = sessions.length;
    const hourly = totalHours > 0 ? totalProfit / totalHours : 0;
    return { totalProfit, totalHours, numSessions, hourly };
  }, [sessions]);

  const cumulativePoints: CumulativePoint[] = useMemo(() => {
    if (!sessions.length) {
      return [{ x: 0, y: 0, session: null }];
    }
    const ordered = [...sessions].sort((a, b) => {
      const aTime = a.start ? new Date(a.start).getTime() : 0;
      const bTime = b.start ? new Date(b.start).getTime() : 0;
      return aTime - bTime;
    });

    const points: CumulativePoint[] = [{ x: 0, y: 0, session: null }];

    let cumHours = 0;
    let cumProfit = 0;
    for (const s of ordered) {
      cumHours += s.hours ?? 0;
      cumProfit += s.profit ?? 0;
      points.push({ x: cumHours, y: cumProfit, session: s });
    }
    return points;
  }, [sessions]);

  // ───────────────── hover-based stats ─────────────────
  const displayStats = useMemo(() => {
    if (
      hoverIndex == null ||
      hoverIndex <= 0 ||
      hoverIndex >= cumulativePoints.length
    ) {
      return stats;
    }

    const point = cumulativePoints[hoverIndex];
    const totalProfit = point.y;
    const totalHours = point.x;
    const numSessions = hoverIndex;
    const hourly = totalHours > 0 ? totalProfit / totalHours : 0;

    return { totalProfit, totalHours, numSessions, hourly };
  }, [hoverIndex, cumulativePoints, stats]);

  const isHoveringChart =
    hoverIndex != null &&
    hoverIndex > 0 &&
    hoverIndex < cumulativePoints.length;

  // ───────────────── modal helpers ─────────────────
  const openNewSessionModal = () => {
    setEditingId(null);
    setForm(defaultForm);
    setIsFormOpen(true);
  };

  // ───────────────── save (create/update) ─────────────────
  const handleSave = async () => {
    if (!user) {
      setError("You must be logged in to save bankroll sessions.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const startDate = form.start ? new Date(form.start) : null;
      const endDate = form.end ? new Date(form.end) : null;

      let buyIn = form.buyIn.trim() ? Number(form.buyIn) : NaN;
      let cashOut = form.cashOut.trim() ? Number(form.cashOut) : NaN;
      let profit = form.profit.trim() ? Number(form.profit) : NaN;

      if (!Number.isFinite(buyIn)) buyIn = NaN;
      if (!Number.isFinite(cashOut)) cashOut = NaN;
      if (!Number.isFinite(profit)) profit = NaN;

      if (
        Number.isNaN(profit) &&
        !Number.isNaN(buyIn) &&
        !Number.isNaN(cashOut)
      ) {
        profit = cashOut - buyIn;
      }

      if (Number.isNaN(profit)) {
        throw new Error("Please enter Profit or both Buy-in and Cash-out.");
      }

      const payload = {
        userId: user.uid,
        type: form.type || "Cash",
        start: startDate ? startDate.toISOString() : null,
        end: endDate ? endDate.toISOString() : null,
        hours: parsedHours,
        location: form.location || null,
        blinds: form.blinds || null,
        buyIn: Number.isNaN(buyIn) ? null : buyIn,
        cashOut: Number.isNaN(cashOut) ? null : cashOut,
        profit,
      };

      const isEdit = !!editingId;
      const url = isEdit
        ? `${API_BASE_URL}/api/bankroll/${encodeURIComponent(editingId)}`
        : `${API_BASE_URL}/api/bankroll`;

      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(
          `Failed to ${isEdit ? "update" : "save"} session (${res.status})`
        );
      }

      const saved = (await res.json()) as BankrollSession;

      setSessions((prev) => {
        let next: BankrollSession[];
        if (isEdit) {
          next = prev.map((s) => (s.id === saved.id ? saved : s));
        } else {
          next = [...prev, saved];
        }
        next.sort((a, b) => {
          const aTime = a.start ? new Date(a.start).getTime() : 0;
          const bTime = b.start ? new Date(b.start).getTime() : 0;
          return aTime - bTime;
        });
        return next;
      });

      setForm(defaultForm);
      setEditingId(null);
      setIsFormOpen(false);
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to save bankroll session"
      );
    } finally {
      setSaving(false);
    }
  };

  // ───────────────── edit / delete ─────────────────
  const startEdit = (session: BankrollSession) => {
    setEditingId(session.id);
    setForm({
      type: session.type || "Cash",
      start: toLocalInputValue(session.start),
      end: toLocalInputValue(session.end),
      location: session.location ?? "",
      blinds: session.blinds ?? "",
      buyIn: session.buyIn != null ? session.buyIn.toString() : "",
      cashOut: session.cashOut != null ? session.cashOut.toString() : "",
      profit: session.profit.toString(),
    });
    setIsFormOpen(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(defaultForm);
    setIsFormOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this session? This cannot be undone.")) {
      return;
    }
    try {
      setBusyDeleteId(id);
      setError(null);
      const res = await fetch(
        `${API_BASE_URL}/api/bankroll/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error(`Failed to delete session (${res.status})`);
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) {
        cancelEdit();
      }
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to delete session"
      );
    } finally {
      setBusyDeleteId(null);
    }
  };

  // ───────────────── table rows ─────────────────
  const renderTableRows = () => {
    if (!sessions.length) {
      return (
        <tr>
          <td
            colSpan={10}
            className="px-3 py-3 text-center text-sm text-gray-500"
          >
            No sessions yet. Add one above to get started.
          </td>
        </tr>
      );
    }

    const ordered = [...sessions].sort((a, b) => {
      const aTime = a.start ? new Date(a.start).getTime() : 0;
      const bTime = b.start ? new Date(b.start).getTime() : 0;
      return bTime - aTime;
    });

    return ordered.map((s) => {
      const startDate = s.start ? new Date(s.start) : null;
      const endDate = s.end ? new Date(s.end) : null;

      const dateStr = startDate ? startDate.toLocaleDateString() : "—";
      const startTime = startDate
        ? startDate.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })
        : "—";
      const endTime = endDate
        ? endDate.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })
        : "—";
      const weekday = startDate
        ? startDate.toLocaleDateString(undefined, { weekday: "short" })
        : "—";

      const profit = s.profit ?? 0;

      const hoursStr = formatHours(s.hours);
      const profitStr = formatMoney(s.profit);

      const buyInStr =
        s.buyIn != null
          ? Math.round(s.buyIn).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })
          : "—";
      const cashOutStr =
        s.cashOut != null
          ? Math.round(s.cashOut).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })
          : "—";

      const profitColor =
        profit > 0
          ? "text-emerald-600"
          : profit < 0
          ? "text-rose-600"
          : "text-slate-700";

      const isBusyDelete = busyDeleteId === s.id;
      const isEditing = editingId === s.id;

      return (
        <tr
          key={s.id}
          className="transition-colors hover:bg-emerald-50/60"
        >
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-800">
            <AutoFitText maxPx={12}>{dateStr}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            <AutoFitText maxPx={12}>{startTime}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            <AutoFitText maxPx={12}>{endTime}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            <AutoFitText maxPx={12}>{s.blinds ?? "—"}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            {hoursStr}
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            <AutoFitText maxPx={12}>
              {s.buyIn != null ? `$${buyInStr}` : "—"}
            </AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-700">
            <AutoFitText maxPx={12}>
              {s.cashOut != null ? `$${cashOutStr}` : "—"}
            </AutoFitText>
          </td>
          <td
            className={`px-2 py-1.5 text-[11px] sm:text-xs font-semibold ${profitColor}`}
          >
            <AutoFitText maxPx={12}>${profitStr}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-500">
            <AutoFitText maxPx={12}>{weekday}</AutoFitText>
          </td>
          <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-500">
            <div className="flex items-center gap-1 justify-end">
              <button
                type="button"
                onClick={() => startEdit(s)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/70 bg-white hover:bg-emerald-50 text-emerald-600 transition ${
                  isEditing ? "ring-2 ring-emerald-400/70" : ""
                }`}
                title="Edit session"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path
                    d="M3 13.5V17h3.5L15 8.5l-3.5-3.5L3 13.5zM17.2 6.3c.4-.4.4-1 0-1.4L15.1 2.8c-.4-.4-1-.4-1.4 0L12 4.5l3.5 3.5 1.7-1.7z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                type="button"
                disabled={isBusyDelete}
                onClick={() => handleDelete(s.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/70 bg-white hover:bg-rose-50 text-rose-600 disabled:opacity-60 transition"
                title="Delete session"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path
                    d="M7 2h6l.75 1H17v2h-1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5H3V3h3.25L7 2zm1 5v7h2V7H8zm4 0v7h2V7h-2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      );
    });
  };

  // ───────────────── main render ─────────────────
  if (!user) {
    return (
      <div className="max-w-5xl mx-auto px-4 pb-10 pt-6">
        <h1 className="text-2xl font-semibold text-white mb-2">
          Bankroll Tracker
        </h1>
        <p className="text-sm text-emerald-100/90 max-w-md">
          Please log in with your HoldemTools account to track your sessions and
          see your bankroll graph.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12 pt-6 space-y-6">
      {/* header + stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">
              Bankroll Tracker
            </h1>
            <p className="text-sm text-emerald-100/80 max-w-md">
              Log each session, watch your profit curve grow, and keep your
              grind on track.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewSessionModal}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold text-emerald-50 shadow-sm shadow-emerald-500/40 ring-1 ring-emerald-300/60 hover:bg-emerald-500 hover:text-white transition"
          >
            <span className="text-base leading-none">＋</span>
            Add Session
          </button>
        </div>

        <div className="w-full grid grid-cols-4 gap-3">
          {/* total profit */}
          <div className="rounded-xl bg-white/10 border border-emerald-400/40 px-3 py-2 backdrop-blur-sm shadow-sm shadow-emerald-500/20">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wide text-emerald-100/90">
                Total profit
              </div>
              {isHoveringChart && (
                <div className="text-[10px] text-emerald-100/80">
                  As of session {displayStats.numSessions} / {stats.numSessions}
                </div>
              )}
            </div>
            <div
              className={`text-lg font-semibold ${
                displayStats.totalProfit >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {displayStats.totalProfit >= 0 ? "+" : "-"}$
              <AnimatedNumber
                value={Math.abs(displayStats.totalProfit)}
                animate={true}
                durationMs={450}
                format={(v) =>
                  Math.abs(v).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2,
                  })
                }
              />
            </div>
          </div>

          {/* hours played */}
          <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
            <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
              <AutoFitText>Hours played</AutoFitText>
            </div>
            <div className="text-lg font-semibold text-emerald-50">
              <AnimatedNumber
                value={displayStats.totalHours}
                animate={true}
                durationMs={450}
                format={(v) => v.toFixed(2)}
              />
            </div>
          </div>

          {/* sessions */}
          <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
            <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
              Sessions
            </div>
            <div className="text-lg font-semibold text-emerald-50">
              <AnimatedNumber
                value={displayStats.numSessions}
                animate={!isHoveringChart}
                durationMs={450}
                format={(v) => Math.round(v).toString()}
              />
            </div>
          </div>

          {/* winrate */}
          <div className="rounded-xl bg-white/10 border border-emerald-400/30 px-3 py-2 backdrop-blur-sm">
            <div className="text-[11px] uppercase tracking-wide text-emerald-100/80">
              <AutoFitText>Winrate ($ / hr)</AutoFitText>
            </div>
            <div
              className={`text-lg font-semibold ${
                displayStats.hourly >= 0 ? "text-emerald-200" : "text-rose-200"
              }`}
            >
              {displayStats.hourly >= 0 ? "+" : "-"}$
              <AnimatedNumber
                value={Math.abs(displayStats.hourly)}
                animate={true}
                durationMs={450}
                format={(v) => Math.abs(v).toFixed(2)}
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-sm text-rose-100 shadow-sm shadow-rose-500/20">
          {error}
        </div>
      )}

      {/* form modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-3xl mx-4">
            <div className="relative rounded-2xl border border-emerald-300/40 bg-white/95 p-4 shadow-2xl shadow-emerald-500/30 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">
                  {editingId ? "Edit Session" : "Add Session"}
                </h2>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
                  aria-label="Close"
                >
                  <span className="text-sm">✕</span>
                </button>
              </div>

              {/* section 1 */}
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1 w-[130px]">
                  <label className="text-xs font-medium text-gray-700">
                    Type
                  </label>
                  <select
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.type}
                    onChange={(e) => onChange("type", e.target.value)}
                  >
                    <option>Cash</option>
                    <option>Tournament</option>
                    <option>Other</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-xs font-medium text-gray-700 flex items-center justify-between">
                    <span>Start</span>
                    <button
                      type="button"
                      onClick={setStartToNow}
                      className="text-[10px] text-emerald-600 hover:text-emerald-700 underline-offset-2 hover:underline"
                    >
                      Use now
                    </button>
                  </label>
                  <input
                    type="datetime-local"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.start}
                    onChange={(e) => onChange("start", e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-xs font-medium text-gray-700 flex items-center justify-between">
                    <span>End</span>
                    <button
                      type="button"
                      onClick={setEndToNow}
                      className="text-[10px] text-emerald-600 hover:text-emerald-700 underline-offset-2 hover:underline"
                    >
                      Use now
                    </button>
                  </label>
                  <input
                    type="datetime-local"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.end}
                    onChange={(e) => onChange("end", e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1 w-[90px]">
                  <label className="text-xs font-medium text-gray-700">
                    Hours
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={parsedHours !== null ? parsedHours.toFixed(2) : ""}
                    placeholder="auto"
                    className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-700"
                  />
                </div>
              </div>

              {/* section 2 */}
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex flex-col gap-1 w-[180px]">
                  <label className="text-xs font-medium text-gray-700">
                    Location
                  </label>
                  <input
                    type="text"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.location}
                    onChange={(e) => onChange("location", e.target.value)}
                    placeholder="Hard Rock Tampa"
                  />
                </div>

                <div className="flex flex-col gap-1 w-[140px]">
                  <label className="text-xs font-medium text-gray-700">
                    Game
                  </label>
                  <input
                    type="text"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.blinds}
                    onChange={(e) => onChange("blinds", e.target.value)}
                    placeholder="1/2, 2/5 PLO…"
                  />
                </div>

                <div className="flex flex-col gap-1 w-[110px]">
                  <label className="text-xs font-medium text-gray-700">
                    Buy-in
                  </label>
                  <input
                    type="number"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.buyIn}
                    onChange={(e) => onChange("buyIn", e.target.value)}
                    placeholder="200"
                  />
                </div>

                <div className="flex flex-col gap-1 w-[110px]">
                  <label className="text-xs font-medium text-gray-700">
                    Cash-out
                  </label>
                  <input
                    type="number"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={form.cashOut}
                    onChange={(e) => onChange("cashOut", e.target.value)}
                    placeholder="520"
                  />
                </div>

                <div className="flex flex-col gap-1 w-[110px]">
                  <label className="text-xs font-medium text-gray-700 flex items-center justify-between">
                    <span>Profit</span>
                    {autoProfit !== null && form.profit === "" && (
                      <span className="text-[10px] text-emerald-500">
                        auto: {autoProfit >= 0 ? "+" : "-"}$
                        {Math.abs(autoProfit).toFixed(2)}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
                    value={profitInputValue}
                    onChange={(e) => onChange("profit", e.target.value)}
                    placeholder="auto"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
                  >
                    Discard changes
                  </button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {saving && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                      <LoadingIndicator />
                      {editingId ? "Updating…" : "Saving…"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/40 transition-transform duration-150 hover:-translate-y-[1px] hover:bg-emerald-500 active:translate-y-[1px] disabled:opacity-60 disabled:shadow-none"
                  >
                    {editingId ? "Update Session" : "Save Session"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* chart */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-emerald-50">
            Profit over time
          </h2>
          <p className="text-xs text-emerald-100/80">
            Cumulative profit vs. hours played.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <LoadingIndicator />
          </div>
        ) : (
          <BankrollChart
            points={cumulativePoints}
            hoverIndex={hoverIndex}
            onHoverIndexChange={setHoverIndex}
          />
        )}
      </div>

      {/* table */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="border-b border-gray-200 px-3 py-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Session history
          </h2>
          <p className="text-xs text-gray-500">
            {stats.numSessions} session
            {stats.numSessions === 1 ? "" : "s"} logged
          </p>
        </div>
        <div className="overflow-hidden">
          <table className="w-full table-fixed divide-y divide-gray-200 text-left">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Date
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Start
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  End
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Blinds
                </th>
                <th className="px-1 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Hours
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Buy-in
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Cash-out
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Profit
                </th>
                <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Weekday
                </th>
                {/* <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                  Actions
                </th> */}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {renderTableRows()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BankrollTracker;
