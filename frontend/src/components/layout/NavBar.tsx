// src/components/NavBar.tsx
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Grid3x3, History, Wallet, type LucideIcon } from "lucide-react";
import { useAppNavigate } from "@/components/layout/RouteProgress";
import { preloadRoute } from "@/lib/routePreload";
import AccountMenu from "@/components/layout/AccountMenu";
import { useCurrentTier } from "@/context/TierContext";
import { openBillingPortal } from "@/lib/stripe/openBillingPortal";

import {
  getAuth,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { signInWithGoogle } from "@/lib/firebase";
import { DEV_AUTH_BYPASS, useDevAuthUser, devAuthSignIn, devAuthSignOut } from "@/lib/devAuth";
import { useAuthGate } from "@/context/AuthGate";
import useBodyScrollLock from "@/hooks/useBodyScrollLock";

// Routes that require a signed-in user. Navigating here while signed out opens
// the login modal on the current page and defers the route change until success.
const PROTECTED_PATHS = new Set<string>(["/bankroll"]);

export interface NavBarProps {
  toggleViewMode?: () => void;
  isSpiralView?: boolean;
}

/* ───────────────────────── Tier pill ───────────────────────── */
const TierPill: React.FC<{ tier: "free" | "plus" | "pro"; loading?: boolean }> = ({
  tier,
  loading = false,
}) => {
  if (loading) {
    return (
      <span
        className="inline-block h-5 w-16 rounded-full bg-white/10 animate-pulse"
        aria-hidden="true"
      />
    );
  }

  const label = tier === "pro" ? "Pro" : tier === "plus" ? "Plus" : "Free";
  const cls =
    tier === "pro"
      ? "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30"
      : tier === "plus"
      ? "bg-amber-400/15 text-amber-300 ring-amber-400/30"
      : "bg-white/10 text-slate-300 ring-white/15";

  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ${cls}`}
      title={`Current tier: ${label}`}
      data-tier={tier}
    >
      {label}
    </span>
  );
};

const NavBar: React.FC<NavBarProps> = () => {
  const navigate = useAppNavigate();
  const { pathname } = useLocation();
  const section = pathname.startsWith("/bankroll")
    ? "bankroll"
    : pathname.startsWith("/hand-history")
    ? "handHistory"
    : pathname.startsWith("/solutions") || pathname.startsWith("/solver")
    ? "solver"
    : "";

  const [menuOpen, setMenuOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const { tier, loading } = useCurrentTier();

  // The active tool's pill slides between segments; layoutId is document-global,
  // so scope it to this bar.
  const reduceMotion = useReducedMotion();
  const pillGroupId = useId();

  // Desktop brand placement: keep the logo at the toolbar's true center, but slide
  // it left just enough to never overlap the right-aligned tool buttons.
  const navRowRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const toolsRowRef = useRef<HTMLDivElement>(null);
  const [brandLeft, setBrandLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const row = navRowRef.current;
      const brand = brandRef.current;
      const tools = toolsRowRef.current;
      if (!row || !brand || !tools) return;
      // Only clamp when the desktop brand is the one on screen; below `lg` it is
      // display:none and the separate centered mobile brand is showing instead.
      if (getComputedStyle(brand).display === "none") {
        setBrandLeft(null);
        return;
      }
      const rowRect = row.getBoundingClientRect();
      const toolsLeft = tools.getBoundingClientRect().left - rowRect.left;
      const brandW = brand.offsetWidth;
      const gap = 16; // breathing room between brand and tools
      const trueCenter = rowRect.width / 2;
      const maxCenter = toolsLeft - gap - brandW / 2;
      const center = Math.min(trueCenter, maxCenter);
      setBrandLeft(Math.max(0, center - brandW / 2));
    };
    // compute() forces layout (getComputedStyle + getBoundingClientRect), so
    // coalesce bursts of resize/observer callbacks into one run per frame.
    let frame = 0;
    const scheduleCompute = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    };
    compute();
    const ro = new ResizeObserver(scheduleCompute);
    if (navRowRef.current) ro.observe(navRowRef.current);
    window.addEventListener("resize", scheduleCompute);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", scheduleCompute);
    };
  }, []);

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    return onAuthStateChanged(auth, (u) => setFirebaseUser(u));
  }, []);

  // In dev bypass the dummy auth is authoritative (so the navbar matches the rest
  // of the app, which clears/ignores any real session); otherwise the real user.
  const devUser = useDevAuthUser();
  const user = DEV_AUTH_BYPASS ? devUser : firebaseUser;

  const handleLogin = async () => {
    if (DEV_AUTH_BYPASS) {
      devAuthSignIn();
      setMenuOpen(false);
      return;
    }
    // Shared helper so this picks popup vs redirect the same way the login
    // modal does (redirect on touch devices - see lib/firebase.ts).
    await signInWithGoogle();
    setMenuOpen(false);
  };

  const handleLogout = async () => {
    if (DEV_AUTH_BYPASS) {
      devAuthSignOut();
      // Best-effort: also clear any real Firebase session so logout is complete.
      signOut(getAuth()).catch(() => {});
      setMenuOpen(false);
      return;
    }
    const auth = getAuth();
    await signOut(auth);
    setMenuOpen(false);
  };

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);

  const handleManageBilling = async () => {
    try {
      setBillingBusy(true);
      await openBillingPortal();
    } finally {
      setBillingBusy(false);
    }
  };

  useBodyScrollLock(menuOpen);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => modalRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [menuOpen]);

  const { requireAuth } = useAuthGate();

  const go = (path: string) => {
    // Protected routes go through the auth gate: it navigates when signed in, or
    // opens the login modal here (redirecting after login) when signed out.
    if (PROTECTED_PATHS.has(path)) requireAuth(path);
    else navigate(path);
  };

  // The Course and Equity Calculator pages stay routable by URL, but no longer
  // earn navbar slots — the bar carries only the core tools.
  const tools: { label: string; path: string; section: string; Icon: LucideIcon }[] = [
    { label: "Bankroll Tracker", path: "/bankroll", section: "bankroll", Icon: Wallet },
    { label: "Hand Histories", path: "/hand-history", section: "handHistory", Icon: History },
    { label: "Solutions", path: "/solutions", section: "solver", Icon: Grid3x3 },
  ];

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-80 border-b border-white/10 bg-slate-950/75 backdrop-blur-xl"
      aria-busy={loading || undefined}
    >
      <div
        ref={navRowRef}
        className="relative w-full px-2 sm:px-6 lg:px-4 flex items-center justify-between h-12"
      >
        {/* left: hamburger */}
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            openMenu();
          }}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" stroke="currentColor" fill="none">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        {/* brand (desktop): absolutely centered, but nudged left by JS when the
            tools would otherwise overlap it (see the layout effect above) */}
        <a
          ref={brandRef}
          href="/"
          className="hidden lg:flex absolute top-1/2 -translate-y-1/2 items-center gap-2 select-none whitespace-nowrap"
          style={{ left: brandLeft ?? undefined }}
          aria-label="HoldemTools Home"
        >
          <img
            src="/logo-icon.png"
            alt=""
            className="h-[24px] w-[24px] block select-none"
            draggable="false"
            style={{
              WebkitTransform: "translateZ(0)",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              WebkitMaskImage: "-webkit-radial-gradient(white, black)",
            }}
          />
          <span className="text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap">
            HoldemTools
          </span>
        </a>

        {/* center brand (mobile / tablet) */}
        <div className="lg:hidden absolute inset-0 flex items-center justify-center pointer-events-none">
          <a
            href="/"
            className="pointer-events-auto inline-flex items-center gap-2 select-none"
            aria-label="HoldemTools Home"
          >
            <img
              src="/logo-icon.png"
              alt=""
              className="h-[24px] w-[24px] block select-none"
              draggable="false"
              style={{
                WebkitTransform: "translateZ(0)",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                WebkitMaskImage: "-webkit-radial-gradient(white, black)",
              }}
            />
            <span className="text-sm sm:text-base font-semibold tracking-tight text-slate-100">
              HoldemTools
            </span>
          </a>
        </div>

        {/* right: the tool switcher — one segmented pill group at every width,
            so a tool is always one tap away and the current one is legible
            without hovering. Labels collapse to icons on narrow screens; the
            aria-label carries the name either way. */}
        <div
          ref={toolsRowRef}
          className="relative z-10 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.07] p-[3px]"
          role="group"
          aria-label="Tools"
        >
          {tools.map((t) => {
            const active = section === t.section;
            return (
              <button
                key={t.path}
                // Warm the route's chunk on intent, so the click usually has
                // nothing left to download. Navigation itself is on pointerdown,
                // so hover/focus is the only window we get.
                onPointerEnter={() => preloadRoute(t.path)}
                onFocus={() => preloadRoute(t.path)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  go(t.path);
                }}
                aria-label={t.label}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:px-3 ${
                  active
                    ? "text-emerald-950"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {/* The sliding pill lives behind the content, so the label and
                    icon keep one color transition rather than two. */}
                {active && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : `${pillGroupId}-tool-pill`}
                    className="absolute inset-0 rounded-full bg-emerald-400 shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <t.Icon
                  size={16}
                  strokeWidth={2.2}
                  className="relative z-10 shrink-0"
                  aria-hidden="true"
                />
                {/* Labels appear only at `lg`, the same breakpoint where the
                    brand stops being absolutely centered. Showing them earlier
                    widens this group into the centered brand, which has no JS
                    clamp to get out of the way (the desktop brand does). */}
                <span className="relative z-10 hidden whitespace-nowrap lg:inline">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1200]">
            <div
              className="absolute inset-0 bg-black/50"
              onPointerDown={() => closeMenu()}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="navbar-modal-title"
              ref={modalRef}
              tabIndex={-1}
              className="absolute top-14 left-2 sm:left-4 w-64 sm:w-72 max-w-[90vw] rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-xl outline-none z-[1210]"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 id="navbar-modal-title" className="text-base font-semibold text-slate-100">
                  Menu
                </h2>
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    closeMenu();
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close menu"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <div className="px-4 py-3 space-y-2">
                {/* Account row + tier + manage button */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <AccountMenu
                      isLoggedIn={!!user}
                      displayLabel={!!user}
                      userEmail={user?.email ?? null}
                      onLogin={handleLogin}
                      onLogout={handleLogout}
                    />
                    <TierPill tier={tier} loading={loading} />
                  </div>

                  {user && tier !== "free" && (
                    <button
                      type="button"
                      onClick={handleManageBilling}
                      disabled={billingBusy}
                      className="w-full inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      {billingBusy ? "Opening billing…" : "Manage subscription"}
                    </button>
                  )}

                  {user && tier === "free" && (
                    <p className="text-[11px] text-slate-400">
                      You're on the <strong>Free</strong> tier. Open a locked sim to upgrade to
                      Plus or Pro.
                    </p>
                  )}
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
