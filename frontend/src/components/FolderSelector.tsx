import React, { useState, useEffect, useRef } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { logUserAction } from "../logEvent";
import { sortFoldersLikeSelector } from "../utils/folderSort";
import type { FolderMetadata } from "../hooks/useFolders";

interface FolderSelectorProps {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  /** NEW: metadata for each folder (from useFolders) */
  metaByFolder?: Record<string, FolderMetadata | null>;
}

type FTFilter = "any" | "only" | "exclude";

/* ────────────────────────────────────────────────────────────────── */
/*  Debug toggle                                                      */
/* ────────────────────────────────────────────────────────────────── */
const DEBUG_FILTER = false;
const dbg = (...args: unknown[]) => {
  if (DEBUG_FILTER) console.debug("[FolderSelector]", ...args);
};

/* ────────────────────────────────────────────────────────────────── */
/*  Helpers                                                           */
/* ────────────────────────────────────────────────────────────────── */

/** Canonicalize numeric strings: "018"->"18", "18.0"->"18", "15.50"->"15.5". */
const canonNum = (s: string): string => {
  let t = s.replace(/^0+(\d)/, "$1");
  t = t.replace(/(\.\d*?)0+$/, "$1");
  t = t.replace(/\.$/, "");
  return t;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split a folder name into chunks with number + position. */
type Chunk = { numRaw: string; numCanon: string; pos: string; chunkRaw: string };
const splitChunks = (folder: string): Chunk[] =>
  folder
    .split("_")
    .map((ch) => {
      const m = ch.match(/^(\d+(?:\.\d+)?)([A-Z0-9]+)$/i);
      if (!m) return { numRaw: "", numCanon: "", pos: "", chunkRaw: ch };
      const [, numRaw, posRaw] = m;
      return {
        numRaw,
        numCanon: canonNum(numRaw),
        pos: posRaw.toUpperCase(),
        chunkRaw: ch,
      };
    })
    .filter((c) => c.pos !== "");

/** Map positions → canonical numeric string. */
const getPosNumMap = (folder: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const c of splitChunks(folder)) {
    map[c.pos] = c.numCanon;
  }
  return map;
};

/**
 * Pure-number match: boundary-aware and tolerant to leading zeros & trailing .0
 * Matches "_15HJ_" / "_015HJ_" / "_15.0CO" but NOT "_150HJ_" or "_15.5CO_".
 */
const hasExactNumber = (folder: string, rawNum: string): boolean => {
  const want = canonNum(rawNum);
  const esc = escapeRe(want);
  // (^|_)0*NUM(.0+)?<POS>(_|$)
  const re = new RegExp(String.raw`(?:^|_)0*${esc}(?:\.0+)?[A-Za-z0-9]+(?=_|$)`);
  return re.test(folder);
};

// fixed header order
const DESIRED_HEADER_ORDER = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

/** Safe parser kept for table rendering (avg + per-seat values). */
function parseFolderSafe(folder: string) {
  const parts = folder.split("_");
  const stacks: Record<string, number> = {};

  parts.forEach((ch) => {
    const m = ch.match(/^(\d+(?:\.\d+)?)([A-Z][A-Z0-9+]*)$/i);
    if (!m) {
      console.warn("❌  Bad chunk:", ch, "in folder:", folder);
      return;
    }
    const [, num, posRaw] = m;
    const pos = posRaw.toUpperCase();
    stacks[pos] = Number(num);
  });

  const avg =
    Math.round(
      (Object.values(stacks).reduce((s, v) => s + v, 0) / parts.length) * 10
    ) / 10;

  return { stacks, avg };
}

/** Tiny badge */
const TagBadge: React.FC<{ text: string; title?: string }> = ({ text, title }) => (
  <span
    title={title}
    className="inline-block text-[10px] leading-4 px-1.5 py-[1px] rounded-full bg-gray-200 text-gray-700 border border-gray-300"
  >
    {text}
  </span>
);

