// src/FolderSelector.tsx
import React, { useState, useEffect } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase"; // Using the same Firebase config as in LoginSignup
import { logUserAction } from "..//logEvent"; // Adjust the path based on your project structure

interface FolderSelectorProps {
  folders: string[];
  currentFolder: string; // Current selected folder name
  onFolderSelect: (folder: string) => void;
}

// Helper to convert underscores to spaces and display friendlier names.
function getDisplayFolderName(folder: string): string {
  const parts = folder.split("_");
  if (parts.length === 0) return folder;

  // When exactly two parts, check for a leading number in the first part.
  if (parts.length === 2) {
    const firstMatch = parts[0].match(/^(\d+)/);
    if (firstMatch) {
      const firstNum = firstMatch[1];
      return `${firstNum}bb HU`;
    }
    return folder.replace(/_/g, " ");
  }

  // For more than two parts, if every part starts with the same number then use special text
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

// Helper: Check if folder qualifies as "allSame"
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

// Helper: Check if folder is a HU simulation folder (exactly two parts and first part starts with digits)
function isHUSimFolder(folder: string): boolean {
  const parts = folder.split("_");
  if (parts.length !== 2) return false;
  return /^\d+/.test(parts[0]);
}

// Highlight matching text in the folder name
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
  // Get the current authenticated user from Firebase
  const [user] = useAuthState(auth);
  
  const [inputValue, setInputValue] = useState("");
  const [filteredFolders, setFilteredFolders] = useState<string[]>(folders);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  
  // Track if the viewport is small
  const [isSmallViewport, setIsSmallViewport] = useState(window.innerWidth < 440);
  useEffect(() => {
    const handleResize = () => setIsSmallViewport(window.innerWidth < 440);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Update the filtered folders as the search input changes
  useEffect(() => {
    if (inputValue === "") {
      // Sort folders by length; if there are "allSame" folders, they will be sorted together later
      setFilteredFolders([...folders].sort((a, b) => a.length - b.length));
      setHighlightedIndex(-1);
    } else {
      const filtered = folders
        .filter((folder) =>
          folder.replace(/_/g, " ").toLowerCase().includes(inputValue.toLowerCase())
        )
        .sort((a, b) => {
          // Send HU simulations to the bottom
          const aHU = isHUSimFolder(a);
          const bHU = isHUSimFolder(b);
          if (aHU && !bHU) return 1;
          if (!aHU && bHU) return -1;
          
          // Prioritize folders that are "allSame"
          const aAllSame = isAllSameFolder(a);
          const bAllSame = isAllSameFolder(b);
          if (aAllSame && !bAllSame) return -1;
          if (!aAllSame && bAllSame) return 1;
          
          // Otherwise, sort by string length
          return a.length - b.length;
        });
      setFilteredFolders(filtered);
      setHighlightedIndex(filtered.length > 0 ? 0 : -1);
    }
  }, [inputValue, folders]);

  // Handle folder selection; also log the user action if a folder is selected
  const handleSelect = (folder: string) => {
    if (folder !== currentFolder) {
      setInputValue("");
      onFolderSelect(folder);
      // Log the action if the user is authenticated
      if (user) {
        //console.log("Admin UID:", user.uid);
        // Using email if available, otherwise the UID
        logUserAction(user.email ?? user.uid, "Opened Folder", folder);
      }
    }
    setShowDropdown(false);
    setHighlightedIndex(-1);
  };

  // Keyboard handling for navigation in the dropdown
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

  // Toggle dropdown visibility on click of the arrow button
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
            onMouseDown={(e) => e.preventDefault()} // Prevent input blur on click
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
