/* --------------------------------------------------------------- */
/*  Flags                                                          */
/* --------------------------------------------------------------- */
export const isAllSameFolder = (folder: string): boolean => {
  const parts = folder.split("_").filter(Boolean);
  const first = parts[0]?.match(/^(\d+)/)?.[1];
  return !!first && parts.every((p) => p.match(/^(\d+)/)?.[1] === first);
};

export const isHUSimFolder = (folder: string): boolean => {
  const parts = folder.split("_").filter(Boolean);
  return parts.length === 2 && /^\d+/.test(parts[0] ?? "");
};

/* --------------------------------------------------------------- */
/*  Safe stack parsing                                             */
/* --------------------------------------------------------------- */
const parseLeadingInt = (chunk: string): number | null => {
  const m = /^(\d+)/.exec(chunk);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
};

// Looser parser: ignore non-numeric chunks instead of throwing.
const getStacksLoose = (folder: string): number[] =>
  folder
    .split("_")
    .filter(Boolean)
    .map(parseLeadingInt)
    .filter((n): n is number => n !== null);

// Original intent used 1:1 mapping; we’ll treat folders with <2 numbers as “invalid”
const hasEnoughStacks = (stacks: number[]) => stacks.length >= 2;

const constellationKey = (folder: string): string => {
  const stacks = getStacksLoose(folder);
  if (!hasEnoughStacks(stacks)) return ""; // sentinel; handled in sorter
  return stacks.slice().sort((a, b) => a - b).join("-");
};

const btnStack = (folder: string): number | null => {
  const s = getStacksLoose(folder);
  return s[0] ?? null;
};

const rotate = <T,>(arr: T[]): T[] => (arr.length ? [...arr.slice(-1), ...arr.slice(0, -1)] : arr);

/* --------------------------------------------------------------- */
/*  Helpers                                                        */
/* --------------------------------------------------------------- */
const compareNumArraysLex = (a: number[], b: number[]) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};

/* Tag helpers – we only care about FT / HU for sorting */
type MetaLite = { tags?: string[]; seats?: number } | null | undefined;

const hasTag = (meta: MetaLite, tag: string): boolean => {
  const tags = meta?.tags;
  if (!tags) return false;
  const u = tag.toUpperCase();
  return tags.some((t) => t.toUpperCase() === u);
};

const isFTMeta = (meta: MetaLite): boolean => hasTag(meta, "FT");

const isHUMeta = (meta: MetaLite): boolean => {
  if (hasTag(meta, "HU")) return true;
  if (meta?.seats === 2) return true;
  return false;
};

/* -------------------------------------------------- */
/*  Emit *all* matches for a rotation (stable)        */
/* -------------------------------------------------- */
const orderGroupByRotation = (group: string[]): string[] => {
  if (group.length === 1) return group.slice();

  // If any folder in the group is malformed, just alpha sort the whole group.
  if (group.some((f) => !hasEnoughStacks(getStacksLoose(f)))) {
    return group.slice().sort();
  }

  const seen = new Set<string>();
  const ordered: string[] = [];

  // start at folder with smallest BTN stack
  const start = group.reduce((min, f) => {
    const bMin = btnStack(min)!;
    const bF = btnStack(f)!;
    return bF < bMin ? f : min;
  }, group[0]);

  let currentStacks = getStacksLoose(start);
  const seats = currentStacks.length;

  while (ordered.length < group.length) {
    const matches = group
      .filter((f) => !seen.has(f))
      .filter((f) => {
        const s = getStacksLoose(f);
        if (s.length !== currentStacks.length) return false;
        return s.every((bb, i) => bb === currentStacks[i]);
      })
      .sort(); // deterministic within same rotation

    for (const f of matches) {
      seen.add(f);
      ordered.push(f);
    }

    // rotate target pattern and continue
    currentStacks = rotate(currentStacks);

    // bail-out guard if nothing matched this pattern
    if (matches.length === 0) {
      let rotated = 1;
      while (
        rotated < seats &&
        !group.some(
          (f) =>
            !seen.has(f) &&
            getStacksLoose(f).every((bb, i) => bb === currentStacks[i])
        )
      ) {
        currentStacks = rotate(currentStacks);
        rotated++;
      }
      if (rotated === seats) break;
    }
  }

  // defensive sweep
  group
    .filter((f) => !seen.has(f))
    .sort()
    .forEach((f) => ordered.push(f));

  return ordered;
};

