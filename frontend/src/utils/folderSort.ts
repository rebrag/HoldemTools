/* --------------------------------------------------------------- */
/*  Flags                                                          */
/* --------------------------------------------------------------- */
export const isAllSameFolder = (folder: string): boolean => {
  const parts = folder.split("_");
  const first = parts[0]?.match(/^(\d+)/)?.[1];
  return !!first && parts.every((p) => p.match(/^(\d+)/)?.[1] === first);
};

export const isHUSimFolder = (folder: string): boolean => {
  const parts = folder.split("_");
  return parts.length === 2 && /^\d+/.test(parts[0]);
};

/* --------------------------------------------------------------- */
/*  Stack utilities                                                */
/* --------------------------------------------------------------- */
const getStacks = (folder: string): number[] =>
  folder.split("_").map((c) => parseInt(c.match(/^(\d+)/)![1], 10));

const constellationKey = (folder: string): string =>
  getStacks(folder).slice().sort((a, b) => a - b).join("-");

const btnStack = (folder: string): number => getStacks(folder)[0];

const rotate = <T,>(arr: T[]): T[] => [...arr.slice(-1), ...arr.slice(0, -1)];

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

/* -------------------------------------------------- */
/*  Emit *all* matches for a rotation (stable)        */
/* -------------------------------------------------- */
const orderGroupByRotation = (group: string[]): string[] => {
  if (group.length === 1) return group.slice();

  const seen = new Set<string>();
  const ordered: string[] = [];

  // start at folder with smallest BTN stack
  let currentStacks = getStacks(
    group.reduce((min, f) => (btnStack(f) < btnStack(min) ? f : min), group[0])
  );
  const seats = currentStacks.length; // 2–9

  while (ordered.length < group.length) {
    const matches = group
      .filter((f) => !seen.has(f))
      .filter((f) => {
        const s = getStacks(f);
        return s.every((bb, i) => bb === currentStacks[i]);
      })
      .sort(); // deterministic within same rotation

    for (const f of matches) {
      seen.add(f);
      ordered.push(f);
    }

    currentStacks = rotate(currentStacks);

    if (matches.length === 0) {
      let rotated = 1;
      while (
        rotated < seats &&
        !group.some(
          (f) =>
            !seen.has(f) &&
            getStacks(f).every((bb, i) => bb === currentStacks[i])
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
 *   A) All-Same constellations with seats >= 3: by seats DESC, then constellation ASC
 *   B) Remaining constellations (mixed + any HU/all-same): by seats DESC, then constellation ASC
 *   - Within each constellation bucket: rotation ordering
 */
export const sortFoldersLikeSelector = (folders: string[]): string[] => {
  type Bucket = {
    key: string;
    group: string[];
    allSame: boolean;
    seats: number;
    constellation: number[]; // sorted asc
  };

  // Bucketize by constellation (sorted multiset of stacks)
  const byKey = new Map<string, Bucket>();
  for (const f of folders) {
    const key = constellationKey(f);
    let b = byKey.get(key);
    if (!b) {
      const sortedStacks = getStacks(f).slice().sort((a, b) => a - b);
      b = {
        key,
        group: [],
        allSame: isAllSameFolder(f),
        seats: sortedStacks.length,
        constellation: sortedStacks,
      };
      byKey.set(key, b);
    }
    b.group.push(f);
    // If any member isn't all-same, the whole constellation is considered mixed
    if (!isAllSameFolder(f)) b.allSame = false;
  }

  const allBuckets = Array.from(byKey.values());

  // Phase A: All-Same with seats >= 3
  const phaseA = allBuckets
    .filter((b) => b.allSame && b.seats >= 3)
    .sort((a, b) => {
      if (a.seats !== b.seats) return b.seats - a.seats; // seats DESC
      return compareNumArraysLex(a.constellation, b.constellation);
    });

  // Phase B: everything else (mixed + any HU/all-same)
  const usedKeys = new Set(phaseA.map((b) => b.key));
  const phaseB = allBuckets
    .filter((b) => !usedKeys.has(b.key))
    .sort((a, b) => {
      if (a.seats !== b.seats) return b.seats - a.seats; // seats DESC
      return compareNumArraysLex(a.constellation, b.constellation);
    });

  // Flatten with rotation ordering inside each bucket
  const out: string[] = [];
  for (const b of [...phaseA, ...phaseB]) {
    out.push(...orderGroupByRotation(b.group));
  }
  return out;
};
