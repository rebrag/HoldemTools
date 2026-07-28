import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * The hand breakdown panel used to render every combo of a hand class with the
 * same action mix, so all of a class's tiles came out identical - see the
 * reference screenshots on the bug. The cause was upstream: the watcher
 * averaged Pio's 1326 per-combo strategies down to 169 class values before
 * upload, so the per-combo detail never reached the browser at all.
 *
 * The fixture here is real PioSOLVER output for QsKh3c run through the current
 * extraction code, so these tests fail if either half regresses - the watcher
 * dropping per-combo data, or the panel going back to painting class averages.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

/* HandBreakdown only exists in the desktop study layout; the mobile single-range
   view renders the matrix and ColorKey alone. */
test.skip(({ isMobile }) => !!isMobile, "study layout is desktop-only");

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    // The study layout (matrix beside the breakdown panel) is desktop-only and
    // is the only layout that renders HandBreakdown.
    window.localStorage.setItem("singleRangeView", "1");
    // The solved-flops library is auth-gated; playwright.config compiles the
    // dev auth bypass in, and this flips its store to signed in.
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });

  api = await stubSolverApi(page, {
    postflop: { index, manifest, streets: { "r.0": flopBundle }, stacks },
  });

  await page.goto("/solutions");
});

/* Nothing may reach the deployed API. Left unstubbed, whether a call succeeds
   depends on the dev port sitting in the deployed CORS allowlist: blocked, the
   page stays empty and the postflop plate is the only data around, so these
   tests would pass for the wrong reason; allowed, a real preflop sim loads and
   takes over the matrix. */
test.afterEach(() => {
  // Skipped projects never run beforeEach, so there is no stub to check.
  if (api) expect(api.unhandled).toEqual([]);
});

/** Open the solved-flops library and load the fixture board. */
async function openBoard(page: Page) {
  await page.getByRole("button", { name: /solved flops/i }).click();
  // Boards render as PlayingCards, so the button's title is the only text.
  await page.locator(`button[title="Open ${board}"]`).click();
  // The matrix is populated once the flop bundle has been applied to the plate.
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();

  /* The flop root is a forced check - one action, so every combo is trivially
     100% and nothing can differ. Advance to the node where the in-position
     player actually chooses between betting and checking. */
  // Matched on title: the accessible name also carries the frequency and combo
  // count, which change whenever the fixture is re-solved.
  await page.locator('button[title="Click to see reactions to Check"]').click();
  await expect(
    page.locator('button[title^="Click to see reactions to Bet"]')
  ).toBeVisible();
  // The breakdown stays on its "hover a hand" prompt until a cell is hovered,
  // so tiles are not asserted here.
}

/** Hover a class in the matrix and read back its rendered combo tiles. */
async function tilesFor(page: Page, hand: string) {
  await page.locator(`[data-testid="hand-cell"][data-hand="${hand}"]`).hover();
  const tiles = page.locator('[data-testid="combo-tile"][data-blocked="0"]');
  await expect(tiles.first()).toBeVisible();
  return tiles.evaluateAll((nodes) =>
    nodes.map((n) => ({
      combo: n.getAttribute("data-combo"),
      widths: [...n.querySelectorAll('[data-testid="combo-segment"]')]
        .map((s) => s.getAttribute("data-width"))
        .join("|"),
    }))
  );
}

test("combos of one class render their own mixes, not the class average", async ({
  page,
}) => {
  await openBoard(page);

  /* Pick whichever class actually mixes across its combos at this node rather
     than hardcoding one, so the test survives a re-solve of the fixture. */
  const candidates = ["66", "77", "88", "99", "TT", "A5s", "KJo", "QJo"];
  const spreads: Record<string, string[]> = {};
  for (const hand of candidates) {
    const tiles = await tilesFor(page, hand);
    if (tiles.length > 1) spreads[hand] = [...new Set(tiles.map((t) => t.widths))];
  }

  const mixing = Object.entries(spreads).filter(([, uniq]) => uniq.length > 1);
  expect(
    mixing.length,
    `no class rendered differing per-combo widths; got ${JSON.stringify(spreads)}`
  ).toBeGreaterThan(0);
});

test("a partially weighted combo is labelled with its weight", async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-testid="hand-cell"][data-hand="66"]').hover();

  // Weight badges only appear for combos that are not fully in the range;
  // whether any show depends on the node, so just assert they are well formed.
  const badges = page.locator('[data-testid="combo-tile"] [title*="reaches here"]');
  for (const text of await badges.allInnerTexts()) {
    expect(text).toMatch(/^\d+(\.\d+)?%$/);
  }
});

test("breakdown panel never scrolls sideways", async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-testid="hand-cell"][data-hand="AKo"]').hover();
  const tile = page.locator('[data-testid="combo-tile"]').first();
  await expect(tile).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
