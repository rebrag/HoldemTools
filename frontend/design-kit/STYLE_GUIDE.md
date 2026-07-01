# WillyAim Design Kit — Agent Style Guide (Tailwind v4)

You are restyling a page to adopt the **WillyAim** *technique* — glass panels,
soft accent glows, clean spacing, and tasteful scroll/hover motion — **while
keeping this project's existing color scheme.** Do not introduce new brand
colors. Instead, map the kit's small set of semantic tokens onto colors the
project already uses.

Read this fully, then apply it to the target page. Prefer the real code in this
folder (`theme.v4.css`, `primitives.tsx`) over inventing values.

## What to KEEP vs. what to ADOPT

| Keep (project's own)             | Adopt (from this kit)                          |
| -------------------------------- | ---------------------------------------------- |
| All colors / palette             | Glass surfaces (`backdrop-blur` + translucency)|
| Existing fonts (display optional)| Accent glow shadows on hover                   |
| Layout, content, routing, data   | Scroll-reveal + stagger motion                 |
|                                  | Hover micro-interactions (corner-accent wipe)  |
|                                  | Spacing / vertical rhythm                      |

---

## Step 1 — Wire up the semantic tokens (Tailwind v4, CSS-first)

This project is on **Tailwind v4**, so tokens live in CSS `@theme`, not a JS
config. Paste `theme.v4.css` into the main stylesheet **after**
`@import "tailwindcss";`, then fill the four `TODO` values with colors THIS
project already uses:

- `--color-surface` → the existing card/panel background color.
- `--color-accent` → the existing primary accent (brand color).
- `--color-accent-2` → an existing secondary accent (or reuse `--color-accent`).
- `--color-on-accent` → readable text color on top of the accent (often white).

Also set `--color-hairline` to a subtle border: `rgba(255,255,255,0.1)` on a
**dark** UI, or `rgba(0,0,0,0.08)` on a **light** UI.

Everything else (glow shadows, grid tint, motion) derives from those via
`color-mix`, so it auto-matches the project's palette. These token names then
become normal utilities: `bg-surface`, `text-accent`, `border-hairline`,
`shadow-glow`, `animate-grid-pan`, etc.

> If you can't tell what the project's accent/surface colors are, inspect the
> existing CSS/`@theme`/Tailwind config or ask the user — do not guess a color.

---

## Step 2 — Component recipes (the repeatable class patterns)

Use these exact combos. They reference only semantic tokens, so they inherit the
project's colors.

- **Glass panel / card**
  `border border-hairline bg-surface/60 backdrop-blur-md rounded-lg`

- **Primary button** (accent glow on hover)
  `rounded-md bg-accent text-on-accent px-7 py-3 font-semibold transition-all hover:shadow-glow`

- **Secondary button** (outline → accent on hover)
  `rounded-md border border-hairline px-7 py-3 font-semibold transition-colors hover:border-accent/50 hover:text-accent`

- **Card with animated corner accent** — a glass card with `group relative
  overflow-hidden`, plus a child
  `<span class="absolute left-0 top-0 h-0.5 w-0 bg-accent transition-all duration-300 group-hover:w-full" />`

- **Status pill**
  `rounded-full border border-accent/30 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-accent`

- **Section heading** — use `SectionHeading` from `primitives.tsx` (uppercase
  accent kicker + big title + muted subtitle).

- **Ambient background** — render `<TacticalBackground />` **once** near the app
  root. It uses `bg-surface` + accent orbs, so it blends with the existing
  scheme. Skip it if the project already has a strong background treatment.

**Rules of thumb**
- Surfaces are translucent + blurred, not flat opaque: reach for
  `bg-surface/60 backdrop-blur-md`.
- Glow is a *hover* affordance, applied sparingly to primary actions/cards.
- Keep the project's own text colors; only borrow `text-accent` for emphasis.
- Generous rhythm: sections `py-24`/`py-28`, containers `max-w-6xl px-6`.
- Corners: `rounded-md` buttons, `rounded-lg` panels.
- Display font (`.heading`) is **optional** — keep the project's headings unless
  the user wants the condensed uppercase look.

---

## Step 3 — Motion (Framer Motion)

Install if missing: `npm i framer-motion`. Import `fadeUp` / `staggerContainer`
/ `staggerItem` from `primitives.tsx`.

- **Scroll-reveal:** `initial="hidden" whileInView="show" viewport={{ once:
  true, margin: '-60px' }} variants={fadeUp}`
- **Stagger a grid/list:** `staggerContainer` on the parent, `staggerItem` on
  each child.

Keep it subtle: 0.4–0.6s, `easeOut`, `once: true`. In Next.js app-router,
animated files need `'use client'` at the top.

---

## Procedure for the target page

1. Confirm the project's accent + surface colors; fill the `@theme` tokens in
   `theme.v4.css`. Nothing looks different yet — expected.
2. Convert existing cards/containers to the glass-panel recipe.
3. Apply the button recipes to existing buttons (colors stay the project's).
4. Add the corner-accent + `hover:shadow-glow` to feature cards.
5. Wrap sections in the scroll-reveal motion; stagger any grids.
6. Optionally add `<TacticalBackground />` and/or `SectionHeading`.
7. Tighten spacing to the rhythm above.

**Preserve the page's existing colors, content, structure, and routing.** This is
a surface-and-motion restyle, not a rewrite or a recolor.

---

## Example prompt to give Claude Code in the target project

> Read `design-kit/STYLE_GUIDE.md` and the files next to it, then restyle
> `src/pages/Home` to match that *technique* — glass panels, accent glow, and
> the scroll/hover motion — but KEEP my existing color scheme. I'm on Tailwind
> v4. Wire the semantic tokens in `theme.v4.css` to my current accent/surface
> colors, copy the primitives you need, and apply the recipes. Don't change my
> colors, content, or routing.
