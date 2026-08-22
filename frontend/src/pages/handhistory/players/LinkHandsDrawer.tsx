// src/pages/handhistory/players/LinkHandsDrawer.tsx
// "Link past hands" wizard: connects the free-text seat names in already-saved
// hands to Players rows. Each distinct unlinked name is a group; a unique name
// links in one tap, while a shared first name ("Jonathan" who is really two
// people) is split by expanding the group and checking only the hands that
// belong to one of them - dates and session labels give the context to tell
// them apart. Nothing is ever linked without an explicit Apply.
import React, { useEffect, useMemo, useState } from "react";
import ResponsiveDrawer from "@/components/ResponsiveDrawer";
import PlayerAvatar from "@/components/PlayerAvatar";
import { usePlayers } from "@/hooks/usePlayers";
import { authedFetch } from "@/lib/api";
import { forgetCachedHandText } from "@/lib/handTextCache";
import { createPlayer, type Player } from "@/lib/playersApi";
import type { BankrollSession } from "@/pages/bankroll/types";
import type { HandHistory } from "../types";
import {
  linkPlayerInRawText,
  scanUnlinkedNames,
  type UnlinkedNameGroup,
} from "./relinkHands";

const NEW_PLAYER = "__new__";

interface Props {
  /** Mount permanently and toggle this, so the sheet's exit animation plays. */
  open: boolean;
  onClose: () => void;
  hands: HandHistory[];
  sessionsById: Map<string, BankrollSession>;
  /** Hands whose rawText was rewritten - the parent merges them into its
   *  state so counts and this drawer's scan recompute. */
  onHandsUpdated: (updated: HandHistory[]) => void;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function dateRange(group: UnlinkedNameGroup): string {
  const newest = fmtDate(group.hands[0].createdAt);
  const oldest = fmtDate(group.hands[group.hands.length - 1].createdAt);
  return newest === oldest ? newest : `${oldest} – ${newest}`;
}

const LinkHandsDrawer: React.FC<Props> = ({
  open,
  onClose,
  hands,
  sessionsById,
  onHandsUpdated,
}) => {
  const { players, byId, mutate } = usePlayers();
  const { groups, unscannable } = useMemo(() => scanUnlinkedNames(hands), [hands]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Hand ids the user UNCHECKED, per name (default = everything selected, so
  // only exclusions need storing and fresh groups start fully checked).
  const [excluded, setExcluded] = useState<Map<string, Set<number>>>(new Map());
  const [actionByName, setActionByName] = useState<Map<string, string>>(new Map());
  const [applyingName, setApplyingName] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errorByName, setErrorByName] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!open) return;
    setExpanded(new Set());
    setExcluded(new Map());
    setActionByName(new Map());
    setApplyingName(null);
    setProgress(null);
    setErrorByName(new Map());
    // Reset only on (re)open, per the drawer convention.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sessionLabel = (sessionId: string | null): string => {
    const s = sessionId ? sessionsById.get(sessionId) : undefined;
    return s ? [s.location?.trim(), s.blinds?.trim()].filter(Boolean).join(" · ") : "";
  };

  // Default action: an existing player with the exact same name, when there is
  // exactly one (a natural merge target); otherwise create a new player.
  const defaultActionFor = (name: string): string => {
    const sameName = players.filter((p) => p.name === name);
    return sameName.length === 1 ? sameName[0].id : NEW_PLAYER;
  };
  const actionFor = (name: string): string =>
    actionByName.get(name) ?? defaultActionFor(name);

  const selectedCount = (group: UnlinkedNameGroup): number => {
    const ex = excluded.get(group.name);
    return group.hands.filter((h) => !h.conflict && !ex?.has(h.id)).length;
  };

  const toggleHand = (name: string, id: number) => {
    setExcluded((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(name) ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      next.set(name, set);
      return next;
    });
  };

  const apply = async (group: UnlinkedNameGroup) => {
    if (applyingName) return;
    const ex = excluded.get(group.name);
    const targets = group.hands.filter((h) => !h.conflict && !ex?.has(h.id));
    if (targets.length === 0) return;

    setApplyingName(group.name);
    setErrorByName((prev) => {
      const next = new Map(prev);
      next.delete(group.name);
      return next;
    });
    setProgress({ done: 0, total: targets.length });

    try {
      let player: Player;
      const action = actionFor(group.name);
      if (action === NEW_PLAYER) {
        player = await createPlayer(group.name);
        mutate([player]);
      } else {
        const existing = byId.get(action);
        if (!existing) throw new Error("That player no longer exists.");
        player = existing;
      }

      const updated: HandHistory[] = [];
      let failed = 0;
      // Sequential on purpose: tens of small PUTs, and a progress readout the
      // user can actually follow beats a burst of parallel requests.
      for (let i = 0; i < targets.length; i++) {
        const ref = targets[i];
        const hand = hands.find((h) => h.id === ref.id);
        const newRaw = hand
          ? linkPlayerInRawText(hand.rawText, group.name, player.id)
          : null;
        if (!hand || !newRaw) {
          failed++;
        } else {
          try {
            const res = await authedFetch(`/api/handhistory/${hand.id}`, {
              method: "PUT",
              body: JSON.stringify({ rawText: newRaw, sessionId: hand.sessionId }),
            });
            if (!res.ok) throw new Error(String(res.status));
            updated.push({ ...hand, rawText: newRaw });
            // The replay cache keys by hand id - drop the stale text.
            forgetCachedHandText(String(hand.id));
          } catch {
            failed++;
          }
        }
        setProgress({ done: i + 1, total: targets.length });
      }

      if (updated.length > 0) onHandsUpdated(updated);
      if (failed > 0) {
        setErrorByName((prev) =>
          new Map(prev).set(
            group.name,
            `${failed} hand${failed === 1 ? "" : "s"} couldn't be updated - they're still listed below.`
          )
        );
      }
    } catch (e) {
      setErrorByName((prev) =>
        new Map(prev).set(
          group.name,
          e instanceof Error ? e.message : "Something went wrong - nothing was linked."
        )
      );
    } finally {
      setApplyingName(null);
      setProgress(null);
    }
  };

