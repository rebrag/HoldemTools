# HoldemTools
- React + TypeScript + Vite + Tailwind
- Pages live in src/pages/, each page is its own folder
- Use context from src/context/ for global state
- Workers in src/workers/ handle heavy computation (never block UI thread)
- Run: `npm run dev` | Build: `npm run build`

## Frontend tendencies
- please include animations to make the web app feel like a game for end users
- most users will be mobile users, but will also have desktop users, ensure that pages make good use of space (limit unused space where there's just backgrounds being displayed) and most regions are either click-able in a useful way or display useful information
- attempt to use re-useable components before developing from scratch, particularly PlayingCards, PokerTable, DealerButton, ChipStack (for bets)

## Reusable card-entry components (src/components/)
- `PlayingCard` - renders a single face-up card from a code like "As" / "Td".
- `RankSuitKeypad` - compact two-stage rank→suit picker (tap a rank, then a suit).
Prefer this for card entry in tight/mobile UIs; used by the Equity Calculator and the
Hand History seat editor. Props: `used` (Set of taken codes), `onPick(code)`, `targetLabel`.
- `CardPicker` - full 52-card grid selector. Better when there's room to show every card
(e.g. board editors). Props: `used`, `onPick(code)`, plus sizing (`minCardWidth`, `size`, ...).