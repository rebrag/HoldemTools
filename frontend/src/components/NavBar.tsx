// src/components/NavBar.tsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountMenu from "./AccountMenu";

export interface NavBarProps {
  section: "solver" | "equity";
  goToEquity: () => void;   // should push "/equity" and set state
  goToSolver: () => void;   // should push "/solver" and set state
  toggleViewMode?: () => void;
  isSpiralView?: boolean;
}

const NavBar: React.FC<NavBarProps> = ({ section, goToEquity, goToSolver }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => modalRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(id);
    };
  }, [menuOpen]);

  // close Tools on outside click / escape
  useEffect(() => {
    const onDocDown = (e: PointerEvent) => {
      if (!toolsOpen) return;
      const t = e.target as Node | null;
      if (toolsBtnRef.current?.contains(t as Node)) return;
      if (toolsMenuRef.current?.contains(t as Node)) return;
      setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setToolsOpen(false); };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  // Safety net: ensure URL has the correct path even if parent handler forgot
  const pushPathIfNeeded = (path: "/solver" | "/equity") => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  };

  const goEquity = () => { goToEquity(); pushPathIfNeeded("/equity"); setToolsOpen(false); };
  const goSolver = () => { goToSolver(); pushPathIfNeeded("/solver"); setToolsOpen(false); };

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white shadow-md z-80">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center justify-between h-12">
        {/* left: hamburger */}
        <button
          onPointerDown={(e) => { e.preventDefault(); openMenu(); }}
          className="text-gray-600 hover:text-gray-800 focus:outline-none p-1 rounded-md hover:bg-gray-100"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" stroke="currentColor" fill="none">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* center spacer */}
        <div className="flex-grow mx-4">
          <div className="h-6" aria-hidden="true" />
        </div>

        {/* right: Tools dropdown */}
        <div className="relative">
          <button
            ref={toolsBtnRef}
            onPointerDown={(e) => { e.preventDefault(); setToolsOpen((v) => !v); }}
            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 shadow"
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
          >
            Tools
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.188l3.71-3.957a.75.75 0 111.08 1.04l-4.24 4.52a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>

          {toolsOpen && (
            <div
              ref={toolsMenuRef}
              className="absolute right-0 mt-2 w-44 rounded-lg bg-white shadow-lg ring-1 ring-black/5 z-50"
            >
              <div className="py-1">
                <button
                  onPointerDown={(e) => { e.preventDefault(); goEquity(); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-100"
                  aria-current={section === "equity" ? "page" : undefined}
                >
                  Equity Calculator
                </button>
                <button
                  onPointerDown={(e) => { e.preventDefault(); goSolver(); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-100"
                  aria-current={section === "solver" ? "page" : undefined}
                >
                  Solver
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal rendered via portal so it always overlays everything */}
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1200]">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50"
              onPointerDown={() => closeMenu()}
              aria-hidden="true"
            />
            {/* Panel */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="navbar-modal-title"
              ref={modalRef}
              tabIndex={-1}
              className="absolute top-14 left-2 sm:left-4 w-64 sm:w-72 max-w-[90vw] rounded-2xl bg-white shadow-2xl outline-none z-[1210]"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h2 id="navbar-modal-title" className="text-base font-semibold text-gray-900">
                  Menu
                </h2>
                <button
                  onPointerDown={(e) => { e.preventDefault(); closeMenu(); }}
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
                  onPointerDown={(e) => { e.preventDefault(); goEquity(); closeMenu(); }}
                  className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
                  aria-current={section === "equity" ? "page" : undefined}
                >
                  Equity Calculator
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); goSolver(); closeMenu(); }}
                  className="w-full text-left px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
                  aria-current={section === "solver" ? "page" : undefined}
                >
                  Solver
                </button>

                <div className="pt-2 border-t">
                  <AccountMenu />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </nav>
  );
};

export default NavBar;