  return (
    <ResponsiveDrawer
      open={open}
      onClose={onClose}
      scrollMode="custom"
      desktopMaxWidthClassName="sm:max-w-lg"
      ariaLabel="Link past hands to players"
    >
      <>
        <div className="px-5 pt-2 sm:pt-5 pb-3">
          <h2 className="text-lg font-bold tracking-tight text-white">
            Link past hands
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            These names appear in your recorded hands but aren't linked to a
            player yet. If one name is really two different people, expand it
            and check only their hands - then run it again for the other.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
              Every named seat in your hands is linked. New hands link as you
              record them.
            </div>
          ) : (
            <ul className="space-y-3">
              {groups.map((group) => {
                const isOpen = expanded.has(group.name);
                const busy = applyingName === group.name;
                const count = selectedCount(group);
                const conflicts = group.hands.filter((h) => h.conflict).length;
                const error = errorByName.get(group.name);
                return (
                  <li
                    key={group.name}
                    className="rounded-xl border border-white/10 bg-white/5"
                  >
                    {/* ── Group header ─────────────────────────────── */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.name)) next.delete(group.name);
                          else next.add(group.name);
                          return next;
                        })
                      }
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                    >
                      <span
                        aria-hidden="true"
                        className={`text-slate-500 transition-transform duration-150 ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        ›
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">
                          {group.name}
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          {group.hands.length} hand{group.hands.length === 1 ? "" : "s"} ·{" "}
                          {dateRange(group)}
                        </span>
                      </span>
                      {count < group.hands.length - conflicts && (
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-[1px] text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/30">
                          {count} selected
                        </span>
                      )}
                    </button>

                    {/* ── Action row ───────────────────────────────── */}
                    <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
                      <select
                        value={actionFor(group.name)}
                        disabled={busy}
                        onChange={(e) =>
                          setActionByName((prev) =>
                            new Map(prev).set(group.name, e.target.value)
                          )
                        }
                        aria-label={`Player for ${group.name}`}
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 transition-colors focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/40 disabled:opacity-40 [color-scheme:dark]"
                      >
                        <option value={NEW_PLAYER}>＋ New player "{group.name}"</option>
                        {players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.notes ? ` — ${p.notes.split("\n")[0].slice(0, 30)}` : ""}
                          </option>
                        ))}
                      </select>
                      {actionFor(group.name) !== NEW_PLAYER && (
                        <PlayerAvatar
                          player={byId.get(actionFor(group.name))}
                          size="xs"
                          className="ring-white/20"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => void apply(group)}
                        disabled={busy || count === 0 || !!applyingName}
                        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-all hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default disabled:opacity-40"
                      >
                        {busy && progress
                          ? `Linking ${progress.done}/${progress.total}…`
                          : `Link ${count} hand${count === 1 ? "" : "s"}`}
                      </button>
                    </div>

                    {error && (
                      <p className="border-t border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-[11px] text-rose-300">
                        {error}
                      </p>
                    )}

                    {/* ── Per-hand rows ────────────────────────────── */}
                    {isOpen && (
                      <ul className="border-t border-white/10">
                        {group.hands.map((h) => {
                          const checked =
                            !h.conflict && !excluded.get(group.name)?.has(h.id);
                          const meta = sessionLabel(h.sessionId);
                          return (
                            <li key={h.id}>
                              <label
                                className={`flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
                                  h.conflict
                                    ? "cursor-default opacity-40"
                                    : "cursor-pointer hover:bg-white/5"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={h.conflict || busy}
                                  onChange={() => toggleHand(group.name, h.id)}
                                  className="h-3.5 w-3.5 shrink-0 accent-emerald-500"
                                />
                                <span className="shrink-0 text-slate-300">
                                  {fmtDate(h.createdAt)}
                                </span>
                                {meta && (
                                  <span className="min-w-0 truncate text-slate-500">
                                    {meta}
                                  </span>
                                )}
                                <span className="ml-auto flex shrink-0 items-center gap-2">
                                  {h.conflict && (
                                    <span className="text-[10px] text-amber-300/80">
                                      two seats share this name
                                    </span>
                                  )}
                                  <a
                                    href={`/hand-history/replay/${h.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-emerald-300 underline underline-offset-2 transition-colors hover:text-emerald-200"
                                  >
                                    view
                                  </a>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {unscannable > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              {unscannable} hand{unscannable === 1 ? "" : "s"} without replay
              data can't be linked (imported or legacy text-only hands).
            </p>
          )}
        </div>
      </>
    </ResponsiveDrawer>
  );
};

export default LinkHandsDrawer;
