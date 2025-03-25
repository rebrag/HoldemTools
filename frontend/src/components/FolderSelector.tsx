// src/FolderSelector.tsx
import React, { useState, useEffect } from "react";

interface FolderSelectorProps {
  folders: string[];
  currentFolder: string; // New prop for current folder
  onFolderSelect: (folder: string) => void;
}

// Helper to convert underscores to spaces and, if applicable, display a friendlier name.
function getDisplayFolderName(folder: string): string {
  const parts = folder.split("_");
  if (parts.length === 0) return folder;

  const firstMatch = parts[0].match(/^(\d+)/);
  if (!firstMatch) {
    return folder.replace(/_/g, " ");
  }

  const firstNum = firstMatch[1];
  const allSame = parts.every((part) => {
    const match = part.match(/^(\d+)/);
    return match && match[1] === firstNum;
  });

  if (allSame) {
    return `${firstNum}bb All`;
  }

  return folder.replace(/_/g, " ");
}

// Helper to determine if a folder qualifies as "allSame"
function isAllSameFolder(folder: string): boolean {
  const parts = folder.split("_");
  if (parts.length === 0) return false;
  const firstMatch = parts[0].match(/^(\d+)/);
  if (!firstMatch) return false;
  const firstNum = firstMatch[1];
  return parts.every((part) => {
    const match = part.match(/^(\d+)/);
    return match && match[1] === firstNum;
  });
}

// Helper to render folder name with bold matching text
const highlightMatch = (folder: string, query: string): React.ReactNode => {
  if (!query) return <>{folder}</>;

  const lowerFolder = folder.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const startIndex = lowerFolder.indexOf(lowerQuery);

  if (startIndex === -1) return <>{folder}</>;

  const beforeMatch = folder.slice(0, startIndex);
  const matchText = folder.slice(startIndex, startIndex + query.length);
  const afterMatch = folder.slice(startIndex + query.length);

  return (
    <>
      {beforeMatch}
      <strong className="font-bold">{matchText}</strong>
      {afterMatch}
    </>
  );
};

const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [filteredFolders, setFilteredFolders] = useState<string[]>(folders);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  // State to track if the viewport width is less than 440
  const [isSmallViewport, setIsSmallViewport] = useState(window.innerWidth < 440);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallViewport(window.innerWidth < 440);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (inputValue === "") {
      // Sort folders by length, but later we sort allSame folders on top
      setFilteredFolders([...folders].sort((a, b) => a.length - b.length));
      setHighlightedIndex(-1);
    } else {
      const filtered = folders
        .filter((folder) =>
          folder.replace(/_/g, " ").toLowerCase().includes(inputValue.toLowerCase())
        )
        .sort((a, b) => {
          // Prioritize folders that are allSame
          const aAllSame = isAllSameFolder(a);
          const bAllSame = isAllSameFolder(b);
          if (aAllSame && !bAllSame) return -1;
          if (!aAllSame && bAllSame) return 1;
          // Otherwise, sort by string length
          return a.length - b.length;
        });

      setFilteredFolders(filtered);
      setHighlightedIndex(filtered.length > 0 ? 0 : -1); // Default highlight first item
    }
  }, [inputValue, folders]);

  const handleSelect = (folder: string) => {
    // Only update if the new folder is different from the current folder
    if (folder !== currentFolder) {
      setInputValue("");
      onFolderSelect(folder);
    }
    setShowDropdown(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setShowDropdown(false);
    } else if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredFolders.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredFolders.length - 1
      );
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < filteredFolders.length) {
        handleSelect(filteredFolders[highlightedIndex]);
      }
    } else if (e.key !== "Escape") {
      setShowDropdown(true);
    }
  };

  // Toggle the dropdown visibility when the arrow is clicked.
  const toggleDropdown = () => {
    setShowDropdown((prev) => !prev);
  };

  return (
    <div className="flex justify-center h-10vh">
      <div className="select-none relative w-full max-w-lg">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setShowDropdown(false)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder="Search Preflop Sims..."
            className="shadow-md hover:bg-blue-100 w-full px-4 pr-10 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring focus:border-blue-300"
          />
          <button
            onMouseDown={(e) => e.preventDefault()} // Prevents input blur on button click
            onClick={toggleDropdown}
            className="absolute inset-y-0 right-0 flex items-center px-3 focus:outline-none"
            type="button"
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
        {showDropdown && (
          <ul className="absolute z-10 w-full bg-white border rounded-2xl border-gray-300 mt-1 max-h-90 overflow-auto scrollbar-none">
            {filteredFolders.map((folder, index) => {
              const displayName = getDisplayFolderName(folder);
              return (
                <li
                  key={index}
                  onMouseDown={() => handleSelect(folder)}
                  className={`px-4 py-2 cursor-pointer hover:bg-gray-100 border-b last:border-0 ${
                    highlightedIndex === index ? "bg-blue-200" : ""
                  } ${isSmallViewport ? "text-xs" : ""}`}
                >
                  {highlightMatch(displayName, inputValue)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FolderSelector;
