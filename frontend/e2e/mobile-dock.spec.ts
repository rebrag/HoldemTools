import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * The mobile single-range layout is a "tabbed dock": the matrix stays large
 * and fixed while a segmented control switches the bottom panel between the
 * poker table, the seat stats, and the per-combo hands grid. Everything the
 * desktop study view shows has to be reachable here - dropping panels on
 * mobile is exactly the regression this file exists to catch.
 */

let api: ApiStub;

const BOOT_TIMEOUT = 45_000;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
  });
  api = await stubSolverApi(page);
  await page.goto("/solutions");
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({
    timeout: BOOT_TIMEOUT,
  });
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("the dock opens on the table and the tabs switch its panel", async ({
  page,
}) => {
  const dock = page.getByTestId("mobile-dock");
  await expect(dock).toBeVisible();
  // Table is the default tab: the felt is on screen.
  await expect(page.getByTestId("segment-table")).toHaveAttribute("data-active", "true");

  // Stats: preflop has no node stats, so the tab explains where they appear.
  await page.getByTestId("segment-stats").click();
  await expect(dock.getByText(/postflop solve/i)).toBeVisible();

  // Hands: the per-combo breakdown panel, waiting for a hand.
  await page.getByTestId("segment-hands").click();
  await expect(dock.getByText(/hands/i).first()).toBeVisible();

  await page.getByTestId("segment-table").click();
  await expect(page.getByTestId("segment-table")).toHaveAttribute("data-active", "true");
});

test("the matrix controls are present on mobile", async ({ page }) => {
  await expect(page.getByTestId("display-mode-btn")).toBeVisible();
  await expect(page.getByTestId("height-mode-btn")).toBeVisible();
  await expect(page.getByRole("button", { name: /single range/i })).toBeVisible();
});

test("tapping a matrix cell pins it and the Hands tab shows that class", async ({
  page,
}) => {
  const cell = page.locator('[data-testid="hand-cell"][data-hand="A5s"]');
  await cell.tap();
  await expect(cell).toHaveAttribute("data-selected", "1");

  await page.getByTestId("segment-hands").tap();
  await expect(page.getByText(/^A5s · \d+ combos$/)).toBeVisible();

  // Tapping the pinned cell again releases it.
  await cell.tap();
  await expect(cell).toHaveAttribute("data-selected", "0");
});

test("the dock layout never scrolls the page", async ({ page }) => {
  for (const tab of ["stats", "hands", "table"] as const) {
    await page.getByTestId(`segment-${tab}`).click();
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        y: de.scrollHeight - de.clientHeight,
        x: de.scrollWidth - de.clientWidth,
      };
    });
    expect(overflow.y, `vertical overflow on ${tab}`).toBeLessThanOrEqual(1);
    expect(overflow.x, `horizontal overflow on ${tab}`).toBeLessThanOrEqual(1);
  }
});
