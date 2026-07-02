import { JSX, ReactNode, useRef, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight, ArrowDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Meteors } from "../shared/Meteors";
import { Marquee } from "../shared/Marquee";
import { TiltCard } from "../shared/TiltCard";
import { ToolPreview } from "../previews/ToolPreview";
import { HERO, STATS, MARQUEE_ITEMS, toolById, type ToolMeta } from "../content";

/**
 * Design B - "Kinetic Arcade". A cinematic, game-forward take: a table-glow
 * backdrop with meteors, a floating 3D hero showcasing the live range grid,
 * and scroll-driven parallax stages for each tool with magnetic CTAs and big
 * kinetic index numerals. Louder and more playful than Aurora Bento.
 */
export default function KineticArcade(): JSX.Element {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const go = (route: string) => () => navigate(route);

  const solutions = toolById("solutions");
  const equity = toolById("equity");
  const bankroll = toolById("bankroll");
  const course = toolById("course");

  const heroWords = `${HERO.titleLead} ${HERO.titleAccent}`.split(" ");

  return (
    <main className="relative min-h-screen overflow-clip text-slate-100">
      {/* HERO */}
      <section className="relative">
        <Meteors count={16} />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-2 lg:pt-20">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200"
            >
              <Zap className="h-3.5 w-3.5" />
              {HERO.kicker}
            </motion.span>

            <h1 className="mt-6 flex flex-wrap gap-x-3 text-4xl font-black tracking-tight sm:text-6xl">
              {heroWords.map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 28, rotateX: -40 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0 }}
                  transition={{ duration: 0.55, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformPerspective: 600 }}
                  className={cn(
                    i >= 2 &&
                      "text-gradient-animated animate-gradient-pan bg-gradient-to-r from-emerald-300 via-teal-200 to-emerald-400",
                  )}
                >
                  {word}
                </motion.span>
              ))}
            </h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-5 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base"
            >
              {HERO.sub}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, duration: 0.5 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <MagneticButton onClick={go(solutions.route)} primary>
                {HERO.primaryCta}
                <ArrowRight className="h-4 w-4" />
              </MagneticButton>
              <MagneticButton onClick={go(equity.route)}>{HERO.secondaryCta}</MagneticButton>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.6 }}
              className="mt-10 flex flex-wrap gap-6"
            >
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="text-xl font-bold text-white">{s.value}</div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                    {s.label}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Floating Solutions showcase */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div
              className="pointer-events-none absolute -inset-6 rounded-[2.5rem] blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(16,185,129,0.28), transparent 70%)" }}
            />
            <TiltCard className={cn(!reduce && "animate-float")} max={7}>
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Solutions · live</span>
                  <button
                    type="button"
                    onClick={go(solutions.route)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 transition-colors hover:text-emerald-200"
                  >
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <ToolPreview id="range" />
              </div>
            </TiltCard>
          </motion.div>
        </div>

        {!reduce && (
          <motion.div
            aria-hidden="true"
            className="mx-auto flex max-w-6xl justify-center px-4 pb-6 text-slate-500"
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            <ArrowDown className="h-5 w-5" />
          </motion.div>
        )}
      </section>

      {/* MARQUEE */}
      <div className="border-y border-white/5 bg-white/[0.02] py-3">
        <Marquee durationSec={reduce ? 0 : 32}>
          {MARQUEE_ITEMS.map((label) => (
            <span
              key={label}
              className="mx-5 text-lg font-bold uppercase tracking-wider text-slate-600"
            >
              {label}
              <span className="ml-5 text-emerald-500/60">✦</span>
            </span>
          ))}
        </Marquee>
      </div>

      {/* TOOL STAGES */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <KineticStage tool={equity} index={2} onOpen={go(equity.route)}>
          <ToolPreview id="equity" />
        </KineticStage>
        <KineticStage tool={bankroll} index={3} reverse onOpen={go(bankroll.route)}>
          <ToolPreview id="bankroll" />
        </KineticStage>
        <KineticStage tool={course} index={4} onOpen={go(course.route)}>
          <ToolPreview id="course" />
        </KineticStage>
      </div>

      {/* FOOTER CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-28 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 via-slate-900/50 to-slate-950 p-10 text-center sm:p-16">
          <Meteors count={10} />
          <h2 className="relative text-3xl font-black tracking-tight sm:text-5xl">
            Ready to <span className="text-emerald-300">level up</span>?
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-sm text-slate-300 sm:text-base">
            Jump into the standard grid and start studying like a professional.
          </p>
          <div className="relative mt-8 flex justify-center">
            <MagneticButton onClick={go(solutions.route)} primary>
              {HERO.primaryCta}
              <ArrowRight className="h-4 w-4" />
            </MagneticButton>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------ KineticStage */

function KineticStage({
  tool,
  index,
  children,
  reverse = false,
  onOpen,
}: {
  tool: ToolMeta;
  index: number;
  children: ReactNode;
  reverse?: boolean;
  onOpen: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [70, -70]);
  const glow = useTransform(scrollYProgress, [0, 0.5, 1], [0.1, 0.4, 0.1]);

  return (
    <section
      ref={ref}
      className="relative grid items-center gap-8 py-16 lg:grid-cols-2 lg:gap-12 lg:py-24"
    >
      {/* giant background index numeral */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-6 select-none text-[10rem] font-black leading-none text-white/[0.03] sm:text-[14rem]",
          reverse ? "right-0" : "left-0",
        )}
      >
        {String(index).padStart(2, "0")}
      </span>

      {/* text */}
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={cn("relative", reverse && "lg:order-2")}
      >
        <div
          className={cn(
            "bg-gradient-to-r bg-clip-text text-sm font-bold uppercase tracking-[0.25em] text-transparent",
            tool.gradient,
          )}
        >
          {tool.kicker}
        </div>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{tool.name}</h2>
        <p className="mt-2 text-lg font-medium text-slate-400">{tool.tagline}</p>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-300 sm:text-base">
          {tool.description}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {tool.bullets.map((b) => (
            <span
              key={b}
              className="rounded-full border px-3 py-1 text-xs font-semibold"
              style={{
                borderColor: `rgba(${tool.accentRgb},0.35)`,
                color: tool.accentHex,
                backgroundColor: `rgba(${tool.accentRgb},0.08)`,
              }}
            >
              {b}
            </span>
          ))}
        </div>

        <div className="mt-7">
          <MagneticButton onClick={onOpen}>
            {tool.cta}
            <ArrowRight className="h-4 w-4" />
          </MagneticButton>
        </div>
      </motion.div>

      {/* preview */}
      <motion.div style={{ y }} className={cn("relative", reverse && "lg:order-1")}>
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-8 rounded-[2.5rem] blur-3xl"
          style={{
            background: `radial-gradient(circle, rgba(${tool.accentRgb},0.5), transparent 70%)`,
            opacity: glow,
          }}
        />
        <TiltCard max={8}>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
            {children}
          </div>
        </TiltCard>
      </motion.div>
    </section>
  );
}

/* ----------------------------------------------------------- MagneticButton */

function MagneticButton({
  children,
  onClick,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
}): JSX.Element {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 12 });
  const sy = useSpring(y, { stiffness: 200, damping: 12 });

  const handleMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width / 2) * 0.3);
    y.set((e.clientY - r.top - r.height / 2) * 0.3);
  };
  const handleLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      style={{ x: sx, y: sy }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-[box-shadow,border-color] duration-300 focus-visible:outline-none focus-visible:ring-2",
        primary
          ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25 hover:shadow-glow focus-visible:ring-emerald-300"
          : "border border-white/15 bg-white/5 text-slate-100 backdrop-blur hover:border-white/30 hover:bg-white/10 focus-visible:ring-white/40",
      )}
    >
      {children}
    </motion.button>
  );
}
