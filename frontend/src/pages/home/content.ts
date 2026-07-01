/**
 * Shared homepage content + per-tool theming, consumed by both design
 * variants (Aurora Bento and Kinetic Arcade). Keeping this here means the two
 * designs never drift on copy or routing - they only differ in presentation.
 */

export type ToolId = "solutions" | "equity" | "bankroll" | "course";
export type PreviewId = "range" | "equity" | "bankroll" | "course";

export interface ToolMeta {
  id: ToolId;
  route: string;
  preview: PreviewId;
  kicker: string;
  name: string;
  tagline: string;
  description: string;
  bullets: string[];
  cta: string;
  /** "r,g,b" for cursor spotlight / glow tints. */
  accentRgb: string;
  accentHex: string;
  /** Tailwind gradient used on headings/labels for this tool. */
  gradient: string;
}

export const HERO = {
  kicker: "Hold'em study, streamlined",
  titleLead: "Study solutions.",
  titleAccent: "Train equity. Track everything.",
  sub: "A focused suite for serious players: solver-grade preflop ranges in an interactive grid, fast equity drills, an honest bankroll tracker, and a course that builds your poker-math foundation - all in one place.",
  primaryCta: "Open Solutions",
  secondaryCta: "Run an equity drill",
} as const;

export const STATS: { label: string; value: string }[] = [
  { label: "Preflop combos", value: "169" },
  { label: "Solver spots", value: "Deep" },
  { label: "ICM final tables", value: "Rare data" },
  { label: "Course sections", value: "9" },
];

export const MARQUEE_ITEMS: string[] = [
  "ChipEV shove ranges",
  "Final-table ICM",
  "Equity intuition drills",
  "Bankroll trendlines",
  "Pot odds & EV",
  "Interactive standard grid",
  "Mixed-strategy frequencies",
  "Session variance",
];

export const TOOLS: ToolMeta[] = [
  {
    id: "solutions",
    route: "/solutions",
    preview: "range",
    kicker: "Solutions",
    name: "The standard grid, reimagined",
    tagline: "Solver-grade preflop, actually fun to use.",
    description:
      "Scroll through positions and stack depths with solver-approved ranges - including ChipEV shove charts and final-table ICM spots that are hard to find anywhere else.",
    bullets: ["ChipEV shoves", "Final-table ICM", "Mixed frequencies"],
    cta: "Open Solutions",
    accentRgb: "16,185,129",
    accentHex: "#10b981",
    gradient: "from-emerald-300 via-emerald-400 to-teal-300",
  },
  {
    id: "equity",
    route: "/equity",
    preview: "equity",
    kicker: "Equity",
    name: "Train your gut with real numbers",
    tagline: "Feel what's actually ahead.",
    description:
      "Run quick comparisons across games and player counts. Build the instinct for how hands run against each other before the money goes in.",
    bullets: ["2–4 players", "Instant equities", "Real matchups"],
    cta: "Open Equity",
    accentRgb: "56,189,248",
    accentHex: "#38bdf8",
    gradient: "from-sky-300 via-cyan-300 to-blue-300",
  },
  {
    id: "bankroll",
    route: "/bankroll",
    preview: "bankroll",
    kicker: "Bankroll",
    name: "Know your edge, track your swings",
    tagline: "A tracker that keeps you honest.",
    description:
      "Log sessions and watch the trendline tell you whether your strategy is actually working - win rate, variance, and cumulative profit at a glance.",
    bullets: ["Session logging", "Win-rate trend", "Variance view"],
    cta: "Open Bankroll",
    accentRgb: "167,139,250",
    accentHex: "#a78bfa",
    gradient: "from-violet-300 via-purple-300 to-fuchsia-300",
  },
  {
    id: "course",
    route: "/course",
    preview: "course",
    kicker: "Course",
    name: "Master the fundamentals",
    tagline: "Learn the why behind every decision.",
    description:
      "A 9-section guided course covering poker math, pot odds, equity, and GTO thinking - with quizzes that lock the concepts in.",
    bullets: ["9 sections", "Poker math", "Quizzes"],
    cta: "Start the Course",
    accentRgb: "251,191,36",
    accentHex: "#fbbf24",
    gradient: "from-amber-300 via-yellow-300 to-orange-300",
  },
];

export const toolById = (id: ToolId): ToolMeta =>
  TOOLS.find((t) => t.id === id) as ToolMeta;
