/* Search / filter / selection logic behind the preflop solution picker.
 * Extracted from FolderSelector so both the wide search bar (mobile + grid
 * view) and the compact SimSelect box (desktop study view) share one
 * implementation: token parsing, filtering, sorting, tier gating, keyboard
 * navigation, and the choose-with-logging action. */
import React, { useEffect, useMemo, useState } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "@/lib/firebase";
import { logUserAction } from "@/lib/logEvent";
import { sortFoldersLikeSelector } from "@/lib/solver/folderSort";
import type { FolderMetadata } from "@/hooks/useFolders";
import {
  requiredTierForFolder,
  isTierSufficient,
  type Tier,
  type FolderMetaLike,
} from "@/lib/stripe/stripeTiers";

export type FTFilter = "any" | "only" | "exclude";

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

/* fixed header order for the dropdown table */
const DESIRED_HEADER_ORDER = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];

/** Lightweight parse used by the dropdown (avg + per-seat values). */
export function parseFolderSafe(folder: string) {
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
/*  Hook                                                              */
/* ────────────────────────────────────────────────────────────────── */
export interface UseFolderSearchOptions {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  metaByFolder?: Record<string, FolderMetadata | null>;
  userTier?: Tier;
}

export function useFolderSearch({
  folders,
  currentFolder,
  onFolderSelect,
  metaByFolder,
  userTier = "free",
}: UseFolderSearchOptions) {
  const [user] = useAuthState(auth);

  const [input, setInput] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);

  const [playersFilter, setPlayersFilter] = useState<number | null>(null);
  const [ftFilter, setFtFilter] = useState<FTFilter>("any");

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
          !!(meta as FolderMetadata | null)?.name &&
          String((meta as FolderMetadata).name).toUpperCase().includes("FT");
        if (ftFilter === "only" && !isFT) return false;
        if (ftFilter === "exclude" && isFT) return false;
      }

      return true;
    });

    let list: string[] = [];
    try {
      list = sortFoldersLikeSelector(filtered, metaByFolder);
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

  /** Arrow / Tab / Enter / Escape navigation for the search input. */
  const handleInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
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

  const header = useMemo(() => {
    const present = new Set<string>();
    for (const f of items) {
      const { stacks } = parseFolderSafe(f);
      for (const pos of Object.keys(stacks)) present.add(pos.toUpperCase());
    }
    const ordered = DESIRED_HEADER_ORDER.filter((pos) => present.has(pos));
    return ordered.length ? ordered : DESIRED_HEADER_ORDER;
  }, [items]);

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

  return {
    input,
    setInput,
    open,
    setOpen,
    items,
    hi,
    setHi,
    header,
    lockedSet,
    numSims,
    playersFilter,
    setPlayersFilter,
    ftFilter,
    setFtFilter,
    choose,
    handleInputKeyDown,
  };
}
