// src/pages/handhistory/create/PlayerCombobox.tsx
// Seat-name field that doubles as a player picker. Typing is plain free text
// (exactly the old input); focusing while signed in opens a dropdown of the
// user's players to LINK the seat to a durable identity - critical when three
// different "Jonathan"s share a name, since the photo/notes disambiguate at
// pick time and the chosen row's id (not the name) is what filters match on.
//
// Linked state renders as a chip (avatar + name + unlink ✕) in place of the
// input. Editing the text again clears the link: the text no longer denotes
// that identity. Signed out this degrades to the plain text input untouched.
import React, { useEffect, useMemo, useRef, useState } from "react";
import PlayerAvatar from "@/components/PlayerAvatar";
import { usePlayers } from "@/hooks/usePlayers";
import { createPlayer, type Player } from "@/lib/playersApi";

interface Props {
  name: string;
  playerId?: string;
  onChange: (name: string, playerId?: string) => void;
  placeholder?: string;
  /** Styling of the free-text input (the seat editor passes its fieldCls). */
  fieldClassName: string;
  /** id for the text input so an external <label htmlFor> can name it. The
   *  label must NOT wrap this component: in the linked state the chip's
   *  unlink <button> would become the label's target and any label click
   *  would unlink. */
  inputId?: string;
}

const PlayerCombobox: React.FC<Props> = ({
  name,
  playerId,
  onChange,
  placeholder,
  fieldClassName,
  inputId,
}) => {
  const { players, byId, signedIn, mutate } = usePlayers();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the input on the render after unlinking (the chip swaps back to it).
  const focusAfterUnlink = useRef(false);

  const linked = playerId ? (byId.get(playerId) ?? null) : null;

  const query = name.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!signedIn) return [];
    if (!query) return players;
    return players.filter((p) => p.name.toLowerCase().includes(query));
  }, [players, query, signedIn]);

  // Offer "create" whenever there's a query; an exact-name match doesn't
  // suppress it - a second "Jonathan" is a legitimate new player.
  const showCreate = signedIn && query.length > 0;
  const optionCount = matches.length + (showCreate ? 1 : 0);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  useEffect(() => {
    if (focusAfterUnlink.current) {
      focusAfterUnlink.current = false;
      inputRef.current?.focus();
    }
  });

  const link = (p: Player) => {
    onChange(p.name, p.id);
    setOpen(false);
  };

  const createAndLink = async () => {
    const newName = name.trim();
    if (!newName || creating) return;
    setCreating(true);
    try {
      const p = await createPlayer(newName);
      mutate([p]);
      link(p);
    } catch {
      // Keep the free text; the seat still saves with a plain name.
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const pick = (index: number) => {
    if (index < matches.length) link(matches[index]);
    else void createAndLink();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || optionCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => (h + 1) % optionCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (h - 1 + optionCount) % optionCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hi);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // ── Linked: chip replaces the input ─────────────────────────────────────
  if (playerId) {
    return (
      <div
        className={`${fieldClassName} flex items-center gap-2 overflow-hidden`}
        title={linked ? undefined : "This player was deleted; unlink to rename"}
      >
        <PlayerAvatar player={linked} name={name} size="xs" className="ring-white/20" />
        <span className="min-w-0 flex-1 truncate">{linked?.name ?? name}</span>
        <button
          type="button"
          aria-label="Unlink player"
          onClick={() => {
            focusAfterUnlink.current = true;
            onChange(linked?.name ?? name, undefined);
          }}
          className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Unlinked: free-text input + (signed in) picker dropdown ─────────────
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={name}
        onChange={(e) => {
          onChange(e.target.value, undefined);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && optionCount > 0}
        aria-autocomplete="list"
        className={fieldClassName}
      />
      {open && signedIn && optionCount > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 py-1 shadow-xl shadow-black/40"
        >
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={hi === i}
                // onMouseDown so the pick lands before the input's blur closes us.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-100 transition-colors ${
                  hi === i ? "bg-white/10" : ""
                }`}
              >
                <PlayerAvatar player={p} size="xs" className="ring-white/20" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.notes && (
                  <span className="max-w-[40%] truncate text-[11px] text-slate-500">
                    {p.notes}
                  </span>
                )}
              </button>
            </li>
          ))}
          {showCreate && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={hi === matches.length}
                disabled={creating}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void createAndLink();
                }}
                onMouseEnter={() => setHi(matches.length)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  hi === matches.length ? "bg-white/10" : ""
                } ${creating ? "cursor-default opacity-50" : "text-emerald-300"}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-400/50 text-[10px] leading-none">
                  +
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {creating ? "Creating…" : `New player "${name.trim()}"`}
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default PlayerCombobox;
