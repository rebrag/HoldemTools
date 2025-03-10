// src/components/NavBar.tsx
import React, { useState } from "react";
import FolderSelector from "./FolderSelector";
import RandomizeButton from "./RandomizeButton";
import AccountMenu from "./AccountMenu";

interface NavBarProps {
  randomFillEnabled: boolean;
  toggleRandomization: () => void;
  folders: string[];
  onFolderSelect: (folder: string) => void;
}

const NavBar: React.FC<NavBarProps> = ({
  randomFillEnabled,
  toggleRandomization,
  folders,
  onFolderSelect,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    console.log("Hamburger clicked!"); // Debug log
    setMenuOpen((prev) => !prev);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-50">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center justify-between h-12">
        {/* Left: Hamburger Icon */}
        <div className="flex items-center">
          <button
            onClick={toggleMenu}
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>

        {/* Center: FolderSelector */}
        <div className="flex-grow mx-4">
          <div className="w-full max-w-lg mx-auto">
            <FolderSelector folders={folders} onFolderSelect={onFolderSelect} />
          </div>
        </div>

        {/* Right: Reserved space for additional content on larger screens */}
        <div className="flex items-center"></div>
      </div>

      {/* Dropdown menu: shown when hamburger is clicked */}
      {menuOpen && (
        <div className="bg-white shadow-md">
          <div className="px-2 pt-2 pb-3 space-y-2">
            <RandomizeButton
              randomFillEnabled={randomFillEnabled}
              setRandomFillEnabled={toggleRandomization}
            />
            <AccountMenu />
          </div>
        </div>
      )}
    </nav>
  );
};

export default NavBar;
