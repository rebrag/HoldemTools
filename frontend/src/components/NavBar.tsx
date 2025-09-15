import React, { useEffect, useRef, useState } from "react";
import FolderSelector from "./FolderSelector";
import AccountMenu from "./AccountMenu";

export interface NavBarProps {
  section: "solver" | "equity";
  folders: string[];
  currentFolder: string;
  onFolderSelect: (folder: string) => void;
  goToEquity: () => void;
  goToSolver: () => void;
  startWalkthrough: () => void;
  toggleViewMode?: () => void;
  isSpiralView?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({
  section,
  folders,
  currentFolder,
  onFolderSelect,
  goToEquity,
  goToSolver,
  startWalkthrough,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    if (menuOpen) {
      document.addEventListener("keydown", onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      setTimeout(() => modalRef.current?.focus(), 0);
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
      };
    }
  }, [menuOpen]);

  const pillClass =
    section === "solver"
      ? "bg-indigo-600 text-white"
      : "bg-emerald-600 text-white";

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-40">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center justify-between h-12">
        {/* hamburger */}
        <button
          onClick={openMenu}
          className="text-gray-600 hover:text-gray-800 focus:outline-none p-1 rounded-md hover:bg-gray-100"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" stroke="currentColor" fill="none">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* center block */}
        <div className="flex-grow mx-4">
          {section === "solver" ? (
            <FolderSelector
              folders={folders}
              currentFolder={currentFolder}
              onFolderSelect={onFolderSelect}
            />
          ) : (
            // keep height so the layout doesn't jump when switching sections
            <div className="h-6" aria-hidden="true" />
          )}
        </div>

        {/* right: section bubble */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${pillClass}`}
            aria-label={`Current section: ${section}`}
            title={`Current section: ${section}`}
          >
            {section === "solver" ? "Solver" : "Equity"}
          </span>
        </div>
      </div>

      {/* left-anchored compact modal */}
      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeMenu} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="navbar-modal-title"
            ref={modalRef}
            tabIndex={-1}
            className="absolute top-14 left-2 sm:left-4 w-64 sm:w-72 max-w-[90vw] rounded-2xl bg-white shadow-2xl outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 id="navbar-modal-title" className="text-base font-semibold text-gray-900">
                Menu
              </h2>
              <button
                onClick={closeMenu}
                className="p-2 rounded-md hover:bg-gray-100 text-gray-600"
                aria-label="Close menu"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                        d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 py-3 space-y-2">
              <button
                type="button"
                onClick={() => { window.location.hash = "equity"; goToEquity(); closeMenu(); }}
                className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
              >
                Equity Calculator
              </button>
              <button
                type="button"
                onClick={() => { window.location.hash = "solver"; goToSolver(); closeMenu(); }}
                className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
              >
                Solver
              </button>

              <button
                onClick={() => { startWalkthrough(); closeMenu(); }}
                className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
              >
                Walkthrough
              </button>

              <div className="pt-2 border-t">
                <AccountMenu />
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default NavBar;
