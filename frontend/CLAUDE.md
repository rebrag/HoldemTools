# HoldemTools
- React + TypeScript + Vite + Tailwind
- Pages live in src/pages/, each page is its own folder
- Use context from src/context/ for global state
- Workers in src/workers/ handle heavy computation (never block UI thread)
- Run: `npm run dev` | Build: `npm run build`

## Frontend tendencies
- please include animations to make the web app feel like a game for end users
- most users will be mobile users, but will also have desktop users, ensure that pages make good use of space (limit unused space where there's just backgrounds being displayed) and most regions are either click-able in a useful way or display useful information