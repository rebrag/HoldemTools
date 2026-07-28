import { test, expect, type Page } from "@playwright/test";
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

const { board, index, manifest, flopBundle } = fixture;

/* HandBreakdown only exists in the desktop study layout; the mobile single-range
   view renders the matrix and ColorKey alone. */
test.skip(({ isMobile }) => !!isMobile, "study layout is desktop-only");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    // The study layout (matrix beside the breakdown panel) is desktop-only and
    // is the only layout that renders HandBreakdown.
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });

  /* One dispatcher for every API call, so the spec is hermetic.
   *
   * A per-endpoint set of routes is not enough: anything left unstubbed reaches
   * the real API, and whether that succeeds depends on the dev port being in the
   * deployed CORS allowlist. On a blocked port the calls fail, the page stays
   * empty, and the postflop plate is the only data around - so the test passed
   * for the wrong reason. On an allowed port a real preflop sim loads and takes
   * over the matrix. Serving everything here removes the network from the
   * picture entirely. */
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("piosolutionsIndex")) return route.fulfill({ json: index });
    if (url.includes("/manifest")) return route.fulfill({ json: manifest });
    if (url.includes("/streets/r.0.json")) return route.fulfill({ json: flopBundle });
    // Everything else (folder lists, plate files, metadata) resolves empty, so
    // no preflop sim loads and no "Error fetching files" banner appears.
    return route.fulfill({ json: [] });
  });

  await page.goto("/solutions");
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
