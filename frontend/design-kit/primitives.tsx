/**
 * WillyAim reusable primitives — COLOR-AGNOSTIC (Tailwind v4).
 *
 * These carry the *technique* (glass panels, glow, motion, hover micro-
 * interactions) and get their color from the semantic tokens you define in
 * `theme.v4.css`: --color-surface, --color-accent, --color-accent-2,
 * --color-on-accent, --color-hairline, --shadow-glow, --shadow-glow-2.
 * They do NOT hardcode any brand colors, so your existing scheme is preserved.
 *
 * Requires: React, Tailwind v4 (with theme.v4.css), framer-motion.
 * Next.js app-router: add 'use client' at the top of the file you paste into.
 */
import { motion, type Variants } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/* ------------------------------------------------------------------ motion */

/** Fade + rise. Use with whileInView for scroll reveals. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

/** Parent that staggers its children. Pair with staggerItem. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

/* ------------------------------------------------------------------ Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'rounded-md px-7 py-3 font-semibold transition-all disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-accent text-on-accent hover:shadow-glow'
      : 'border border-hairline hover:border-accent/50 hover:text-accent';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

/* --------------------------------------------------------------- GlassCard */

export function GlassCard({
  children,
  accent = 'accent',
  className = '',
}: {
  children: ReactNode;
  accent?: 'accent' | 'accent-2';
  className?: string;
}) {
  const glow = accent === 'accent' ? 'hover:shadow-glow' : 'hover:shadow-glow-2';
  const bar = accent === 'accent' ? 'bg-accent' : 'bg-accent-2';
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-hairline bg-surface/60 p-6 backdrop-blur-md transition-all ${glow} ${className}`}
    >
      {children}
      {/* Corner accent wipes in on hover */}
      <span
        className={`absolute left-0 top-0 h-0.5 w-0 transition-all duration-300 group-hover:w-full ${bar}`}
      />
    </div>
  );
}

/* ----------------------------------------------------------- SectionHeading */

export function SectionHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true }}
      variants={fadeUp}
      className="text-center"
    >
      <p className="text-accent mb-3 text-xs font-bold uppercase tracking-[0.3em]">
        {kicker}
      </p>
      {/* Drop `.heading` if you keep your own heading font. */}
      <h2 className="heading text-4xl sm:text-5xl">{title}</h2>
      {subtitle && (
        <p className="mx-auto mt-4 max-w-xl opacity-70">{subtitle}</p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------- TacticalBackground */

/**
 * Ambient animated backdrop. Render once near the app root. Fixed, behind
 * everything. Uses your surface + accent colors, so it blends with your scheme.
 * If your background is not `--color-surface`, swap `bg-surface` below.
 */
export function TacticalBackground() {
  return (
    <div className="bg-surface fixed inset-0 -z-10 overflow-hidden">
      <div className="tactical-grid animate-grid-pan absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,transparent_0%,color-mix(in_srgb,var(--color-surface)_85%,transparent)_75%)]" />
      <motion.div
        className="bg-accent/20 absolute h-[38rem] w-[38rem] rounded-full blur-[120px]"
        initial={{ x: '-10%', y: '5%' }}
        animate={{ x: ['-10%', '20%', '-10%'], y: ['5%', '25%', '5%'] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="bg-accent-2/15 absolute right-0 h-[32rem] w-[32rem] rounded-full blur-[120px]"
        initial={{ x: '10%', y: '40%' }}
        animate={{ x: ['10%', '-15%', '10%'], y: ['40%', '15%', '40%'] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
