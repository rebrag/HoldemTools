/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { logUserAction } from "../logEvent";
import { sortFoldersLikeSelector } from "../utils/folderSort";
import type { FolderMetadata } from "../hooks/useFolders";
import FolderSelectorDropdown from "./FolderSelectorDropdown";
import {
  requiredTierForFolder,
  isTierSufficient,
  type Tier,
  type FolderMetaLike,
} from "../lib/stripeTiers";

/* ────────────────────────────────────────────────────────────────── */
/*  Types                                                             */
/* ────────────────────────────────────────────────────────────────── */
export interface FolderSelectorProps {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  /** metadata for each folder (from useFolders) */
  metaByFolder?: Record<string, FolderMetadata | null>;

  /** NEW: current user tier used to pre-mark locked folders; defaults to "free" */
  userTier?: Tier;
}

type FTFilter = "any" | "only" | "exclude";

/* ────────────────────────────────────────────────────────────────── */
/*  Debug                                                             */
/* ────────────────────────────────────────────────────────────────── */
const DEBUG_FILTER = false;
const dbg = (...args: unknown[]) => {
  if (DEBUG_FILTER) console.debug("[FolderSelector]", ...args);
};

/* ────────────────────────────────────────────────────────────────── */
/*  Exclusions & heuristics                                           */
/* ────────────────────────────────────────────────────────────────── */
const EXCLUDE_NAMES = [/^onlinerangedata$/i, /^logs?$/i, /^gametrees$/i];
const EXCLUDE_EXTS = [".txt", ".log", ".csv", ".json"];

const looksLikeSolutionFolder = (name: string) => {
  const chunks = name.split("_").filter(Boolean);
  const nums = chunks.map((ch) => /^(\d+)/.exec(ch)?.[1]).filter(Boolean);
  return nums.length >= 2;
};

const isExcludedName = (name: string) =>
  EXCLUDE_NAMES.some((re) => re.test(name)) ||
  name.includes("/") ||
  EXCLUDE_EXTS.some((ext) => name.toLowerCase().endsWith(ext));

const countNumericChunks = (name: string) =>
  name
    .split("_")
    .filter(Boolean)
    .map((ch) => /^(\d+)/.exec(ch)?.[1])
    .filter(Boolean).length;

/* ────────────────────────────────────────────────────────────────── */
/*  Helpers for query parsing                                         */
/* ────────────────────────────────────────────────────────────────── */
const canonNum = (s: string): string => {
  let t = s.replace(/^0+(\d)/, "$1");
  t = t.replace(/(\.\d*?)0+$/, "$1");
  t = t.replace(/\.$/, "");
  return t;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const getPosNumMap = (folder: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const c of splitChunks(folder)) map[c.pos] = c.numCanon;
  return map;
};

const hasExactNumber = (folder: string, rawNum: string): boolean => {
  const want = canonNum(rawNum);
  const esc = escapeRe(want);
  const re = new RegExp(String.raw`(?:^|_)0*${esc}(?:\.0+)?[A-Za-z0-9]+(?=_|$)`);
  return re.test(folder);
};

/* fixed header order for table */
const DESIRED_HEADER_ORDER = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

/* lightweight parse used by dropdown (avg + per-seat values). */
function parseFolderSafe(folder: string) {
  const parts = folder.split("_");
  const stacks: Record<string, number> = {};
  parts.forEach((ch) => {
    const m = ch.match(/^(\d+(?:\.\d+)?)([A-Z][A-Z0-9+]*)$/i);
    if (!m) return;
    const [, num, posRaw] = m;
    const pos = posRaw.toUpperCase();
    stacks[pos] = Number(num);
  });
  const denom = Object.keys(stacks).length || 1;
  const avg =
    Math.round((Object.values(stacks).reduce((s, v) => s + v, 0) / denom) * 10) / 10;

  return { stacks, avg };
}

/* ────────────────────────────────────────────────────────────────── */
/*  Component                                                         */
/* ────────────────────────────────────────────────────────────────── */
const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
  metaByFolder,
  userTier = "free",
}) => {
  const [user] = useAuthState(auth);

  const [input, setInput] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  const [showFilter, setShowFilter] = useState(false);
  const [playersFilter, setPlayersFilter] = useState<number | null>(null);
  const [ftFilter, setFtFilter] = useState<FTFilter>("any");

  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  const sourceFolders = useMemo(
    () => folders.filter((f) => !isExcludedName(f) && looksLikeSolutionFolder(f)),
    [folders]
  );

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

    const filtered = sourceFolders.filter((f) => {
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

      if (playersFilter !== null) {
        if (countNumericChunks(f) !== playersFilter) return false;
      }

      if (ftFilter !== "any") {
        const meta = metaByFolder?.[f] ?? null;
        const isFT =
          !!(meta as any)?.name && String((meta as any).name).toUpperCase().includes("FT");
        if (ftFilter === "only" && !isFT) return false;
        if (ftFilter === "exclude" && isFT) return false;
      }

      return true;
    });

    let list: string[] = [];
    try {
      list = sortFoldersLikeSelector(filtered);
    } catch {
      list = filtered.slice().sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
    }
    setItems(list);
    setHi(list.length ? 0 : -1);
  }, [input, sourceFolders, playersFilter, ftFilter, metaByFolder]);

  const choose = (folder: string) => {
    if (folder !== currentFolder) {
      onFolderSelect(folder);
      if (user) logUserAction(user.email ?? user.uid, "Opened Folder", folder);
    }
    setOpen(false);
    setInput("");
  };

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

  // Build header from visible rows
  const header = useMemo(() => {
    const present = new Set<string>();
    for (const f of items) {
      const { stacks } = parseFolderSafe(f);
      for (const pos of Object.keys(stacks)) present.add(pos.toUpperCase());
    }
    const ordered = DESIRED_HEADER_ORDER.filter((pos) => present.has(pos));
    return ordered.length ? ordered : DESIRED_HEADER_ORDER;
  }, [items]);

  // NEW: compute which of the *visible* items are locked for this userTier
  const lockedSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of items) {
      const meta = (metaByFolder?.[f] ?? undefined) as FolderMetaLike | undefined;
      const need = requiredTierForFolder(f, meta);
      const ok = isTierSufficient(userTier ?? "free", need);
      if (!ok) s.add(f);
    }
    return s;
  }, [items, metaByFolder, userTier]);

  const numSims = items.length;

  return (
    <div data-intro-target="folder-selector overflow-visible" className="flex justify-center overflow-visible">
      <div className="relative w-full max-w-lg overflow-visible">
        {/* input + toggle + filters */}
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
                onMouseDown={(e) => e.preventDefault()}
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
                        onClick={() => setPlayersFilter((prev) => (prev === n ? null : n))}
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

        {/* Dropdown (floating panel, not full width) */}
        <FolderSelectorDropdown
          open={open}
          anchorRef={inputWrapRef}
          items={items}
          header={header}
          hi={hi}
          setHi={setHi}
          onChoose={choose}
          metaByFolder={metaByFolder}
          parseFolderSafe={parseFolderSafe}
          lockedSet={lockedSet}
        />
      </div>
    </div>
  );
};

export default FolderSelector;
