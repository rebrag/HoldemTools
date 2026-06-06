import { JSX, useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  type Variants,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";

type HomepageProps = {
  onGoToSolutions: () => void;
  onGoToEquity: () => void;
  onGoToBankroll: () => void;
};

type ToolId = "solutions" | "equity" | "bankroll";

type Tool = {
  id: ToolId;
  name: string;
  label: string;
  description: string;
  cta: string;
  imageSrc: string;
};

const tools: Tool[] = [
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

function getHandlers(p: HomepageProps): Record<ToolId, () => void> {
  return {
    solutions: p.onGoToSolutions,
    equity: p.onGoToEquity,
    bankroll: p.onGoToBankroll,
  };
}

const sectionVariants = (reduce: boolean): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: reduce
      ? { duration: 0.15 }
      : { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
});

const staggerVariants = (reduce: boolean): Variants => ({
  hidden: {},
  show: {
    transition: reduce ? { staggerChildren: 0 } : { staggerChildren: 0.08 },
  },
});

const itemVariants = (reduce: boolean): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: reduce
      ? { duration: 0.12 }
      : { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
});

type UseTypewriterParams = {
  text: string;
  start: boolean;
  speedMs: number;
};

function useTypewriter(params: UseTypewriterParams): string {
  const { text, start, speedMs } = params;
  const [out, setOut] = useState<string>("");
  const doneRef = useRef<boolean>(false);

  useEffect(() => {
    if (!start) return;
    if (doneRef.current) {
      setOut(text);
      return;
    }

    let i = 0;
    setOut("");

    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        doneRef.current = true;
        window.clearInterval(id);
      }
    }, speedMs);

    return () => window.clearInterval(id);
  }, [text, start, speedMs]);

  return out;
}

type LoopingPreviewVideoProps = {
  src: string;
  poster?: string;
  className?: string;
};

/**
 * Plays on loop when visible; pauses when off-screen.
 * Uses object-contain so the video is NEVER cropped.
 */
function LoopingPreviewVideo(props: LoopingPreviewVideoProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const tryPlay = async (): Promise<void> => {
      try {
        await el.play();
      } catch {
        // Ignore autoplay failures; we retry on intersection.
      }
    };

    void tryPlay();

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting) {
          void tryPlay();
        } else {
          el.pause();
        }
      },
      { threshold: 0.15 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full bg-slate-950/60">
      <video
        ref={videoRef}
        className={
          props.className ??
          "h-full w-full object-contain"
        }
        muted
        playsInline
        loop
        autoPlay
        preload="metadata"
        poster={props.poster}
      >
        <source src={props.src} type="video/mp4" />
      </video>

      {/* subtle inner border so letterboxing looks intentional */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 ring-1 ring-white/10"
      />
    </div>
  );
}

