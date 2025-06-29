import React, { useState } from "react";
import FolderSelector   from "./FolderSelector";
import AccountMenu      from "./AccountMenu";

/* ─────────────── props ─────────────── */
export interface NavBarProps {
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  toggleViewMode: () => void;
  isSpiralView: boolean;
  startWalkthrough: () => void;
}

/* ───────────── component ───────────── */
const NavBar: React.FC<NavBarProps> = ({
  folders,
  currentFolder,
  onFolderSelect,
  // toggleViewMode,
  // isSpiralView,
  startWalkthrough,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = () => setMenuOpen(prev => !prev);

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-50">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center justify-between h-12">

        {/* hamburger */}
        <button onClick={toggleMenu} className="text-gray-500 hover:text-gray-700 focus:outline-none">
          <svg className="w-6 h-6" viewBox="0 0 24 24" stroke="currentColor" fill="none">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* centre block */}
        <div className="flex-grow mx-4">
          <FolderSelector
            folders={folders}
            currentFolder={currentFolder}
            onFolderSelect={onFolderSelect}
          />
        </div>

        {/* right side reserved */}
        <div />
      </div>

      {/* dropdown after hamburger */}
      {menuOpen && (
        <div className="bg-white shadow-md">
          <div className="px-2 pt-2 pb-3 space-y-2">
            <button
              onClick={() => { startWalkthrough(); setMenuOpen(false); }}
              className="block w-full text-left px-4 py-2 rounded-md text-gray-700 hover:bg-gray-100"
            >
              Walkthrough
            </button>

            <AccountMenu />
          </div>
        </div>
      )}
    </nav>
  );
};

export default NavBar;
