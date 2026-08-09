import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * Matrix cell heights (GTO Wizard style): postflop, each hand cell's colored
 * bar is scaled to the class's reach weight at the current node - Normalized
 * (default) scales the most-reached class to 100%, Range height uses the
 * absolute reach, Full height restores the old always-filled rendering.
 * Preflop plates carry no reach data, so they render full height in every
 * mode. The mode is chosen from the height menu in the header and persisted
 * to localStorage.
 *
 * The fixture is real PioSOLVER output for QsKh3c, whose preflop arrival
 * ranges are mixed - so real spreads exist for the assertions.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

/* The height menu lives in the study strip / classic header; the assertions
   here use the desktop study layout like the other postflop specs. */
test.skip(({ isMobile }) => !!isMobile, "study layout is desktop-only");

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });

  api = await stubSolverApi(page, {
    postflop: { index, manifest, streets: { "r.0": flopBundle }, stacks },
  });

  await page.goto("/solutions");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

/** Open the solved-flops library, load the fixture board, and advance past
 *  the forced-check root to a node where a real decision (and thus a filtered
 *  range) exists. Same walk as hand-breakdown.spec.ts. */
async function openBoard(page: Page) {
  await page.getByRole("button", { name: /solution library/i }).click();
  await page.locator(`button[title="Open ${board}"]`).click();
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  await page.locator('button[title="Click to see reactions to Check"]').click();
  await expect(
    page.locator('button[title^="Click to see reactions to Bet"]')
  ).toBeVisible();
}

/** data-height of every rendered cell, keyed by hand class. */
async function cellHeights(page: Page): Promise<Record<string, number>> {
  return Object.fromEntries(
    await page
      .getByTestId("hand-cell")
      .evaluateAll((nodes) =>
        nodes.map((n) => [
          n.getAttribute("data-hand"),
          Number(n.getAttribute("data-height")),
        ])
      )
  );
}

/** Pick a mode from the header's height menu. */
async function setMode(page: Page, mode: "normalized" | "range" | "full") {
  await page.getByTestId("height-mode-btn").click();
  await page
    .locator(`[data-testid="height-mode-menu"] [data-mode="${mode}"]`)
    .click();
}

test("preflop cells always render full height", async ({ page }) => {
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  const heights = Object.values(await cellHeights(page));
  expect(heights.length).toBe(169);
  // No reach data preflop: every mode degrades to the old full-height look.
  expect(heights.every((h) => h === 100)).toBe(true);
});

test("postflop cells scale to reach, most-reached class at 100%", async ({
  page,
}) => {
  await openBoard(page);
  const heights = Object.values(await cellHeights(page));

  // Normalized (the default): the most-reached class pins the scale at 100...
  expect(Math.max(...heights)).toBe(100);
  // ...and a mixed preflop range must leave some class only partly here.
  expect(
    heights.some((h) => h > 0 && h < 100),
    "no partially-reached cell rendered; heights all 0 or 100"
  ).toBe(true);
});

test("full height mode restores the always-filled rendering", async ({
  page,
}) => {
  await openBoard(page);
  await setMode(page, "full");

  const heights = Object.values(await cellHeights(page));
  expect(heights.every((h) => h === 100)).toBe(true);
  expect(
    await page.evaluate(() => window.localStorage.getItem("matrixHeightMode"))
  ).toBe("full");
});

test("range mode never draws taller than normalized", async ({ page }) => {
  await openBoard(page);
  const normalized = await cellHeights(page);

  await setMode(page, "range");
  const range = await cellHeights(page);

  // range = normalized * maxReach with maxReach <= 1; +1 absorbs the
  // independent rounding of the two data-height attributes.
  for (const [hand, h] of Object.entries(range)) {
    expect(h, `${hand} grew from ${normalized[hand]} to ${h}`).toBeLessThanOrEqual(
      normalized[hand] + 1
    );
  }
  expect(Object.values(range).some((h) => h > 0)).toBe(true);
});

test("the chosen mode survives a reload", async ({ page }) => {
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  await setMode(page, "full");

  await page.reload();
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();

  await page.getByTestId("height-mode-btn").click();
  await expect(
    page.locator('[data-testid="height-mode-menu"] [data-mode="full"]')
  ).toHaveAttribute("aria-checked", "true");
});
