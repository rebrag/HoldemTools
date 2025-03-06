// src/components/NavBar.tsx
import React from "react";
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
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-12 md:h-16">
        {/* Left: Responsive Randomize Button */}
        <div className="flex items-center">
          <div className="hidden md:block">
            <RandomizeButton
              randomFillEnabled={randomFillEnabled}
              setRandomFillEnabled={toggleRandomization}
            />
          </div>
          <div className="block md:hidden">
            <RandomizeButton
              randomFillEnabled={randomFillEnabled}
              setRandomFillEnabled={toggleRandomization}
              square
            />
          </div>
        </div>

        {/* Center: FolderSelector as a search bar */}
        <div className="flex-grow mx-4">
          <div className="w-full max-w-lg mx-auto">
            <FolderSelector folders={folders} onFolderSelect={onFolderSelect} />
          </div>
        </div>

        {/* Right: Account Menu */}
        <div className="flex items-center">
          <AccountMenu />
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
