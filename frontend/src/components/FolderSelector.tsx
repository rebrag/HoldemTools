// src/FolderSelector.tsx
import React, { useState, useEffect } from "react";

interface FolderSelectorProps {
  folders: string[];
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
}

const FolderSelector: React.FC<FolderSelectorProps> = ({
  folders,
  onFolderSelect,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [filteredFolders, setFilteredFolders] = useState<string[]>(folders);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  useEffect(() => {
    if (inputValue === "") {
      setFilteredFolders(folders);
      setHighlightedIndex(-1);
    } else {
      const filtered = folders.filter((folder) =>
        folder.replace(/_/g, " ").toLowerCase().includes(inputValue.toLowerCase())
      );
      setFilteredFolders(filtered);
      setHighlightedIndex(filtered.length > 0 ? 0 : -1); // Default highlight first item
    }
  }, [inputValue, folders]);

  const handleSelect = (folder: string) => {
    setInputValue("");
    onFolderSelect(folder);
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

  return (
    <div className="flex justify-center h-10vh">
      <div className="select-none relative w-full max-w-lg">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setShowDropdown(false)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Search Preflop Sims..."
          className="shadow-md hover:bg-blue-100 w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring focus:border-blue-300"
        />
        {showDropdown && (
          <ul className="absolute z-10 w-full bg-white border rounded-2xl border-gray-300 mt-1 max-h-90 overflow-auto scrollbar-none">
            {filteredFolders.map((folder, index) => {
              const displayName = getDisplayFolderName(folder);
              return (
                <li
                  key={index}
                  onClick={() => handleSelect(folder)}
                  className={`px-4 py-2 cursor-pointer hover:bg-gray-100 border-b last:border-0 ${
                    highlightedIndex === index ? "bg-blue-200" : ""
                  }`}
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
