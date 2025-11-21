import React from "react";

type HomepageProps = {
  onGoToSolutions: () => void;
  onGoToEquity: () => void;
  onGoToBankroll: () => void;
};

type ToolId = "solutions" | "equity" | "bankroll";

const tools: {
  id: ToolId;
  name: string;
  label: string;
  description: string;
  cta: string;
  imageSrc: string;
}[] = [
  {
    id: "solutions",
    name: "Solutions",
    label: "Preflop Solutions",
    description:
      "Explore solver-approved preflop ranges with an interactive standard grid, positions, and stack depths.",
    imageSrc: "/preview-solutions.png",
    cta: "Open Solutions",
  },
  {
    id: "equity",
    name: "Equity Calculator",
    label: "Equity Calculator",
    description:
      "Quickly compare hand equities for different games and 2-4 players to sharpen your intuition in common spots.",
    imageSrc: "/preview-equity.png",
    cta: "Open Equity Calculator",
  },
  {
    id: "bankroll",
    name: "Bankroll Tracker",
    label: "Bankroll Tracker",
    description:
      "Track live & online sessions, visualize winrate over time, and stay on top of your bankroll health.",
    imageSrc: "/preview-bankroll.png",
    cta: "Open Bankroll Tracker",
  },
];

const Homepage: React.FC<HomepageProps> = ({
  onGoToSolutions,
  onGoToEquity,
  onGoToBankroll,
}) => {
  const handlers: Record<ToolId, () => void> = {
    solutions: onGoToSolutions,
    equity: onGoToEquity,
    bankroll: onGoToBankroll,
  };

  return (
    <main className="min-h-[calc(100vh-3rem)]">
      <div className="relative">
        {/* Poker background that always fits width, keeps aspect ratio, and fades at bottom */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10">
          <img
            src="/poker-hero-bg.png"
            alt="Anime-style poker table background"
            className="w-full h-auto opacity-25"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)",
              maskImage:
                "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)",
            }}
          />
        </div>

        {/* Page content */}
        <div className="mx-auto flex max-w-6xl flex-col px-4 pb-16 pt-12 sm:px-6 lg:px-8 lg:pt-16">
          {/* Hero with poker-table glow */}
          <section className="relative flex justify-center text-center">
            {/* Poker felt glow */}
            <div className="pointer-events-none absolute inset-x-0 -top-6 -bottom-10 flex justify-center">
              <div className="h-40 w-[min(640px,100%)] rounded-full bg-gradient-to-r from-emerald-800 via-emerald-700 to-emerald-800 opacity-70 blur-2xl" />
            </div>

            {/* Badge card */}
            <div className="relative inline-flex max-w-3xl flex-col items-center rounded-3xl bg-slate-900/95 px-5 py-4 shadow-2xl ring-1 ring-slate-800/80 sm:px-7 sm:py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                Study &amp; master Texas Hold&apos;em
              </p>

              <h1 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl md:text-4xl">
                Welcome to <span className="text-emerald-300">HoldemTools</span>
              </h1>

              <p className="mt-2 max-w-xl text-pretty text-xs text-slate-300 sm:text-sm">
                A focused suite of tools to help you build rock-solid
                ranges, sharpen equity intuition, and keep your bankroll under
                control.
              </p>

              {/* Poker flavour line */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-[11px] font-medium text-slate-100">
                  <span className="flex items-center gap-1 text-base">
                    <span className="text-slate-100">♠</span>
                    <span className="text-red-400">♥</span>
                    <span className="text-red-400">♦</span>
                    <span className="text-slate-100">♣</span>
                  </span>
                  <span className="hidden sm:inline">
                    Built by a poker pro for poker players.
                  </span>
                  <span className="sm:hidden">
                    Poker tools for serious players.
                  </span>
                </span>
                <span className="hidden text-[11px] text-slate-300/80 sm:inline">
                  Cash-game ranges, equity work, and bankroll tracking in one
                  place.
                </span>
              </div>
            </div>
          </section>

          {/* Tools grid */}
          <section className="mt-10 sm:mt-12">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={handlers[tool.id]}
                  className="group relative flex flex-col overflow-hidden rounded-2xl bg-white/95 text-left shadow-sm ring-1 ring-slate-200/90 backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {/* Faded screenshot backdrop inside card */}
                  <div className="pointer-events-none absolute inset-0 opacity-70">
                    <div className="absolute -right-4 -bottom-6 h-40 w-48 overflow-hidden rounded-xl border border-slate-200/60 bg-slate-100/80 shadow-sm sm:h-44 sm:w-56">
                      <img
                        src={tool.imageSrc}
                        alt={`${tool.name} preview`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-tr from-white via-white/90 to-white/40" />
                  </div>

                  {/* Content */}
                  <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        {tool.label}
                      </p>
                      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 sm:text-xl">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-[13px] text-emerald-700 ring-1 ring-emerald-100">
                          {tool.id === "solutions" && "🧩"}
                          {tool.id === "equity" && "♠"}
                          {tool.id === "bankroll" && "💰"}
                        </span>
                        <span>{tool.name}</span>
                      </h2>
                      <p className="text-sm leading-relaxed text-slate-600">
                        {tool.description}
                      </p>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Instant access
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:text-emerald-800">
                        {tool.cta}
                        <svg
                          className="h-3.5 w-3.5 -translate-y-[0.5px] transition-transform group-hover:translate-x-0.5"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 3.5L10 8L5 12.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Future tools blurb */}
          <section className="mt-10 sm:mt-12">
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-4 text-center text-xs text-slate-500 backdrop-blur-sm sm:px-6 sm:py-5 sm:text-sm">
              HoldemTools is growing. More modules like postflop explorers,
              training drills, and session review tools will plug into this same
              dashboard over time.
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

export default Homepage;
