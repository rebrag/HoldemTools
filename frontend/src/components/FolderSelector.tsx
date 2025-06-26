// src/FolderSelector.tsx
import React, { useState, useEffect } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { logUserAction } from "../logEvent";          // ← adjust if your path differs
import {
  sortFoldersLikeSelector,
  // isAllSameFolder,     // you still need these locally
  // isHUSimFolder
} from "../utils/folderSort";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
interface FolderSelectorProps {
  folders: string[];
  currentFolder: string;                // currently-selected folder
  onFolderSelect: (folder: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Display-name helpers                                              */
/* ------------------------------------------------------------------ */
//   "25LJ_25HJ_25CO_6BTN_25SB_13BB"  →  "6bb HU" / "25bb All" / readable
function getDisplayFolderName(folder: string): string {
  const parts = folder.split("_");
  if (!parts.length) return folder;

  if (parts.length === 2) {
    const firstNum = parts[0].match(/^(\d+)/)?.[1];
    return firstNum ? `${firstNum}bb HU` : folder.replace(/_/g, " ");
  }

  const firstNum = parts[0].match(/^(\d+)/)?.[1];
  const allSame = firstNum
    ? parts.every(p => p.match(/^(\d+)/)?.[1] === firstNum)
    : false;
  return allSame ? `${firstNum}bb All` : folder.replace(/_/g, " ");
}

// const isAllSameFolder = (folder: string): boolean => {
//   const parts = folder.split("_");
//   const firstNum = parts[0].match(/^(\d+)/)?.[1];
//   return !!firstNum && parts.every(p => p.match(/^(\d+)/)?.[1] === firstNum);
// };

// const isHUSimFolder = (folder: string): boolean => {
//   const parts = folder.split("_");
//   return parts.length === 2 && /^\d+/.test(parts[0]);
// };

/* ------------------------------------------------------------------ */
/*  Search / highlight helpers                                        */
/* ------------------------------------------------------------------ */
const highlightMatch = (text: string, query: string): React.ReactNode => {
  if (!query) return <>{text}</>;

  const isNumber = /^\d+$/.test(query.trim());
  let idx = -1;
  const len = query.length;

  if (isNumber) {
    /* find “<query>” as standalone numeric prefix of any chunk         *
     *   e.g. query = "5"  → matches "5BB" but *not* "15UTG1"           */
    const re = new RegExp(`(^|[^0-9])(${query})(?![0-9])`, "i");
    const m = text.match(re);
    if (m && typeof m.index === "number") {
      idx = m.index + m[1].length;   // skip past the look-behind group
    }
  } else {
    idx = text.toLowerCase().indexOf(query.toLowerCase());
  }

  if (idx === -1) return <>{text}</>;           // nothing to highlight

  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-bold">{text.slice(idx, idx + len)}</strong>
      {text.slice(idx + len)}
    </>
  );
};

/** Matches folders according to “exact numeric prefix” rule. */
const folderMatchesQuery = (folder: string, query: string): boolean => {
  if (!query) return true;

  const trimmed = query.trim();
  const isNumber = /^\d+$/.test(trimmed);

  if (isNumber) {
    // want *exactly* <query> as the leading digits of any chunk
    return folder.split("_").some(chunk => {
      const num = chunk.match(/^(\d+)/)?.[1];
      return num === trimmed;
    });
  }

  // non-numeric → fallback substring search
  return folder
    .replace(/_/g, " ")
    .toLowerCase()
    .includes(trimmed.toLowerCase());
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
}) => {
  const [user] = useAuthState(auth);

  const [inputValue, setInputValue] = useState("");
  const [filteredFolders, setFilteredFolders] = useState<string[]>(folders);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSmallViewport, setIsSmallViewport] = useState(
    typeof window !== "undefined" && window.innerWidth < 440
  );

  /* -------- viewport listener ------------------------------------- */
  useEffect(() => {
    const handleResize = () => setIsSmallViewport(window.innerWidth < 440);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /* -------- search / sort ----------------------------------------- */
  useEffect(() => {
    console.log(folders)
    const sorted = sortFoldersLikeSelector(
      folders.filter(f => folderMatchesQuery(f, inputValue))
    );
    setFilteredFolders(sorted);
    setHighlightedIndex(sorted.length ? 0 : -1);
  }, [inputValue, folders]);

  /* -------- selection --------------------------------------------- */
  const handleSelect = (folder: string) => {
    if (folder !== currentFolder) {
      setInputValue("");
      onFolderSelect(folder);

      if (user) {
        logUserAction(user.email ?? user.uid, "Opened Folder", folder);
      }
    }
    setShowDropdown(false);
    setHighlightedIndex(-1);
  };

  /* -------- keyboard nav ------------------------------------------ */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setShowDropdown(false);
    } else if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setHighlightedIndex(prev =>
        prev < filteredFolders.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(prev =>
        prev > 0 ? prev - 1 : filteredFolders.length - 1
      );
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < filteredFolders.length) {
        handleSelect(filteredFolders[highlightedIndex]);
      }
    } else {
      setShowDropdown(true); // start showing dropdown on any other key
    }
  };

  return (
    <div
      data-intro-target="folder-selector"
      className="flex justify-center h-10vh"
    >
      <div className="select-none relative w-full max-w-lg">
        {/* input + arrow */}
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onFocus={() => setShowDropdown(false)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder="Search Preflop Sims..."
            className="shadow-md hover:bg-blue-100 w-full px-4 pr-10 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring focus:border-blue-300"
          />
          <button
            type="button"
            onMouseDown={e => e.preventDefault()} // keep focus
            onClick={() => setShowDropdown(prev => !prev)}
            className="absolute inset-y-0 right-0 flex items-center px-3 focus:outline-none"
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
        {showDropdown && (
          <ul className="absolute z-10 w-full bg-white border rounded-2xl border-gray-300 mt-1 max-h-150 overflow-auto scrollbar-none">
            {filteredFolders.map((folder, idx) => (
              <li
                key={folder}
                onMouseDown={() => handleSelect(folder)}
                className={`px-4 py-1 cursor-pointer hover:bg-gray-100 border-b last:border-0 ${
                  highlightedIndex === idx ? "bg-blue-200" : ""
                } ${isSmallViewport ? "text-xs" : ""}`}
              >
                {highlightMatch(getDisplayFolderName(folder), inputValue)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FolderSelector;
