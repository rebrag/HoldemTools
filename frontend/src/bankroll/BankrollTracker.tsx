/* eslint-disable @typescript-eslint/no-explicit-any */
// src/bankroll/BankrollTracker.tsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import LoadingIndicator from "../components/LoadingIndicator";
import BankrollChart from "./BankrollChart";
import BankrollFormModal from "./BankrollFormModal";
import BankrollStatsGrid from "./BankrollStatsGrid";
import SessionTable from "./SessionTable";
import {
  buildCumulativePoints,
  toLocalInputValue,
  formatHours,
  formatMoney,
} from "./utils";
import type {
  BankrollSession,
  BankrollTrackerProps,
  BankrollStats,
  FormState,
  SessionDuration,
} from "./types";
import LoginSignupModal from "../components/LoginSignupModal";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
const DRAFT_KEY = "ht_bankroll_draft_v1";
const ADD_LOCATION_OPTION = "__ht_add_location__";
const ADD_GAME_OPTION = "__ht_add_game__";

type DraftSession = {
  id: string;
  form: FormState;
  createdAt: string;
};

type BreakdownMode = "sessions" | "weekday" | "month" | "year";



type FilterState = {
  location: string;
  game: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  minHours: string;
  maxHours: string;
};

const BankrollModalPortal: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
};