/* ────────────────────────────────────────────────────────────────── */
/*  Component                                                         */
/* ────────────────────────────────────────────────────────────────── */
const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
  metaByFolder,
}) => {
  const [user] = useAuthState(auth);

  const [input, setInput] = useState("");
  const [items, setItems] = useState<string[]>(folders);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  // filter UI state
  const [showFilter, setShowFilter] = useState(false);
  const [playersFilter, setPlayersFilter] = useState<number | null>(null); // null = Any
  const [ftFilter, setFtFilter] = useState<FTFilter>("any"); // "any" | "only" | "exclude"

  // keep a ref to the input wrapper so dropdown positions nicely
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  /* -------- filter + sort ---------------------------------------- */
  useEffect(() => {
    const q = input.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    type Pair = { rawNum: string; pos: string };
    const pairs: Pair[] = [];
    const numStrs: string[] = [];
    const words: string[] = [];

    for (const t of tokens) {
      const mPair = t.match(/^(\d+(?:\.\d+)?)([a-z][a-z0-9+]*)$/i);
      if (mPair) {
        pairs.push({ rawNum: mPair[1], pos: mPair[2].toUpperCase() });
        continue;
      }
      const mNum = t.match(/^\d+(?:\.\d+)?$/);
      if (mNum) {
        numStrs.push(mNum[0]);
        continue;
      }
      words.push(t);
    }

    if (DEBUG_FILTER) dbg("query:", q, { tokens, pairs, numStrs, words, playersFilter, ftFilter });

    const filtered = folders.filter((f) => {
      // text/query filter
      if (q) {
        if (pairs.length > 0) {
          const posMap = getPosNumMap(f);
          const okPairs = pairs.every(({ rawNum, pos }) => {
            const want = canonNum(rawNum);
            const have = posMap[pos];
            return have !== undefined && have === want;
          });
          if (!okPairs) return false;
        } else {
          if (numStrs.length > 0 && !numStrs.every((s) => hasExactNumber(f, s))) return false;
          if (words.length > 0 && !words.every((w) => f.toLowerCase().includes(w))) return false;
        }
      }

      // players filter
      if (playersFilter !== null) {
        const count = f.split("_").length;
        if (count !== playersFilter) return false;
      }

      // Final Table tri-state filter
      if (ftFilter !== "any") {
        const meta = metaByFolder?.[f] ?? null;
        const isFT = !!meta?.name && meta.name.toUpperCase().includes("FT");
        if (ftFilter === "only" && !isFT) return false;
        if (ftFilter === "exclude" && isFT) return false;
      }

      return true;
    });

    const list = sortFoldersLikeSelector(filtered);
    setItems(list);
    setHi(list.length ? 0 : -1);
  }, [input, folders, playersFilter, ftFilter, metaByFolder]);

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
  const nav: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      setShowFilter(false);
    } else if ((e.key === "ArrowDown" || e.key === "Tab") && items.length > 0) {
      e.preventDefault();
      setHi((p) => (p + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length > 0) {
      e.preventDefault();
      setHi((p) => (p - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && hi >= 0 && items.length > 0) {
      choose(items[hi]);
    } else {
      setOpen(true);
    }
  };

  /* -------- header build ----------------------------------------- */
  const header = (() => {
    const present = new Set<string>();
    for (const f of items) {
      const { stacks } = parseFolderSafe(f);
      for (const pos of Object.keys(stacks)) present.add(pos.toUpperCase());
    }
    const ordered = DESIRED_HEADER_ORDER.filter((pos) => present.has(pos));
    return ordered.length ? ordered : DESIRED_HEADER_ORDER;
  })();

  const cols = header.length + 2;

  // derived count for placeholder
  const numSims = items.length;

  return (
    <div data-intro-target="folder-selector" className="flex justify-center">
      <div className="relative w-full max-w-lg">
        {/* input + dropdown-toggle + FILTER button */}
        <div className="flex items-stretch gap-2">
          <div ref={inputWrapRef} className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={nav}
              placeholder={`Search ${numSims} Preflop Solutions…`}
              className="
                bg-white/95 shadow-md hover:bg-blue-100
                w-full px-4 pr-10 py-2
                border border-gray-300 rounded-xl
                focus:outline-none focus:ring focus:border-blue-300
              "
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen((p) => !p)}
              className="absolute inset-y-0 right-0 flex items-center px-3"
              aria-label="Toggle folder list"
              title="Toggle folder list"
            >
              <svg className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Filter Button + Popover */}
          <div className="relative">
            <button
              type="button"
              aria-label="Open filters"
              title="Filters"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowFilter((p) => !p)}
              className="
                h-10 w-10 shrink-0
                inline-flex items-center justify-center
                rounded-xl border border-gray-300 bg-white/95 shadow-md
                hover:bg-gray-100 focus:outline-none focus:ring
              "
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-gray-700" fill="currentColor">
                <path d="M3 5a1 1 0 011-1h16a1 1 0 01.8 1.6l-6.2 8.27V19a1 1 0 01-.553.894l-3 1.5A1 1 0 019 20.5v-5.63L2.2 5.6A1 1 0 013 5z" />
              </svg>
            </button>

            {showFilter && (
              <div
                className="absolute right-0 mt-2 w-68 rounded-xl border border-gray-200 bg-white shadow-lg p-3 z-20"
                onMouseDown={(e) => e.preventDefault()} // keep open when clicking inside
              >
                {/* Number of players */}
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-600 mb-1">Number of players</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={`px-1 py-1 rounded-md text-xs border ${
                        playersFilter === null
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                      onClick={() => setPlayersFilter(null)}
                    >
                      Any
                    </button>
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <button
                        key={n}
                        className={`px-2 py-1 rounded-md text-xs border ${
                          playersFilter === n
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }`}
                        onClick={() =>
                          setPlayersFilter((prev) => (prev === n ? null : n))
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Final Table */}
                <div className="mb-2">
                  <div className="text-xs font-semibold text-gray-600 mb-1">Final Table</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className={`px-2 py-1 rounded-md text-xs border ${
                        ftFilter === "any"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                      onClick={() => setFtFilter("any")}
                    >
                      Any
                    </button>
                    <button
                      className={`px-2 py-1 rounded-md text-xs border ${
                        ftFilter === "only"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                      onClick={() => setFtFilter("only")}
                    >
                      Final Table
                    </button>
                    <button
                      className={`px-2 py-1 rounded-md text-xs border ${
                        ftFilter === "exclude"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                      }`}
                      onClick={() => setFtFilter("exclude")}
                    >
                      Exclude FT
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() => {
                      setPlayersFilter(null);
                      setFtFilter("any");
                    }}
                  >
                    Reset filters
                  </button>
                  <button
                    className="text-xs text-gray-600 hover:underline"
                    onClick={() => setShowFilter(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* dropdown */}
        {open && (
          <div
            className="absolute z-10 w-full mt-1 max-h-160 overflow-auto border bg-white shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            {/* header row */}
            {header.length > 0 ? (
              <div
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                className="grid text-xs font-semibold text-gray-200 bg-gray-800 sticky top-0"
              >
                <div className="px-2 py-1 border-r border-gray-700">Tags</div>
                <div className="px-2 py-1 border-r border-gray-700">Avg.</div>
                {header.map((pos) => (
                  <div key={pos} className="px-2 py-1 border-r border-gray-700 text-center">
                    {pos}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-2 text-red-600 text-xs">⚠️ Unable to build seat header</div>
            )}

            {/* rows */}
            {items.map((folder, idx) => {
              const { stacks, avg } = parseFolderSafe(folder);
              if (Object.keys(stacks).length === 0) return null;

              const meta = metaByFolder?.[folder] ?? null;
              const isFT = !!meta?.name && meta.name.toUpperCase().includes("FT");

              return (
                <div
                  key={folder}
                  onMouseDown={() => choose(folder)}
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                  className={`grid text-xs cursor-pointer ${
                    idx === hi ? "bg-blue-200" : "hover:bg-gray-100"
                  }`}
                >
                  <div className="px-2 py-1 border-t border-r flex items-center gap-1">
                    {isFT && <TagBadge text="FT" title="Final Table structure" />}
                  </div>

                  <div className="px-2 py-1 border-t border-r text-center">{avg}</div>

                  {header.map((pos) => (
                    <div key={pos} className="px-2 py-1 border-t text-center">
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