export default function Homepage(props: HomepageProps): JSX.Element {
  const handlers = useMemo(() => getHandlers(props), [props]);
  const reduceMotion = useReducedMotion();
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

  const { scrollYProgress } = useScroll();
  const glowY = useTransform(scrollYProgress, [0, 1], ["0px", "120px"]);
  const glowOpacity = useTransform(
    scrollYProgress,
    [0, 0.7, 1],
    [0.85, 0.55, 0.35],
  );

  const solutionsStageRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress: solutionsProgress } = useScroll({
    target: solutionsStageRef,
    offset: ["start end", "end start"],
  });

  const sScale = useTransform(
    solutionsProgress,
    [0.05, 0.35, 0.75],
    reduceMotion ? [1, 1, 1] : [0.94, 1.02, 1],
  );
  const sY = useTransform(
    solutionsProgress,
    [0, 0.6, 1],
    reduceMotion ? [0, 0, 0] : [26, 0, -10],
  );
  const sRotate = useTransform(
    solutionsProgress,
    [0, 0.45, 1],
    reduceMotion ? [0, 0, 0] : [-2.5, 0.8, 0],
  );
  const sVignetteOpacity = useTransform(
    solutionsProgress,
    [0, 0.4, 1],
    [0.55, 0.25, 0.15],
  );
  const sGlowOpacity = useTransform(
    solutionsProgress,
    [0, 0.35, 1],
    reduceMotion ? [0.25, 0.25, 0.25] : [0.12, 0.32, 0.18],
  );

  const heroA = "Study solutions. Train equity intuition. ";
  const heroB = "Track your sessions.";
  const heroSub =
    "HoldemTools is a focused suite for serious players: solver-grade preflop work in the interactive standard grid, quick equity drills, and a bankroll tracker that keeps you honest.";

  const [startTyping, setStartTyping] = useState<boolean>(false);

  useEffect(() => {
    if (reduceMotion) return;
    const t = window.setTimeout(() => setStartTyping(true), 180);
    return () => window.clearTimeout(t);
  }, [reduceMotion]);

  useEffect(() => {
    if (!API_BASE_URL) return;

    const WARM_KEY = "ht_sql_warmup_last_hit_v1";
    const now = Date.now();
    const last = Number(window.localStorage.getItem(WARM_KEY) ?? 0);
    const WARM_INTERVAL_MS = 55 * 60 * 1000;

    if (Number.isFinite(last) && now - last < WARM_INTERVAL_MS) return;

    window.localStorage.setItem(WARM_KEY, String(now));
    void fetch(`${API_BASE_URL}/api/warmup/sql`, {
      method: "GET",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      // Warm-up is best-effort and should never affect homepage UX.
    });
  }, [API_BASE_URL]);

  const typedA = useTypewriter({
    text: heroA,
    start: startTyping,
    speedMs: 18,
  });

  const typedB = useTypewriter({
    text: heroB,
    start: startTyping && typedA.length === heroA.length,
    speedMs: 18,
  });

  const typedSub = useTypewriter({
    text: heroSub,
    start:
      startTyping &&
      typedA.length === heroA.length &&
      typedB.length === heroB.length,
    speedMs: 10,
  });

  const solutionsVideoSrc = "/Solutions.mp4";
  const equityVideoSrc = "/Equity.mp4";
  const bankrollVideoSrc = "/Bankroll.mp4";

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-slate-950 text-slate-50">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <motion.div
          className="absolute inset-0"
          style={{
            translateY: reduceMotion ? "0px" : glowY,
            opacity: glowOpacity,
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.22),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(59,130,246,0.14),transparent_55%)]" />
        </motion.div>

        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.0),rgba(2,6,23,0.85),rgba(2,6,23,1))]" />

        <motion.div
          className="absolute inset-0 opacity-15"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.8 }}
        >
          <img
            src="/poker-hero-bg.png"
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
          />
        </motion.div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-14 sm:px-6 lg:px-8">
        <motion.section
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-emerald-500/10 sm:p-12"
          initial="hidden"
          animate="show"
          variants={sectionVariants(!!reduceMotion)}
        >
          <motion.div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.9 }}
          >
            <motion.div
              className="absolute -top-24 left-1/2 h-64 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl"
              whileHover={reduceMotion ? undefined : { scale: 1.03 }}
              transition={{ duration: 0.6 }}
            />
            <motion.div
              className="absolute -bottom-28 right-[-6rem] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl"
              style={{ translateY: reduceMotion ? "0px" : glowY }}
            />
          </motion.div>

          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Hold’em study, streamlined
            </p>

            <h1 className="mt-3 min-h-[3.25rem] text-balance text-4xl font-semibold tracking-tight sm:min-h-[4rem] sm:text-5xl">
              {reduceMotion ? (
                <>
                  Build ranges. Train equity.{" "}
                  <span className="text-emerald-300">Protect your bankroll.</span>
                </>
              ) : (
                <>
                  <span>{typedA}</span>
                  <span className="text-emerald-300">{typedB}</span>
                  <motion.span
                    aria-hidden="true"
                    className="ml-0.5 inline-block h-[1em] w-[0.55ch] align-[-0.12em] bg-emerald-300/80"
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                  />
                </>
              )}
            </h1>

            <p className="mt-4 min-h-[4.5rem] max-w-2xl text-pretty text-sm leading-relaxed text-slate-300 sm:min-h-[4.8rem] sm:text-base">
              {reduceMotion ? (
                <>
                  HoldemTools is a focused suite for serious players: solver-grade
                  preflop work in the interactive{" "}
                  <span className="text-slate-100">standard grid</span>, quick equity
                  drills, and a bankroll tracker that keeps you honest.
                </>
              ) : (
                <>
                  {typedSub.split("standard grid").map((part, idx, arr) => {
                    if (idx === arr.length - 1) return <span key={idx}>{part}</span>;
                    return (
                      <span key={idx}>
                        {part}
                        <span className="text-slate-100">standard grid</span>
                      </span>
                    );
                  })}
                </>
              )}
            </p>

            <motion.div
              className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
              variants={staggerVariants(!!reduceMotion)}
              initial="hidden"
              animate="show"
            >
              <motion.button
                type="button"
                onClick={handlers.solutions}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                variants={itemVariants(!!reduceMotion)}
                whileHover={reduceMotion ? undefined : { y: -1, scale: 1.01 }}
                whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                transition={{ duration: 0.2 }}
              >
                Start with Solutions
              </motion.button>

              <motion.button
                type="button"
                onClick={handlers.equity}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                variants={itemVariants(!!reduceMotion)}
                whileHover={reduceMotion ? undefined : { y: -1 }}
                whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                transition={{ duration: 0.2 }}
              >
                Run an Equity Drill
              </motion.button>

              <motion.div
                className="text-xs text-slate-400"
                variants={itemVariants(!!reduceMotion)}
              >
                No fluff. Fast workflows. Built for grinders.
              </motion.div>
            </motion.div>
          </div>
        </motion.section>

        {/* VALUE PROPS */}
        <motion.section
          className="mt-12 grid gap-4 sm:grid-cols-3"
          variants={staggerVariants(!!reduceMotion)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.25 }}
        >
          {[
            {
              title: "Solver-grade preflop",
              body: "Browse ranges by position and stack depth inside the standard grid.",
            },
            {
              title: "Equity intuition",
              body: "Compare hands in common scenarios for 2-4 players.",
            },
            {
              title: "Bankroll clarity",
              body: "Track sessions, and see your beautiful graph.",
            },
          ].map((x) => (
            <motion.div
              key={x.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
              variants={itemVariants(!!reduceMotion)}
              whileHover={reduceMotion ? undefined : { y: -2 }}
              transition={{ duration: 0.2 }}
            >
              <div className="text-sm font-semibold text-slate-100">{x.title}</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-300">
                {x.body}
              </div>
            </motion.div>
          ))}
        </motion.section>

        {/* WOW: SOLUTIONS STICKY SECTION */}
        <section className="mt-14">
          <div
            ref={solutionsStageRef}
            className="relative rounded-3xl border border-white/10 bg-white/5"
          >
            {/* <div className="h-[120vh] sm:h-[140vh]"> //EXPERIMENTAL STICKY SECTION
              <div className="sticky top-16"> */}
              <div>
                <div>

                <div className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-2">
                  <motion.div
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true, amount: 0.35 }}
                    variants={sectionVariants(!!reduceMotion)}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                      Solutions
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                      The standard grid, but actually fun to use.
                    </h2>
                    <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
                      Scroll through a premium preflop experience: positions,
                      stack depths, and solver-approved ranges — without the clunky
                      workflow.
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <motion.button
                        type="button"
                        onClick={handlers.solutions}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                        whileHover={reduceMotion ? undefined : { y: -1 }}
                        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                        transition={{ duration: 0.2 }}
                      >
                        Open Solutions <span aria-hidden="true">→</span>
                      </motion.button>

                      <span className="text-xs text-slate-400">
                        Built around fast study loops.
                      </span>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {[
                        { k: "ChipEV", v: "Many solutions for shoving ranges at different stack depths" },
                        { k: "Final Table", v: "Solutions for final table ICM preflop which are difficult to find elsewhere" },
                        // { k: "Cash", v: "Actions & frequencies" },
                        // { k: "Speed", v: "Instant navigation" },
                      ].map((x) => (
                        <div
                          key={x.k}
                          className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                        >
                          <div className="text-xs font-semibold text-slate-100">
                            {x.k}
                          </div>
                          <div className="mt-1 text-xs text-slate-300">{x.v}</div>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  <div className="relative">
                    <motion.div
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-8 rounded-[2rem] bg-emerald-500/20 blur-3xl"
                      style={{ opacity: sGlowOpacity }}
                    />

                    <motion.div
                      className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 shadow-2xl"
                      style={{
                        scale: sScale,
                        translateY: sY,
                        rotate: sRotate,
                      }}
                    >
                      {/* Add padding so contain-letterboxing looks intentional */}
                      <div className="p-2 sm:p-3">
                      <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/50 shadow-inner">
                        <div className="aspect-[1332/1114] w-full max-h-[900px]">
                          <LoopingPreviewVideo
                            src={solutionsVideoSrc}
                            poster="/preview-solutions.png"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      </div>
                    </div>


                      <motion.div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(2,6,23,0.0),rgba(2,6,23,0.65))]"
                        style={{ opacity: sVignetteOpacity }}
                      />
                    </motion.div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-slate-950/80" />
          </div>
        </section>

        {/* FEATURE ROWS (remaining) */}
        <section className="mt-10 space-y-10">
          {[
            {
              eyebrow: "Equity",
              title: "Train your gut with real numbers.",
              body: "Run quick comparisons across games and player counts. Improve the feel for what’s actually ahead.",
              src: equityVideoSrc,
              poster: "/preview-equity.png",
              onClick: handlers.equity,
              cta: "Open Equity",
              reverse: true,
            },
            {
              eyebrow: "Bankroll",
              title: "Know your edge, track your swings.",
              body: "Session logging + trendlines that tell you whether your strategy is working.",
              src: bankrollVideoSrc,
              poster: "/preview-bankroll.png",
              onClick: handlers.bankroll,
              cta: "Open Bankroll",
              reverse: false,
            },
          ].map((row) => (
            <motion.div
              key={row.eyebrow}
              className={`grid items-center gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8 lg:grid-cols-2 ${
                row.reverse ? "lg:[&>*:first-child]:order-2" : ""
              }`}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.22 }}
              variants={sectionVariants(!!reduceMotion)}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                  {row.eyebrow}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {row.title}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
                  {row.body}
                </p>

                <motion.button
                  type="button"
                  onClick={row.onClick}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  whileHover={reduceMotion ? undefined : { y: -1 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                  transition={{ duration: 0.2 }}
                >
                  {row.cta}
                  <span aria-hidden="true">→</span>
                </motion.button>
              </div>

              <motion.div
                className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={
                  reduceMotion
                    ? { duration: 0.12 }
                    : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
                }
                whileHover={reduceMotion ? undefined : { scale: 1.01 }}
              >
                <div className="p-2 sm:p-3">
                <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/50 shadow-inner">
                  <div className="aspect-[1332/1114] w-full max-h-[900px]">
                    <LoopingPreviewVideo
                      src={row.src}
                      poster={row.poster}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              </div>

                <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-slate-950/40 via-transparent to-transparent" />
              </motion.div>
            </motion.div>
          ))}
        </section>

        {/* TOOL CARDS */}
        <motion.section
          className="mt-14"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={sectionVariants(!!reduceMotion)}
        >
          <h3 className="text-lg font-semibold text-slate-100">
            Jump in anywhere
          </h3>

          <motion.div
            className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
            variants={staggerVariants(!!reduceMotion)}
          >
            {tools.map((tool) => (
              <motion.button
                key={tool.id}
                type="button"
                onClick={handlers[tool.id]}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                variants={itemVariants(!!reduceMotion)}
                whileHover={reduceMotion ? undefined : { y: -4 }}
                whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                transition={{ duration: 0.2 }}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  {tool.label}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-lg font-semibold">{tool.name}</div>
                  <motion.div
                    className="text-slate-300"
                    aria-hidden="true"
                    whileHover={reduceMotion ? undefined : { x: 2 }}
                  >
                    →
                  </motion.div>
                </div>
                <div className="mt-2 text-sm leading-relaxed text-slate-300">
                  {tool.description}
                </div>
              </motion.button>
            ))}
          </motion.div>
        </motion.section>

        {/* FOOTER CTA */}
        <motion.section
          className="mt-14 rounded-3xl border border-white/10 bg-white/5 p-8 text-center"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.35 }}
          variants={sectionVariants(!!reduceMotion)}
        >
          <div className="text-sm font-semibold text-slate-100">
            More modules are coming
          </div>
          <div className="mt-2 text-sm text-slate-300">
            Postflop explorers, training drills, and session review tools will
            plug into this same dashboard over time.
          </div>
        </motion.section>
      </div>
    </main>
  );
}
