/**
 * The dynamic import for every code-split route, in one place.
 *
 * App.tsx builds its React.lazy() calls from this map and NavBar preloads from
 * it, so a preload triggered on hover and the later lazy render resolve to the
 * same module-registry entry — the second call is a no-op that returns the
 * already-settled promise.
 *
 * Keys are the route paths as declared in App.tsx. Parameterised routes
 * (/course/:sectionId, /hand-history/replay/:key) are keyed by their pattern
 * and preloaded through preloadRouteComponent instead.
 */
export const routeImports = {
  "/": () => import("@/pages/home/Homepage"),
  "/solutions": () => import("@/pages/solver/Solver"),
  "/equity": () => import("@/pages/equity/EquityCalc"),
  "/bankroll": () => import("@/pages/bankroll/BankrollTracker"),
  "/hand-history": () => import("@/pages/handhistory/HandHistoryTool"),
  "/hand-history/create": () => import("@/pages/handhistory/create/CreateHandHistory"),
  "/hand-history/players": () => import("@/pages/handhistory/players/PlayersPage"),
  "/hand-history/edit": () => import("@/pages/handhistory/EditHandHistory"),
  "/hand-history/replay": () => import("@/pages/handhistory/HandReplay"),
  "/course": () => import("@/pages/course/Course"),
  "/course/section": () => import("@/pages/course/CourseSection"),
  "/private": () => import("@/pages/private/PrivatePage"),
  "/compare": () => import("@/pages/compare/SolverCompare"),
  "/multiway": () => import("@/pages/multiway/MultiwaySolver"),
} as const;

export type RoutePath = keyof typeof routeImports;

/**
 * Start fetching a route's chunk before it is needed. Safe to call repeatedly
 * and safe to call with a path that is not code-split — both are no-ops.
 *
 * Errors are swallowed on purpose: a preload is speculative, and a failure here
 * must not surface to the user or reject unhandled. If the chunk is genuinely
 * unreachable, the real navigation will surface it through the error boundary.
 */
export function preloadRoute(path: string): void {
  const load = routeImports[path as RoutePath];
  if (!load) return;
  void load().catch(() => {});
}

/** Preload every route. Used when the tools menu opens on touch, where there is
 *  no hover to key off and the menu is only five entries wide. */
export function preloadAllRoutes(): void {
  for (const path of Object.keys(routeImports)) preloadRoute(path);
}
