import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * The hand list groups twice over: by calendar day, then by bankroll session
 * within a day.
 * A night at one table is one header, not the same "location · blinds" pill
 * repeated on every row - which is what the list did before, and what made a
 * long session read as noise.
 *
 * The second thing asserted here lives only in the layout: on a phone the list
 * runs edge to edge, because the card fans are the content and the page gutter
 * was eating ~30px of them on each side.
 */

const TAMPA = "sess-tampa";
const ARIA = "sess-aria";
const DAY = "2026-07-07T21:00:00.000Z";

/** Distinct first lines - a hand with no embedded replay payload previews as
 *  its first text line, which is all these need to be identifiable. */
const HANDS = [
  { id: 1, rawText: "Tampa hand one", sessionId: TAMPA, createdAt: `${DAY}` },
  { id: 2, rawText: "Tampa hand two", sessionId: TAMPA, createdAt: DAY },
  { id: 3, rawText: "Tampa hand three", sessionId: TAMPA, createdAt: DAY },
  { id: 4, rawText: "Aria hand one", sessionId: ARIA, createdAt: DAY },
];

const SESSIONS = [
  {
    id: TAMPA,
    userId: "dev",
    type: "cash",
    start: DAY,
    end: null,
    hours: null,
    location: "Hard Rock Tampa",
    game: "NL",
    blinds: "2/5 NL",
    buyIn: 500,
    cashOut: 900,
    profit: 400,
  },
  {
    id: ARIA,
    userId: "dev",
    type: "cash",
    start: DAY,
    end: null,
    hours: null,
    location: "Aria",
    game: "NL",
    blinds: "5/10 NL",
    buyIn: 1000,
    cashOut: 1000,
    profit: 0,
  },
];

let api: ApiStub;

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  api = await stubSolverApi(context, {
    handHistories: HANDS,
    bankrollSessions: SESSIONS,
  });
  await page.goto("/hand-history");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("consecutive hands from one session share a single header", async ({ page }) => {
  // All four hands are listed...
  for (const h of HANDS) {
    await expect(page.locator("li", { hasText: h.rawText }).last()).toBeVisible();
  }

  // ...under exactly one header each, not one pill per row.
  const tampa = page.locator("li", { hasText: "Hard Rock Tampa · 2/5 NL" });
  const aria = page.locator("li", { hasText: "Aria · 5/10 NL" });
  await expect(tampa).toHaveCount(1);
  await expect(aria).toHaveCount(1);

  // Each header carries its run's size, so a session reads as a block.
  await expect(tampa).toContainText("3 hands");
  await expect(aria).toContainText("1 hand");

  // Both sessions fall on one day, so there is a single day header above them.
  await expect(page.locator("li", { hasText: /^Jul 7, 2026$/ })).toHaveCount(1);
});

test("the list runs edge to edge on a phone", async ({ page, isMobile, viewport }) => {
  test.skip(!isMobile, "the full-bleed treatment is mobile-only; sm+ is a card");

  const list = page.locator("ul.divide-y").first();
  const box = await list.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(0.5);
  expect(box!.width).toBeGreaterThanOrEqual(viewport!.width - 0.5);

  // Full-bleed must not become a horizontally scrolling document.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 0.5
  );
  expect(overflows).toBe(false);
});

test("on desktop the list stays an inset, rounded card", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop-only counterpart to the full-bleed assertion");

  const list = page.locator("ul.divide-y").first();
  const box = await list.boundingBox();
  expect(box!.x).toBeGreaterThan(0);
  await expect(list).toHaveCSS("border-top-left-radius", "16px");
});
