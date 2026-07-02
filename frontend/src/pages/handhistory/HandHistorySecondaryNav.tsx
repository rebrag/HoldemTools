import React from "react";
import { motion } from "framer-motion";

interface Props {
  /** Open the paste-in-text editor ("Enter HH"). */
  onEnter: () => void;
  /** Go to the visual hand recorder ("Create HH"). */
  onCreate: () => void;
}

/**
 * Secondary navbar for the Hand History page. Pinned just under the main
 * NavBar (which is fixed at h-12 / 48px), it carries the section title and the
 * two entry-point buttons. Behind it sits a self-contained coded poker graphic
 * (felt gradient + fanned cards + suit watermark) — no image asset, so it
 * stays lightweight and theme-consistent with AuroraBackground.
 */
const HandHistorySecondaryNav: React.FC<Props> = ({ onEnter, onCreate }) => {
  return (
    <div className="sticky top-12 z-30 -mx-4 mb-5 overflow-hidden rounded-b-2xl border-b border-emerald-400/30 shadow-lg shadow-emerald-950/30 sm:mx-0 sm:rounded-2xl sm:border">
      {/* ── Coded poker banner background ────────────────────────────── */}
      <PokerFeltBanner />

      {/* ── Foreground content ───────────────────────────────────────── */}
      <div className="relative flex items-center justify-between gap-3 px-5 py-3.5">
        <div className="min-w-0">
          <h1 className="bg-gradient-to-r from-emerald-200 via-teal-100 to-emerald-300 bg-clip-text text-lg font-extrabold tracking-tight text-transparent drop-shadow-sm sm:text-xl">
            Hand Histories
          </h1>
          <p className="mt-0.5 truncate text-[11px] font-medium text-emerald-100/70">
            Your played hands, all in one place
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={onEnter}
            whileTap={{ scale: 0.96 }}
            className="inline-flex items-center rounded-full border border-emerald-300/60 bg-emerald-950/40 px-4 py-1.5 text-sm font-semibold text-emerald-100 backdrop-blur-sm transition-colors hover:bg-emerald-900/60"
          >
            Enter HH
          </motion.button>
          <motion.button
            type="button"
            onClick={onCreate}
            whileTap={{ scale: 0.96 }}
            className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/40 transition-colors hover:bg-emerald-400"
          >
            Create HH
          </motion.button>
        </div>
      </div>
    </div>
  );
};

/**
 * The decorative backdrop: a poker-felt gradient with a fanned hand of cards,
 * a chip ring, and a large translucent suit watermark, drawn inline as SVG so
 * it scales crisply and needs no asset. Sits under the nav content; a dark
 * vignette keeps the foreground text readable.
 */
const PokerFeltBanner: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0">
    {/* felt base */}
    <div className="absolute inset-0 bg-gradient-to-br from-emerald-800 via-emerald-900 to-slate-950" />
    {/* radial felt sheen */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_140%_at_20%_-20%,rgba(16,185,129,0.45),transparent_60%)]" />

    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 400 120"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="hhCardFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="hhCardBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#9f1239" />
        </linearGradient>
      </defs>

      {/* giant suit watermark, right side */}
      <text
        x="332"
        y="104"
        fontSize="140"
        textAnchor="middle"
        fill="rgba(255,255,255,0.05)"
        fontFamily="serif"
      >
        ♠
      </text>
      <text
        x="384"
        y="70"
        fontSize="70"
        textAnchor="middle"
        fill="rgba(251,113,133,0.08)"
        fontFamily="serif"
      >
        ♥
      </text>

      {/* fanned hand of cards, left side */}
      <g transform="translate(30 70)" opacity="0.9">
        <g transform="rotate(-22)">
          <rect x="-16" y="-24" width="32" height="46" rx="4" fill="url(#hhCardBack)" stroke="rgba(0,0,0,0.25)" />
        </g>
        <g transform="rotate(-8) translate(14 -4)">
          <rect x="-16" y="-24" width="32" height="46" rx="4" fill="url(#hhCardFace)" stroke="rgba(0,0,0,0.2)" />
          <text x="-10" y="-8" fontSize="12" fill="#dc2626" fontFamily="sans-serif" fontWeight="700">A</text>
          <text x="0" y="8" fontSize="18" fill="#dc2626" textAnchor="middle" fontFamily="serif">♥</text>
        </g>
        <g transform="rotate(8) translate(28 -2)">
          <rect x="-16" y="-24" width="32" height="46" rx="4" fill="url(#hhCardFace)" stroke="rgba(0,0,0,0.2)" />
          <text x="-10" y="-8" fontSize="12" fill="#111827" fontFamily="sans-serif" fontWeight="700">K</text>
          <text x="0" y="8" fontSize="18" fill="#111827" textAnchor="middle" fontFamily="serif">♠</text>
        </g>
      </g>

      {/* chip ring accents */}
      <circle cx="150" cy="30" r="9" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" strokeDasharray="4 4" />
      <circle cx="230" cy="96" r="6" fill="none" stroke="rgba(16,185,129,0.35)" strokeWidth="2.5" strokeDasharray="3 3" />
    </svg>

    {/* readability vignette */}
    <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/30 to-transparent" />
  </div>
);

export default HandHistorySecondaryNav;
