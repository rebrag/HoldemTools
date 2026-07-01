# WillyAim Design Kit (Tailwind v4 · color-agnostic)

Drop this `design-kit/` folder into another project to adopt the WillyAim
*technique* — glass panels, accent glows, and clean scroll/hover motion —
**without changing that project's existing color scheme.**

## Contents
- **`STYLE_GUIDE.md`** — the agent-facing spec. Read by Claude Code. Explains
  what to keep (your colors) vs. adopt (surfaces + motion), plus recipes and a
  procedure.
- **`theme.v4.css`** — Tailwind v4 `@theme` tokens, preloaded with the
  HoldemTools color scheme (emerald / slate / blue). Four semantic tokens
  (`surface`, `accent`, `accent-2`, `on-accent`) carry the palette; glows and
  grid tint derive from them automatically. Remap those four to reuse the kit
  in another project.
- **`primitives.tsx`** — color-agnostic React components: `Button`, `GlassCard`,
  `SectionHeading`, `TacticalBackground`, plus motion variants. They read the
  semantic tokens, so they inherit your palette.

## How to use
1. Copy this folder into your other project's root.
2. Ensure `framer-motion` is installed: `npm i framer-motion`.
3. Prompt Claude Code in that project:

   > Read `design-kit/STYLE_GUIDE.md` and the files next to it, then restyle
   > `src/pages/Home` to match that technique — glass panels, accent glow, and
   > the scroll/hover motion — but KEEP my existing color scheme. I'm on Tailwind
   > v4. Wire the semantic tokens in `theme.v4.css` to my current accent/surface
   > colors, copy the primitives you need, and apply the recipes. Don't change my
   > colors, content, or routing.

The kit never hardcodes brand colors, so your scheme is preserved end-to-end.
