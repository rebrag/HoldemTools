/* eslint-disable @typescript-eslint/no-explicit-any */
// src/bankroll/BankrollTracker.tsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import LoadingIndicator from "../components/LoadingIndicator";
import BankrollChart from "./BankrollChart";
import BankrollFormModal from "./BankrollFormModal";
import BankrollStatsGrid from "./BankrollStatsGrid";
import SessionTable from "./SessionTable";
import { buildCumulativePoints, toLocalInputValue } from "./utils";
import type {
  BankrollSession,
  BankrollTrackerProps,
  BankrollStats,
  FormState,
  SessionDuration,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
const DRAFT_KEY = "ht_bankroll_draft_v1";
const ADD_LOCATION_OPTION = "__ht_add_location__";
const ADD_GAME_OPTION = "__ht_add_game__";

type DraftSession = {
  id: string;
  form: FormState;
  createdAt: string;
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

const BankrollTracker: React.FC<BankrollTrackerProps> = ({ user }) => {
  const [sessions, setSessions] = useState<BankrollSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // single "current form" used by the modal (either for a draft or an edit)
  const [form, setForm] = useState<FormState>(defaultForm);

  // mode: are we editing a draft (new session) or an existing saved one?
  const [mode, setMode] = useState<"draft" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // multiple draft sessions in progress
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  // modal state: expanded (overlay) vs minimized (chips only)
  const [isModalExpanded, setIsModalExpanded] = useState(true);

  const [extraLocations, setExtraLocations] = useState<string[]>([]);
  const [extraGames, setExtraGames] = useState<string[]>([]);

  // used for live duration ticking for in-progress sessions
  const [now, setNow] = useState<Date>(() => new Date());

  // chart hover index
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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
          e instanceof Error ? e.message : "Failed to load bankroll sessions"
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

  const setEndToNow = () => {
    const nowDate = new Date();
    const local = new Date(
      nowDate.getTime() - nowDate.getTimezoneOffset() * 60000
    );
    const isoLocal = local.toISOString().slice(0, 16);
    updateForm((prev) => ({
      ...prev,
      end: isoLocal,
    }));
  };

  const createDraftId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const createNewDraft = (): DraftSession => {
    const draft: DraftSession = {
      id: createDraftId(),
      form: defaultForm,
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
    const buyRaw = f.buyIn.trim();
    const cashRaw = f.cashOut.trim();
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

  const autoProfit = useMemo(
    () => computeAutoProfit(form),
    [form]
  );

  const sessionDuration = useMemo(
    () => computeSessionDuration(form),
    [form, now]
  );

  // stats
  const stats: BankrollStats = useMemo(() => {
    if (!sessions.length) {
      return { totalProfit: 0, totalHours: 0, numSessions: 0, hourly: 0 };
    }
    const totalProfit = sessions.reduce(
      (sum, s) => sum + (s.profit || 0),
      0
    );
    const totalHours = sessions.reduce(
      (sum, s) => sum + (s.hours || 0),
      0
    );
    const numSessions = sessions.length;
    const hourly = totalHours > 0 ? totalProfit / totalHours : 0;
    return { totalProfit, totalHours, numSessions, hourly };
  }, [sessions]);

  const cumulativePoints = useMemo(
    () => buildCumulativePoints(sessions),
    [sessions]
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

  const handleSave = async () => {
    if (!user) {
      setError("You must be logged in to save bankroll sessions.");
      return;
    }

    const currentMode = mode;
    const currentEditingId = editingId;
    const currentActiveDraftId = activeDraftId;
    const currentForm = form;

    try {
      setSaving(true);
      setError(null);

      const startDate = currentForm.start ? new Date(currentForm.start) : null;
      const endDate = currentForm.end ? new Date(currentForm.end) : null;

      const buyIn = currentForm.buyIn.trim()
        ? Number(currentForm.buyIn)
        : NaN;
      const cashOut = currentForm.cashOut.trim()
        ? Number(currentForm.cashOut)
        : NaN;

      if (!Number.isFinite(buyIn) || !Number.isFinite(cashOut)) {
        throw new Error("Please enter valid Buy-in and Cash-out amounts.");
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
        ? `${API_BASE_URL}/api/bankroll/${encodeURIComponent(
            currentEditingId!
          )}`
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
        setDrafts((prev) =>
          prev.filter((d) => d.id !== currentActiveDraftId)
        );
      }

      setForm(defaultForm);
      setEditingId(null);
      setActiveDraftId(null);
      setMode(null);
      setIsModalExpanded(true);
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Failed to save bankroll session"
      );
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

  const handleGameSelectChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
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

  /* ───────────────── Render ───────────────── */

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
                onEndNow={setEndToNow}
                onSave={handleSave}
                onCancel={cancelModal}
                onMinimize={handleMinimize}
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
              <col className="w-[14%]" /> {/* Date */}
              <col className="w-[18%]" /> {/* Location */}
              <col className="w-[14%]" /> {/* Blinds */}
              <col className="w-[8%]" /> {/* Hours */}
              <col className="w-[12%]" /> {/* Buy-in */}
              <col className="w-[12%]" /> {/* Cash-out */}
              <col className="w-[12%]" /> {/* Profit */}
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
                  Buy-in
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
              sessions={sessions}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          </table>
        </div>
      </div>
    </div>
  );
};

export default BankrollTracker;