const defaultForm: FormState = {
  type: "Cash",
  start: "",
  end: "",
  location: "",
  blinds: "1/2 NLH",
  buyIn: "",
  cashOut: "",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type BreakdownRow = {
  label: string;
  totalProfit: number;
  totalHours: number;
  numSessions: number;
  hourly: number;
  sortValue: number;
};

function buildBreakdownRows(
  sessions: BankrollSession[],
  mode: "weekday" | "month" | "year"
): BreakdownRow[] {
  const groups: Record<string, BreakdownRow> = {};

  for (const s of sessions) {
    if (!s.start) continue;

    const startDate = new Date(s.start);
    if (Number.isNaN(startDate.getTime())) continue;

    const profit = s.profit ?? 0;
    const hours = s.hours ?? 0;

    let key: string;
    let label: string;
    let sortValue: number;

    if (mode === "weekday") {
      const day = startDate.getDay(); // 0 = Sun
      key = `wd-${day}`;
      label = WEEKDAY_LABELS[day];
      sortValue = day;
    } else if (mode === "month") {
      const year = startDate.getFullYear();
      const month = startDate.getMonth(); // 0-based
      key = `m-${year}-${month}`;
      label = `${MONTH_LABELS[month]} ${year}`;
      sortValue = year * 12 + month; // bigger = more recent
    } else {
      const year = startDate.getFullYear();
      key = `y-${year}`;
      label = `${year}`;
      sortValue = year; // bigger = more recent
    }

    const existing = groups[key];
    if (!existing) {
      groups[key] = {
        label,
        totalProfit: profit,
        totalHours: hours,
        numSessions: 1,
        hourly: 0,
        sortValue,
      };
    } else {
      existing.totalProfit += profit;
      existing.totalHours += hours;
      existing.numSessions += 1;
    }
  }

  const rows = Object.values(groups);

  for (const row of rows) {
    row.hourly =
      row.totalHours > 0 ? row.totalProfit / row.totalHours : 0;
  }

  rows.sort((a, b) => {
    if (mode === "weekday") {
      // Sun → Sat
      return a.sortValue - b.sortValue;
    }
    // Month / Year: newest first
    return b.sortValue - a.sortValue;
  });

  return rows;
}


const BreakdownTable: React.FC<{
  sessions: BankrollSession[];
  mode: "weekday" | "month" | "year";
}> = ({ sessions, mode }) => {
  if (!sessions.length) {
    return (
      <div className="px-3 py-3 text-center text-sm text-gray-500 bg-white">
        No sessions match the current filters.
      </div>
    );
  }

  const rows = buildBreakdownRows(sessions, mode);
  if (!rows.length) {
    return (
      <div className="px-3 py-3 text-center text-sm text-gray-500 bg-white">
        Not enough data to compute this breakdown.
      </div>
    );
  }

  const heading =
    mode === "weekday"
      ? "Weekday"
      : mode === "month"
      ? "Month"
      : "Year";

  return (
    <table className="w-full table-fixed divide-y divide-gray-200 text-left">
      <colgroup>
        <col className="w-[26%]" /> {/* Period */}
        <col className="w-[14%]" /> {/* Sessions */}
        <col className="w-[18%]" /> {/* Hours */}
        <col className="w-[21%]" /> {/* Net */}
        <col className="w-[21%]" /> {/* Hourly */}
      </colgroup>
      <thead className="bg-gray-50">
        <tr>
          <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-left">
            {heading}
          </th>
          <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
            Sessions
          </th>
          <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
            Hours
          </th>
          <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
            Net
          </th>
          <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
            Hourly
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white">
        {rows.map((row) => {
          const profitColor =
            row.totalProfit > 0
              ? "text-emerald-600"
              : row.totalProfit < 0
              ? "text-rose-600"
              : "text-slate-700";

          return (
            <tr
              key={row.label}
              className="transition-colors hover:bg-emerald-50/60"
            >
              <td className="px-2 py-1.5 text-[11px] sm:text-xs text-gray-800">
                {row.label}
              </td>
              <td className="px-2 py-1.5 text-[11px] sm:text-xs text-right text-gray-700">
                {row.numSessions}
              </td>
              <td className="px-2 py-1.5 text-[11px] sm:text-xs text-right text-gray-700">
                {formatHours(row.totalHours)}
              </td>
              <td
                className={`px-2 py-1.5 text-[11px] sm:text-xs text-right font-semibold ${profitColor}`}
              >
                ${formatMoney(row.totalProfit)}
              </td>
              <td className="px-2 py-1.5 text-[11px] sm:text-xs text-right text-gray-700">
                ${formatMoney(row.hourly)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const BankrollTracker: React.FC<BankrollTrackerProps> = ({ user }) => {
  const [sessions, setSessions] = useState<BankrollSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [mode, setMode] = useState<"draft" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [isModalExpanded, setIsModalExpanded] = useState(true);
  const [extraLocations, setExtraLocations] = useState<string[]>([]);
  const [extraGames, setExtraGames] = useState<string[]>([]);
  const [now, setNow] = useState<Date>(() => new Date());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    location: "",
    game: "",
    fromDate: "",
    toDate: "",
    minHours: "",
    maxHours: "",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("sessions");
  const [showLoginModal, setShowLoginModal] = useState(true);


  /* ───────────────── Restore drafts from localStorage ───────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as
        | { drafts?: DraftSession[] }
        | { form?: FormState }
        | null;

      if (parsed && Array.isArray((parsed as any).drafts)) {
        setDrafts((parsed as any).drafts);
      } else if (parsed && (parsed as any).form) {
        // legacy single-draft format: upgrade to new array format
        const legacyForm = (parsed as any).form as FormState;
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setDrafts([
          {
            id,
            form: legacyForm,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.error("Failed to restore bankroll drafts", err);
    }
  }, []);

  /* ───────────────── Persist drafts to localStorage ───────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const nonEmptyDrafts = drafts.filter(
        (d) => JSON.stringify(d.form) !== JSON.stringify(defaultForm)
      );

      if (!nonEmptyDrafts.length) {
        window.localStorage.removeItem(DRAFT_KEY);
      } else {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ drafts: nonEmptyDrafts })
        );
      }
    } catch (err) {
      console.error("Failed to persist bankroll drafts", err);
    }
  }, [drafts]);

  /* ───────────────── Live duration ticker (any running draft) ───────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasRunningDraft = drafts.some(
      (d) => d.form.start && !d.form.end
    );
    if (!hasRunningDraft) return;

    setNow(new Date());
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [drafts]);

  /* ───────────────── Lock body scroll while overlay is visible ───────────────── */

  const overlayVisible = mode !== null && isModalExpanded;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!overlayVisible) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [overlayVisible]);

  /* ───────────────── Load sessions from API ───────────────── */

  useEffect(() => {
    if (!user) return;

    const fetchSessions = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `${API_BASE_URL}/api/bankroll?userId=${encodeURIComponent(
            user.uid
          )}`
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
          e instanceof Error ? e.message : "We couldn't load your bankroll sessions yet. Please wait about 15 seconds and refresh the page (or tap Retry)."
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchSessions();
  }, [user]);

  /* ───────────────── Helpers ───────────────── */

  const updateForm = (updater: (prev: FormState) => FormState) => {
    setForm((prev) => {
      const next = updater(prev);

      if (mode === "draft" && activeDraftId) {
        setDrafts((prevDrafts) =>
          prevDrafts.map((d) =>
            d.id === activeDraftId ? { ...d, form: next } : d
          )
        );
      }

      return next;
    });
  };

  const onChange = (field: keyof FormState, value: string) => {
    setFormError(null);
    updateForm((prev) => ({ ...prev, [field]: value }));
  };


  const setStartToNow = () => {
    const nowDate = new Date();
    const local = new Date(
      nowDate.getTime() - nowDate.getTimezoneOffset() * 60000
    );
    const isoLocal = local.toISOString().slice(0, 16);
    updateForm((prev) => ({
      ...prev,
      start: isoLocal,
      end: "",
    }));
  };

  const setEndToNowAndSave = async () => {
    const nowDate = new Date();
    const local = new Date(
      nowDate.getTime() - nowDate.getTimezoneOffset() * 60000
    );
    const isoLocal = local.toISOString().slice(0, 16);

    // Build a candidate form with the end time, but DO NOT commit it to state yet.
    const candidateForm: FormState = {
      ...form,
      end: isoLocal,
    };

    const ok = await handleSave(candidateForm);

    if (!ok) {
      // Save failed (e.g., invalid buy-in/cash-out).
      // We intentionally DO NOT set form.end, so:
      // - isTimerRunning stays true
      // - button stays "End"
      // - duration keeps ticking as "in progress"
      return;
    }

    // On success, handleSave already did all the state reset / closing for us.
  };



    const getLastUsedLocation = () => {
    // sessions are sorted oldest → newest, so walk from the end
    for (let i = sessions.length - 1; i >= 0; i--) {
      const loc = sessions[i].location?.trim();
      if (loc) return loc;
    }
    return "";
  };

  const getLastUsedGame = () => {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const g = sessions[i].blinds?.trim();
      if (g) return g;
    }
    return "";
  };


  const createDraftId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const createNewDraft = (): DraftSession => {
    const lastLocation = getLastUsedLocation();
    const lastGame = getLastUsedGame();

    const draft: DraftSession = {
      id: createDraftId(),
      form: {
        ...defaultForm,
        // If we have a last used value, use it; otherwise fall back to whatever
        // defaultForm has (location: "", blinds: "1/2 NLH").
        location: lastLocation || defaultForm.location,
        blinds: lastGame || defaultForm.blinds,
      },
      createdAt: new Date().toISOString(),
    };

    setDrafts((prev) => [...prev, draft]);
    return draft;
  };


  const openNewSessionModal = () => {
    const draft = createNewDraft();
    setActiveDraftId(draft.id);
    setForm(draft.form);
    setEditingId(null);
    setMode("draft");
    setIsModalExpanded(true);
  };

  const openDraft = (draftId: string) => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    setActiveDraftId(draft.id);
    setForm(draft.form);
    setEditingId(null);
    setMode("draft");
    setIsModalExpanded(true);
  };

  // known locations / games
  const knownLocations = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.location && s.location.trim()) {
        set.add(s.location.trim());
      }
    }
    for (const loc of extraLocations) {
      if (loc && loc.trim()) {
        set.add(loc.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions, extraLocations]);

  const knownGames = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.blinds && s.blinds.trim()) {
        set.add(s.blinds.trim());
      }
    }
    for (const g of extraGames) {
      if (g && g.trim()) {
        set.add(g.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions, extraGames]);

  const computeAutoProfit = (f: FormState): number | null => {
    const buyRaw = (f.buyIn ?? "").toString().trim();
    const cashRaw = (f.cashOut ?? "").toString().trim();
    if (!buyRaw || !cashRaw) return null;
    const buyNum = Number(buyRaw);
    const cashNum = Number(cashRaw);
    if (!Number.isFinite(buyNum) || !Number.isFinite(cashNum)) return null;
    return cashNum - buyNum;
  };

  const computeSessionDuration = (f: FormState): SessionDuration | null => {
    if (!f.start) return null;
    const startDate = new Date(f.start);
    if (Number.isNaN(startDate.getTime())) return null;

    let endDate: Date | null = null;
    if (f.end) {
      const parsedEnd = new Date(f.end);
      if (!Number.isNaN(parsedEnd.getTime())) {
        endDate = parsedEnd;
      }
    } else {
      // treat as in-progress
      endDate = now;
    }

    if (!endDate) return null;
    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs <= 0) return null;

    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { hours, minutes };
  };

  const autoProfit = useMemo(() => computeAutoProfit(form), [form]);

  const sessionDuration = useMemo(
    () => computeSessionDuration(form),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, now]
  );

  /* ───────────────── Filtering (with safe parsing) ───────────────── */

  const filteredSessions = useMemo(() => {
    if (!sessions.length) return [];

    const parseDateBound = (dateStr: string, endOfDay: boolean): number | null => {
      if (!dateStr || dateStr.length < 10) return null; // ignore partial input
      const full = endOfDay
        ? `${dateStr}T23:59:59.999`
        : `${dateStr}T00:00:00`;
      const t = new Date(full).getTime();
      return Number.isNaN(t) ? null : t;
    };

    const parseHours = (val: string): number | null => {
      if (!val.trim()) return null;
      const n = Number(val);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const fromMs = parseDateBound(filters.fromDate, false);
    const toMs = parseDateBound(filters.toDate, true);

    let minHours = parseHours(filters.minHours);
    let maxHours = parseHours(filters.maxHours);

    // If both present and order is inverted, swap them
    if (minHours != null && maxHours != null && minHours > maxHours) {
      const tmp = minHours;
      minHours = maxHours;
      maxHours = tmp;
    }

    return sessions.filter((s) => {
      // Location filter
      if (filters.location && s.location?.trim() !== filters.location) {
        return false;
      }

      // Game filter
      if (filters.game && s.blinds?.trim() !== filters.game) {
        return false;
      }

      const start = s.start ? new Date(s.start) : null;
      const startMs =
        start && !Number.isNaN(start.getTime())
          ? start.getTime()
          : null;

      // Date range filter
      if (fromMs !== null) {
        if (startMs === null || startMs < fromMs) return false;
      }
      if (toMs !== null) {
        if (startMs === null || startMs > toMs) return false;
      }

      // Hours filter
      const hours = s.hours ?? 0;
      if (minHours !== null && hours < minHours) return false;
      if (maxHours !== null && hours > maxHours) return false;

      return true;
    });
  }, [sessions, filters]);

  const totalSessions = sessions.length;
  const filteredCount = filteredSessions.length;
  const isFiltering =
    !!filters.location ||
    !!filters.game ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.minHours ||
    !!filters.maxHours;

  // stats & chart based on filtered sessions
  const stats: BankrollStats = useMemo(() => {
    if (!filteredSessions.length) {
      return { totalProfit: 0, totalHours: 0, numSessions: 0, hourly: 0 };
    }
    const totalProfit = filteredSessions.reduce(
      (sum, s) => sum + (s.profit || 0),
      0
    );
    const totalHours = filteredSessions.reduce(
      (sum, s) => sum + (s.hours || 0),
      0
    );
    const numSessions = filteredSessions.length;
    const hourly = totalHours > 0 ? totalProfit / totalHours : 0;
    return { totalProfit, totalHours, numSessions, hourly };
  }, [filteredSessions]);

  const cumulativePoints = useMemo(
  () =>
    filteredSessions.length > 0
      ? buildCumulativePoints(filteredSessions)
      : [],
  [filteredSessions]
);


  const displayStats: BankrollStats = useMemo(() => {
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

  const hasStarted = !!form.start;
  const hasEnded = !!form.end;
  const isTimerRunning = hasStarted && !hasEnded;
  const canUseTimerControls = mode === "draft";

  /* ───────────────── Edit / Save / Delete ───────────────── */

  const handleSave = async (overrideForm?: FormState): Promise<boolean> => {
  if (!user) {
    setError("You must be logged in to save bankroll sessions.");
    return false;
  }

  const currentMode = mode;
  const currentEditingId = editingId;
  const currentActiveDraftId = activeDraftId;
  const currentForm = overrideForm ?? form;

  try {
    setSaving(true);
    setError(null);
    setFormError(null);

    const startDate = currentForm.start ? new Date(currentForm.start) : null;
    const endDate = currentForm.end ? new Date(currentForm.end) : null;

    const buyRaw = (currentForm.buyIn ?? "").toString().trim();
    const cashRaw = (currentForm.cashOut ?? "").toString().trim();

    const buyIn = buyRaw ? Number(buyRaw) : NaN;
    const cashOut = cashRaw ? Number(cashRaw) : NaN;

    if (!Number.isFinite(buyIn) || !Number.isFinite(cashOut)) {
      setFormError("Please enter valid Buy-in and Cash-out amounts.");
      return false; // don't close modal, don't toggle timer
    }

    const profit = cashOut - buyIn;

    let hours: number | null = null;
    if (startDate && endDate) {
      const diffMs = endDate.getTime() - startDate.getTime();
      if (diffMs > 0) {
        const h = diffMs / (1000 * 60 * 60);
        hours = Math.round(h * 100) / 100;
      }
    }

    const payload = {
      userId: user.uid,
      type: currentForm.type || "Cash",
      start: startDate ? startDate.toISOString() : null,
      end: endDate ? endDate.toISOString() : null,
      hours,
      location: currentForm.location || null,
      blinds: currentForm.blinds || null,
      buyIn,
      cashOut,
      profit,
    };

    const isEdit = currentMode === "edit" && !!currentEditingId;
    const url = isEdit
      ? `${API_BASE_URL}/api/bankroll/${encodeURIComponent(currentEditingId!)}`
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

    // if we just saved a draft, remove that draft
    if (!isEdit && currentMode === "draft" && currentActiveDraftId) {
      setDrafts((prev) => prev.filter((d) => d.id !== currentActiveDraftId));
    }

    // success: reset everything & close modal
    setForm(defaultForm);
    setEditingId(null);
    setActiveDraftId(null);
    setMode(null);
    setIsModalExpanded(true);

    return true;
  } catch (e: unknown) {
    console.error(e);
    setError(
      e instanceof Error ? e.message : "Failed to save bankroll session"
    );
    return false;
  } finally {
    setSaving(false);
  }
};



  const startEdit = (session: BankrollSession) => {
    setEditingId(session.id);
    setMode("edit");
    setActiveDraftId(null);
    setForm({
      type: session.type || "Cash",
      start: toLocalInputValue(session.start),
      end: toLocalInputValue(session.end),
      location: session.location ?? "",
      blinds: session.blinds ?? "",
      buyIn: session.buyIn != null ? session.buyIn.toString() : "",
      cashOut: session.cashOut != null ? session.cashOut.toString() : "",
    });
    setIsModalExpanded(true);
  };

  const cancelModal = () => {
    if (mode === "draft" && activeDraftId) {
      // discard this draft
      setDrafts((prev) => prev.filter((d) => d.id !== activeDraftId));
    }
    setEditingId(null);
    setActiveDraftId(null);
    setMode(null);
    setForm(defaultForm);
    setIsModalExpanded(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this session? This cannot be undone.")) {
      return;
    }
    try {
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
        cancelModal();
      }
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to delete session"
      );
    }
  };

  const handleLocationSelectChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = e.target.value;
    if (value === ADD_LOCATION_OPTION) {
      const name = window.prompt("Add a new location name:");
      if (!name) {
        e.target.value = form.location || "";
        return;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        e.target.value = form.location || "";
        return;
      }
      setExtraLocations((prev) =>
        prev.includes(trimmed) ? prev : [...prev, trimmed]
      );
      updateForm((prev) => ({ ...prev, location: trimmed }));
      return;
    }

    onChange("location", value);
  };

  const handleGameSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === ADD_GAME_OPTION) {
      const name = window.prompt("Add a new game name:");
      if (!name) {
        e.target.value = form.blinds || "";
        return;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        e.target.value = form.blinds || "";
        return;
      }
      setExtraGames((prev) =>
        prev.includes(trimmed) ? prev : [...prev, trimmed]
      );
      updateForm((prev) => ({ ...prev, blinds: trimmed }));
      return;
    }

    onChange("blinds", value);
  };

  const handleMinimize = () => {
    if (mode === "draft") {
      setIsModalExpanded(false);
    } else {
      // for editing, just close
      setMode(null);
      setEditingId(null);
      setForm(defaultForm);
    }
  };

  const draftsWithStart = drafts.filter((d) => d.form.start);

  const resetFilters = () => {
    setFilters({
      location: "",
      game: "",
      fromDate: "",
      toDate: "",
      minHours: "",
      maxHours: "",
    });
  };

  const setThisYear = () => {
    const nowDate = new Date();
    const year = nowDate.getFullYear();
    const month = String(nowDate.getMonth() + 1).padStart(2, "0");
    const day = String(nowDate.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    const startOfYear = `${year}-01-01`;

    setFilters((prev) => ({
      ...prev,
      fromDate: startOfYear,
      toDate: today,
    }));
  };

  /* ───────────────── Render ───────────────── */

  if (!user) {
  // If the user dismissed the modal, show a simple message instead.
  if (!showLoginModal) {
    return (
      <div className="max-w-5xl mx-auto px-4 pb-10 pt-6">
        <h1 className="text-2xl font-semibold text-white mb-2">
          Bankroll Tracker
        </h1>
        <p className="text-sm text-emerald-100/90 max-w-md">
          You need to log in with your HoldemTools account to track your
          sessions and see your bankroll graph.
        </p>
      </div>
    );
  }

  return (
    <LoginSignupModal
      onClose={() => {
        setShowLoginModal(false);
      }}
    />
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

        <BankrollStatsGrid
          stats={stats}
          displayStats={displayStats}
          isHoveringChart={isHoveringChart}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-sm text-rose-100 shadow-sm shadow-rose-500/20">
          {error}
        </div>
      )}

      {/* overlay modal (for drafts or edits) */}
      {overlayVisible && (
        <BankrollModalPortal>
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-3xl px-4 py-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
              <BankrollFormModal
                form={form}
                knownLocations={knownLocations}
                knownGames={knownGames}
                autoProfit={autoProfit}
                sessionDuration={sessionDuration}
                canUseTimerControls={canUseTimerControls}
                isTimerRunning={isTimerRunning}
                saving={saving}
                editingId={editingId}
                onChange={onChange}
                onLocationChange={handleLocationSelectChange}
                onGameChange={handleGameSelectChange}
                onStartNow={setStartToNow}
                onEndNow={setEndToNowAndSave}       // ✅ uses new async version
                onSave={() => void handleSave()}    // ✅ actually calls handleSave
                onCancel={cancelModal}
                onMinimize={handleMinimize}
                errorMessage={formError}
              />

            </div>
          </div>
        </BankrollModalPortal>
      )}

      {/* minimized chips for all in-progress drafts */}
      {draftsWithStart.length > 0 && (
        <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2">
          {draftsWithStart.map((draft) => {
            const dDuration = computeSessionDuration(draft.form);
            const dNet = computeAutoProfit(draft.form);
            return (
              <button
                key={draft.id}
                type="button"
                onClick={() => openDraft(draft.id)}
                className="rounded-full bg-emerald-600/95 px-4 py-2 shadow-lg shadow-emerald-500/40 ring-1 ring-emerald-300 text-left text-xs text-white flex items-center gap-2"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">
                  BR
                </span>
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold">
                    Session in progress
                  </span>
                  <span className="text-[10px] text-emerald-100">
                    {dDuration
                      ? `Duration ${dDuration.hours}:${String(
                          dDuration.minutes
                        ).padStart(2, "0")}`
                      : "Tap to reopen"}
                    {dNet !== null && (
                      <>
                        {" · Net "}
                        <span
                          className={
                            dNet >= 0 ? "text-emerald-200" : "text-rose-200"
                          }
                        >
                          {dNet >= 0 ? "+" : "-"}$
                          {Math.abs(dNet).toFixed(0)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
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
    ) : cumulativePoints.length === 0 ? (
        <div className="flex items-center justify-center py-6 rounded-2xl border border-emerald-300/30 bg-emerald-900/40 text-xs text-emerald-100/80">
        No sessions match the current filters.
        </div>
    ) : (
        <BankrollChart
        points={cumulativePoints}
        hoverIndex={hoverIndex}
        onHoverIndexChange={setHoverIndex}
        />
    )}
    </div>


      {/* table + filters + breakdown */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="border-b border-gray-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Session history + count, same line */}
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Session history
            </h2>
            <span className="text-xs text-gray-500">
              {isFiltering
                ? `${filteredCount} of ${totalSessions} sessions shown`
                : `${totalSessions} session${
                    totalSessions === 1 ? "" : "s"
                  } logged`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="inline-flex items-center rounded-full bg-gray-100 p-[2px] text-[11px]">
              {(["sessions", "weekday", "month", "year"] as BreakdownMode[]).map(
                (modeKey) => {
                  const label =
                    modeKey === "sessions"
                      ? "Sessions"
                      : modeKey === "weekday"
                      ? "Weekday"
                      : modeKey === "month"
                      ? "Month"
                      : "Year";
                  const active = breakdownMode === modeKey;
                  return (
                    <button
                      key={modeKey}
                      type="button"
                      onClick={() => setBreakdownMode(modeKey)}
                      className={`px-2.5 py-1 rounded-full transition text-[11px] ${
                        active
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-gray-600 hover:text-gray-800"
                      }`}
                    >
                      {label}
                    </button>
                  );
                }
              )}
            </div>

            {/* Filter button */}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 transition"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  d="M3 4h14v2l-5 5v4l-4 2v-6L3 6V4z"
                  fill="currentColor"
                />
              </svg>
              <span>Filter</span>
              {isFiltering && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
          </div>
        </div>

        {/* filter panel */}
        {showFilters && (
          <div className="border-b border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs space-y-2">
            <div className="grid gap-2 sm:grid-cols-5">
              {/* Location */}
              <div className="flex flex-col gap-1">
                <span className="font-medium text-gray-700">Location</span>
                <select
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={filters.location}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                >
                  <option value="">All locations</option>
                  {knownLocations.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              {/* Game */}
              <div className="flex flex-col gap-1">
                <span className="font-medium text-gray-700">Game</span>
                <select
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={filters.game}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      game: e.target.value,
                    }))
                  }
                >
                  <option value="">All games</option>
                  {knownGames.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              {/* From date */}
              <div className="flex flex-col gap-1">
                <span className="font-medium text-gray-700">From date</span>
                <input
                  type="date"
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={filters.fromDate}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      fromDate: e.target.value,
                    }))
                  }
                />
              </div>

              {/* To date */}
              <div className="flex flex-col gap-1">
                <span className="font-medium text-gray-700">To date</span>
                <input
                  type="date"
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  value={filters.toDate}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      toDate: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Quick range: This year */}
              <div className="flex flex-col gap-1 justify-end">
                <span className="font-medium text-gray-700">Quick range</span>
                <button
                  type="button"
                  onClick={setThisYear}
                  className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition"
                >
                  This year
                </button>
              </div>
            </div>

            {/* Session length row */}
            <div className="flex flex-col gap-1">
              <span className="font-medium text-gray-700">
                Session length (hrs)
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  className="w-24 rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Min"
                  value={filters.minHours}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      minHours: e.target.value,
                    }))
                  }
                />
                <span className="text-gray-500">–</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  className="w-24 rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Max"
                  value={filters.maxHours}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      maxHours: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-600">
                Showing{" "}
                <span className="font-semibold">
                  {filteredCount} / {totalSessions}
                </span>{" "}
                sessions.
              </p>
              <div className="flex items-center gap-2">
                {isFiltering && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-[11px] text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowFilters(false)}
                  className="text-[11px] text-gray-600 hover:text-gray-800"
                >
                  Hide
                </button>
              </div>
            </div>
          </div>
        )}

                <div className="overflow-hidden">
          {breakdownMode === "sessions" ? (
            <table className="w-full table-fixed divide-y divide-gray-200 text-left">
              <colgroup>
                <col className="w-[12%]" /> {/* Date */}
                <col className="w-[18%]" /> {/* Location */}
                <col className="w-[14%]" /> {/* Blinds */}
                <col className="w-[8%]" /> {/* Hours */}
                <col className="w-[12%]" /> {/* Buy-in */}
                <col className="w-[12%]" /> {/* Cash-out */}
                <col className="w-[14%]" /> {/* Profit */}
                <col className="w-[10%]" /> {/* Actions */}
              </colgroup>
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    Date
                  </th>
                  <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    Location
                  </th>
                  <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    Blinds
                  </th>
                  <th className="px-1 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    Hours
                  </th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-gray-700 text-center">
                    Buyin
                  </th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-gray-700 text-center">
                    Cashout
                  </th>
                  <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    Profit
                  </th>
                  <th className="px-2 py-2 text-[11px] font-semibold text-gray-700 text-center">
                    {/* Actions */}
                  </th>
                </tr>
              </thead>
              <SessionTable
                sessions={filteredSessions}
                onEdit={startEdit}
                onDelete={handleDelete}
              />
            </table>
          ) : (
            <BreakdownTable
              sessions={filteredSessions}
              mode={breakdownMode as "weekday" | "month" | "year"}
            />
          )}
        </div>

      </div>
    </div>
  );
};

export default BankrollTracker;
