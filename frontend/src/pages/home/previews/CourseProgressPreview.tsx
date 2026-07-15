import { JSX } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberTicker } from "../shared/NumberTicker";

/**
 * The Course tool's internals: an animated progress ring plus a checklist of
 * sections that tick in on scroll. Mirrors the real 9-section course.
 */

const SECTIONS = [
  { num: 1, title: "Why Math Matters", done: true },
  { num: 2, title: "Measurements", done: true },
  { num: 3, title: "Getting Started with Numbers", done: true },
  { num: 4, title: "Hit the Deck", done: false },
  { num: 5, title: "Putting it Together", done: false },
];

const R = 26;
const CIRC = 2 * Math.PI * R;
const PROGRESS = 3 / 9; // 3 of 9 sections complete

export function CourseProgressPreview({ className }: { className?: string }): JSX.Element {
  const reduce = useReducedMotion();

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="6" />
            <motion.circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke="url(#ht-course-ring)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              initial={{ strokeDashoffset: CIRC }}
              whileInView={{ strokeDashoffset: CIRC * (1 - PROGRESS) }}
              viewport={{ once: true }}
              transition={{ duration: reduce ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}
            />
            <defs>
              <linearGradient id="ht-course-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#fb923c" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-amber-200">
            <NumberTicker value={33} suffix="%" duration={1.2} />
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-300/90">
            Think Like a Professional
          </div>
          <div className="mt-0.5 text-sm text-slate-300">
            3 of 9 sections · Poker math &amp; strategy
          </div>
        </div>
      </div>

      <motion.ul
        className="flex flex-col gap-1.5"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-30px" }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.08 } } }}
      >
        {SECTIONS.map((s) => (
          <motion.li
            key={s.num}
            variants={{
              hidden: { opacity: 0, x: reduce ? 0 : -8 },
              show: { opacity: 1, x: 0, transition: { duration: 0.35 } },
            }}
            className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/10"
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                s.done
                  ? "bg-amber-400 text-amber-950"
                  : "bg-slate-700/70 text-slate-300 ring-1 ring-white/10",
              )}
            >
              {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : s.num}
            </span>
            <span className={cn("text-xs", s.done ? "text-slate-200" : "text-slate-400")}>
              {s.title}
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
