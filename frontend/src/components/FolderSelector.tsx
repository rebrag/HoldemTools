// src/components/FolderSelector.tsx
import React, { useState, useEffect } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { logUserAction } from "../logEvent";
import { sortFoldersLikeSelector } from "../utils/folderSort";

/* ────────────────────────────────────────────────────────────────── */
/*  Types                                                             */
/* ────────────────────────────────────────────────────────────────── */
interface FolderSelectorProps {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Seat orders for 2- to 9-handed tables                             */
/* ────────────────────────────────────────────────────────────────── */
const SEAT_ORDER: Record<number, string[]> = {
  2: ["BTN", "BB"],
  3: ["SB", "BB", "BTN"],
  4: ["SB", "BB", "CO", "BTN"],
  5: ["SB", "BB", "HJ", "CO", "BTN"],
  6: ["SB", "BB", "LJ", "HJ", "CO", "BTN"],
  7: ["SB", "BB", "UTG1", "LJ", "HJ", "CO", "BTN"],
  8: ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"],
  9: ["SB", "BB", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN"], // 9-max
};

/* ────────────────────────────────────────────────────────────────── */
/*  Helpers                                                           */
/* ────────────────────────────────────────────────────────────────── */

/* Safe parser that logs malformed chunks */
function parseFolderSafe(folder: string) {
  const parts  = folder.split("_");
  const stacks: Record<string, number> = {};

  parts.forEach(ch => {
    const m = ch.match(/^(\d+(?:\.\d+)?)([A-Z0-9]+)/);  // new – 14, 14.5, 25.5…
    if (!m) {
      console.warn("❌  Bad chunk:", ch, "in folder:", folder);
      return;
    }
    const [, num, pos] = m;
    stacks[pos] = Number(num);
  });

  const avg =
    Math.round(
      (Object.values(stacks).reduce((s, v) => s + v, 0) / parts.length) * 10
    ) / 10;

  return { stacks, avg };
}

/* ────────────────────────────────────────────────────────────────── */
/*  Component                                                         */
/* ────────────────────────────────────────────────────────────────── */
const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
}) => {
  const [user] = useAuthState(auth);

  const [input, setInput]     = useState("");
  const [items, setItems]     = useState<string[]>(folders);
  const [open, setOpen]       = useState(false);
  const [hi, setHi]           = useState(-1);

  /* -------- filter + sort ---------------------------------------- */
  useEffect(() => {
    const list = sortFoldersLikeSelector(
      folders.filter(f =>
        f.toLowerCase().includes(input.trim().toLowerCase())
      )
    );
    setItems(list);
    setHi(list.length ? 0 : -1);
  }, [input, folders]);

  /* DEBUG: log whenever `items` changes */
  useEffect(() => {
    // console.log("Filtered items:", items);
  }, [items]);

  /* -------- safe select ------------------------------------------ */
  const choose = (folder: string) => {
    if (folder !== currentFolder) {
      onFolderSelect(folder);
      if (user) logUserAction(user.email ?? user.uid, "Opened Folder", folder);
    }
    setOpen(false);
    setInput("");
  };

  /* -------- keyboard nav ----------------------------------------- */
  const nav: React.KeyboardEventHandler<HTMLInputElement> = e => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setHi(p => (p + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(p => (p - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && hi >= 0) {
      choose(items[hi]);
    } else {
      setOpen(true);
    }
  };

  /* -------- header build ----------------------------------------- */
  const maxSeats = items.length
    ? Math.max(...items.map(f => f.split("_").length))
    : 2;
  // console.log("maxSeats detected:", maxSeats);

  const header =
    SEAT_ORDER[maxSeats] ||
    (items[0] ? Object.keys(parseFolderSafe(items[0]).stacks).sort() : []);

  // console.log("Header derived:", header);

  const cols = header.length + 1; // +1 for Avg.

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */
  return (
    <div data-intro-target="folder-selector" className="flex justify-center">
      <div className="relative w-full max-w-lg">
        {/* input + toggle */}
        <div className="relative">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={nav}
            placeholder="Search Preflop Sims…"
            className="
              shadow-md hover:bg-blue-100
              w-full px-4 pr-10 py-2
              border border-gray-300 rounded-xl
              focus:outline-none focus:ring focus:border-blue-300
            "
          />
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setOpen(p => !p)}
            className="absolute inset-y-0 right-0 flex items-center px-3"
          >
            <svg
              className="h-5 w-5 text-gray-600"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
                <path
    fillRule="evenodd"
    d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 01.02-1.06z"
    clipRule="evenodd"
  />
            </svg>
          </button>
        </div>

        {/* dropdown */}
        {open && (
          <div className="absolute z-10 w-full mt-1 max-h-160 overflow-auto border bg-white shadow-lg">
            {/* header row */}
            {header.length > 0 ? (
              <div
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                className="grid text-xs font-semibold text-gray-200 bg-gray-800 sticky top-0"
              >
                <div className="px-2 py-1 border-r border-gray-700">Avg.</div>
                {header.map(pos => (
                  <div
                    key={pos}
                    className="px-2 py-1 border-r border-gray-700 text-center"
                  >
                    {pos}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-2 text-red-600 text-xs">
                ⚠️ Unable to build seat header
              </div>
            )}

            {/* rows */}
            {items.map((folder, idx) => {
              const { stacks, avg } = parseFolderSafe(folder);
              if (Object.keys(stacks).length === 0) return null; // skip bad

              return (
                <div
                  key={folder}
                  onMouseDown={() => choose(folder)}
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                  className={`grid text-xs cursor-pointer ${
                    idx === hi ? "bg-blue-200" : "hover:bg-gray-100"
                  }`}
                >
                  {/* avg */}
                  <div className="px-2 py-1 border-t border-r text-center">{avg}</div>

                  {/* seat stacks */}
                  {header.map(pos => (
                    <div
                      key={pos}
                      className="px-2 py-1 border-t text-center"
                    >
                      {stacks[pos] ?? ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderSelector;
