import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * Matrix display modes (GTO Wizard style): the dropdown above the study
 * matrix switches the 169 cells between the strategy mix (default), per-combo
 * EV heat stripes, and per-combo equity heat stripes, with the hand breakdown
 * following the mode. Equity needs per-combo data, so it is disabled preflop.
 * The breakdown grid additionally must never scroll: tiles shrink to fit.
 *
 * Same QsKh3c fixture and walk as hand-breakdown.spec.ts.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

/* The dropdown only exists in the desktop study layout. */
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
 *  the forced-check root, exactly like hand-breakdown.spec.ts. */
async function openBoard(page: Page) {
  await page.getByRole("button", { name: /solved flops/i }).click();
  await page.locator(`button[title="Open ${board}"]`).click();
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  await page.locator('button[title="Click to see reactions to Check"]').click();
  await expect(
    page.locator('button[title^="Click to see reactions to Bet"]')
  ).toBeVisible();
}

/** Pick a mode from the matrix's display dropdown. */
async function setMode(page: Page, mode: "strategy" | "ev" | "equity") {
  await page.getByTestId("display-mode-btn").click();
  await page
    .locator(`[data-testid="display-mode-menu"] [data-mode="${mode}"]`)
    .click();
}

test("strategy is the default and equity is disabled preflop", async ({
  page,
}) => {
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  await expect(page.getByTestId("display-mode-btn")).toHaveText(/Strategy/);

  await page.getByTestId("display-mode-btn").click();
  const equity = page.locator(
    '[data-testid="display-mode-menu"] [data-mode="equity"]'
  );
  await expect(equity).toBeDisabled();
  await expect(equity).toContainText("Postflop only");
});

test("EV mode preflop renders solid class heat and persists", async ({
  page,
}) => {
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
  await setMode(page, "ev");

  // No per-combo data preflop: every in-range class gets one solid heat color.
  await expect(page.getByTestId("heat-solid").first()).toBeVisible();
  expect(await page.getByTestId("heat-stripe").count()).toBe(0);
  expect(
    await page.evaluate(() => window.localStorage.getItem("matrixDisplayMode"))
  ).toBe("ev");
});

test("EV mode postflop renders per-combo stripes and EV tiles", async ({
  page,
}) => {
  // Tall enough that the breakdown tiles keep their visible value rows
  // (short panels collapse tiles to a chip + tooltip - covered below).
  await page.setViewportSize({ width: 1280, height: 1100 });
  await openBoard(page);
  await setMode(page, "ev");

  // Per-combo data exists here, so cells stripe per combo instead of solid.
  await expect(page.getByTestId("heat-stripe").first()).toBeVisible();
  expect(await page.getByTestId("heat-solid").count()).toBe(0);

  // The breakdown mirrors the mode: EV column, no strategy segment bars.
  await page.locator('[data-testid="hand-cell"][data-hand="66"]').click();
  const tile = page.locator('[data-testid="combo-tile"][data-blocked="0"]').first();
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("EV");
  expect(await page.getByTestId("combo-segment").count()).toBe(0);
});

test("equity mode postflop heat-colors combos by equity", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await openBoard(page);

  await page.getByTestId("display-mode-btn").click();
  const equity = page.locator(
    '[data-testid="display-mode-menu"] [data-mode="equity"]'
  );
  await expect(equity).toBeEnabled();
  await equity.click();

  await expect(page.getByTestId("heat-stripe").first()).toBeVisible();

  await page.locator('[data-testid="hand-cell"][data-hand="66"]').click();
  const tile = page.locator('[data-testid="combo-tile"][data-blocked="0"]').first();
  await expect(tile).toContainText("Equity");
});

test("short panels collapse tiles to a chip with a tooltip", async ({
  page,
}) => {
  await openBoard(page);
  await setMode(page, "ev");
  // At the default 800px-tall viewport the breakdown is short enough that
  // tiles drop their value rows; the data moves into the tile tooltip.
  await page.locator('[data-testid="hand-cell"][data-hand="66"]').click();
  const tile = page.locator('[data-testid="combo-tile"][data-blocked="0"]').first();
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("title", /\d/);
});

test("the breakdown grid fits every combo without scrolling", async ({
  page,
}) => {
  await openBoard(page);
  // Offsuit = 12 combos, the worst case for vertical fit.
  await page.locator('[data-testid="hand-cell"][data-hand="AKo"]').click();
  await expect(
    page.locator('[data-testid="combo-tile"]').first()
  ).toBeVisible();

  const { scrollH, clientH, tiles } = await page.evaluate(() => {
    const tile = document.querySelector('[data-testid="combo-tile"]')!;
    const container = tile.closest(".grid")!.parentElement!;
    return {
      scrollH: container.scrollHeight,
      clientH: container.clientHeight,
      tiles: document.querySelectorAll('[data-testid="combo-tile"]').length,
    };
  });
  expect(tiles).toBe(12);
  expect(scrollH).toBeLessThanOrEqual(clientH + 1);
});
