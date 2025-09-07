/* --------------------------------------------------------------- */
/*  Flags                                                          */
/* --------------------------------------------------------------- */
export const isAllSameFolder = (folder: string): boolean => {
  const parts = folder.split("_");
  const first = parts[0]?.match(/^(\d+)/)?.[1];
  return !!first && parts.every(p => p.match(/^(\d+)/)?.[1] === first);
};

export const isHUSimFolder = (folder: string): boolean => {
  const parts = folder.split("_");
  return parts.length === 2 && /^\d+/.test(parts[0]);
};

/* --------------------------------------------------------------- */
/*  Stack utilities                                                */
/* --------------------------------------------------------------- */
const getStacks = (folder: string): number[] =>
  folder.split("_").map(c => parseInt(c.match(/^(\d+)/)![1], 10));

const constellationKey = (folder: string): string =>
  getStacks(folder).slice().sort((a, b) => a - b).join("-");

const btnStack = (folder: string): number => getStacks(folder)[0];

const rotate = <T,>(arr: T[]): T[] => [...arr.slice(-1), ...arr.slice(0, -1)];

/* -------------------------------------------------- */
/*  NEW — emit *all* matches for a rotation           */
/* -------------------------------------------------- */
const orderGroupByRotation = (group: string[]): string[] => {
  if (group.length === 1) return group.slice();

  const seen = new Set<string>();
  const ordered: string[] = [];

  // start hand = smallest BTN stack
  let currentStacks = getStacks(
    group.reduce((min, f) => (btnStack(f) < btnStack(min) ? f : min), group[0])
  );
  const seats = currentStacks.length;        // 2–8

  while (ordered.length < group.length) {
    /* gather ALL folders whose stacks === currentStacks */
    const matches = group
      .filter(f => !seen.has(f))
      .filter(f => {
        const s = getStacks(f);
        return s.every((bb, i) => bb === currentStacks[i]);
      })
      .sort();                               // deterministic order

    matches.forEach(f => {
      seen.add(f);
      ordered.push(f);
    });

    /* rotate once; if we've done a full lap with no additions, stop */
    currentStacks = rotate(currentStacks);
    if (matches.length === 0) {
      // safety guard — after a full lap with no new folders, break
      let rotated = 1;
      while (
        rotated < seats &&
        !group.some(
          f =>
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

   /* -------- NEW: append any stragglers (duplicates etc.) -------- */
  group
    .filter(f => !seen.has(f))
    .sort()
    .forEach(f => ordered.push(f));          // <- ensures 100 % coverage

  return ordered;
};

/* --------------------------------------------------------------- */
/*  Public sort                                                    */
/* --------------------------------------------------------------- */
export const sortFoldersLikeSelector = (folders: string[]): string[] => {
  const nonHU = folders.filter(f => !isHUSimFolder(f));
  const HU    = folders.filter(isHUSimFolder);

  /* bucket by constellation key */
  const buckets: Record<string, string[]> = {};
  nonHU.forEach(f => {
    (buckets[constellationKey(f)] ??= []).push(f);
  });

  const orderedNonHU: string[] = [];

  Object.values(buckets)
  .sort((ga, gb) => {
    const aAll = isAllSameFolder(ga[0]);
    const bAll = isAllSameFolder(gb[0]);

    // Keep "all-same" buckets before mixed as you already had
    if (aAll !== bAll) return aAll ? -1 : 1;

    if (aAll && bAll) {
      // NEW: primary sort = number of players (desc)
      const pa = getStacks(ga[0]).length;
      const pb = getStacks(gb[0]).length;
      if (pa !== pb) return pb - pa;

      // Tie-break: stack size (asc), same as before
      const na = parseInt(ga[0].match(/^(\d+)/)?.[1] || "0", 10);
      const nb = parseInt(gb[0].match(/^(\d+)/)?.[1] || "0", 10);
      return na - nb;
    }

    // non "all-same": keep your existing heuristic
    return ga[0].length - gb[0].length;
  })
  .forEach(g => orderedNonHU.push(...orderGroupByRotation(g)));


  const orderedHU = HU.sort((a, b) => a.length - b.length);

  return [...orderedNonHU, ...orderedHU];
};