/* --------------------------------------------------------------- */
/*  Public sort                                                    */
/* --------------------------------------------------------------- */
/**
 * Global ordering:
 *   1) Non-FT multiway constellations
 *   2) FT multiway constellations
 *   3) HU constellations (2-handed)
 *
 * Within each bucket:
 *   - Seats DESC, then constellation ASC.
 *   - Within each constellation: rotation ordering.
 *
 * Malformed folders (with <2 numeric chunks) are pushed to the end alphabetically.
 */
export const sortFoldersLikeSelector = (
  folders: string[],
  metaByFolder?: Record<string, MetaLite>
): string[] => {
  // Split into valid vs invalid first to avoid crashes.
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const f of folders) {
    const stacks = getStacksLoose(f);
    if (hasEnoughStacks(stacks)) {
      valid.push(f);
    } else {
      console.warn(
        "[folderSort] Skipping malformed folder for stack-based sort (needs >=2 numeric chunks):",
        f
      );
      invalid.push(f);
    }
  }

  type Bucket = {
    key: string;
    group: string[];
    allSame: boolean;
    seats: number;
    constellation: number[]; // sorted asc
    kind: "nonFT" | "FT" | "HU";
  };

  // Bucketize valid only
  const byKey = new Map<string, Bucket>();
  for (const f of valid) {
    const key = constellationKey(f);
    const sortedStacks = getStacksLoose(f).slice().sort((a, b) => a - b);
    const seats = sortedStacks.length;

    const meta = metaByFolder?.[f];
    const isHU = isHUMeta(meta) || isHUSimFolder(f);
    const isFT = isFTMeta(meta);

    const kind: Bucket["kind"] = isHU ? "HU" : isFT ? "FT" : "nonFT";

    let b = byKey.get(key);
    if (!b) {
      b = {
        key,
        group: [],
        allSame: isAllSameFolder(f),
        seats,
        constellation: sortedStacks,
        kind,
      };
      byKey.set(key, b);
    }
    b.group.push(f);
    if (!isAllSameFolder(f)) b.allSame = false;
  }

  const allBuckets = Array.from(byKey.values());

  const bucketRank = (b: Bucket): number => {
    // nonFT (0) -> FT (1) -> HU (2)
    if (b.kind === "HU") return 2;
    if (b.kind === "FT") return 1;
    return 0; // nonFT
  };

  const cmpBuckets = (a: Bucket, b: Bucket) => {
    const br = bucketRank(a) - bucketRank(b);
    if (br !== 0) return br;

    if (a.seats !== b.seats) return b.seats - a.seats; // seats DESC
    return compareNumArraysLex(a.constellation, b.constellation);
  };

  // Phase A: All-Same with seats >= 3
  const phaseA = allBuckets
    .filter((b) => b.allSame && b.seats >= 3)
    .sort(cmpBuckets);

  // Phase B: everything else
  const usedKeys = new Set(phaseA.map((b) => b.key));
  const phaseB = allBuckets
    .filter((b) => !usedKeys.has(b.key))
    .sort(cmpBuckets);

  // Flatten with rotation ordering
  const out: string[] = [];
  for (const b of [...phaseA, ...phaseB]) {
    out.push(...orderGroupByRotation(b.group));
  }

  // Append invalids alpha so they still show up
  invalid.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [...out, ...invalid];
};
