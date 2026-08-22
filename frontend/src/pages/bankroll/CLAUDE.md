# The purpose of the page:
- Displaying summaries of totals of results
- Most important data is total hours, total dollars, (total hours)/(total dollars)

# Battery notes (this page runs for 8-12 hour live sessions)
- The live-session duration ticker in `BankrollTracker.tsx` is intentionally a 30s interval gated on `usePageVisible()`.
Do not tighten it: every readout it feeds displays H:MM, so a finer tick only burns battery re-rendering the page.
- `BankrollStatsGrid` is `React.memo`'d so ticker renders skip its SlidingNumber digit trees.
Keep its props (`stats`, `displayStats`) coming from `useMemo`s that do not depend on `now`, or the memo silently stops working.
- See "Battery discipline (mobile)" in `frontend/CLAUDE.md` before adding any timer or continuous animation here.