// src/hooks/useKeyboardShortcuts.ts
import { useEffect, useCallback } from "react";
import { sortFoldersLikeSelector } from "../utils/folderSort";

/* ------------------------------------------------------------------ */
/*  Hook options                                                      */
/* ------------------------------------------------------------------ */
type Options = {
  onToggleRandom: () => void;
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
};

/* ------------------------------------------------------------------ */
/*  useKeyboardShortcuts                                              */
/* ------------------------------------------------------------------ */
const useKeyboardShortcuts = ({
  onToggleRandom,
  folders,
  currentFolder,
  onFolderSelect,
}: Options) => {
  /* memoised sorted list */
  const sorted = useCallback(
  () => sortFoldersLikeSelector(folders),
  [folders]
);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";

      /* ---------- R : toggle random fill -------------------- */
      if (e.key === "r" && !typing) {
        onToggleRandom();
        return;
      }

      /* ---------- ↓ / ↑ : cycle folders --------------------- */
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !typing) {
        const list = sorted();
        const idx  = list.indexOf(currentFolder);
        if (idx === -1) return; /* safety */

        const delta = e.key === "ArrowDown" ? +1 : -1;
        const next  = list[(idx + delta + list.length) % list.length];
        onFolderSelect(next);

        e.preventDefault(); /* stop page scroll */
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleRandom, sorted, currentFolder, onFolderSelect]);
};

export default useKeyboardShortcuts;
