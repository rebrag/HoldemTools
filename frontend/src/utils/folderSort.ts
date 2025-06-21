/* --------------------------------------------------------------- */
/*  Helpers                                                        */
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

/**
 * Sort folders exactly like FolderSelector:
 *   • non-HU before HU  
 *   • “all-same” folders first, **ascending bb** (30bb All → 100bb All)  
 *   • remaining folders by shorter name first
 */
export const sortFoldersLikeSelector = (folders: string[]) =>
  [...folders].sort((a, b) => {
    /* --- HU sims last -------------------------------------- */
    const aHU = isHUSimFolder(a);
    const bHU = isHUSimFolder(b);
    if (aHU !== bHU) return aHU ? 1 : -1;

    /* --- All-same block first, ascending bb ---------------- */
    const aAll = isAllSameFolder(a);
    const bAll = isAllSameFolder(b);
    if (aAll && bAll) {
      const na = parseInt(a.match(/^(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.match(/^(\d+)/)?.[1] ?? "0", 10);
      return na - nb;                           // 30bb All before 100bb All
    }
    if (aAll !== bAll) return aAll ? -1 : 1;

    /* --- fallback: shorter first --------------------------- */
    return a.length - b.length;
  });
