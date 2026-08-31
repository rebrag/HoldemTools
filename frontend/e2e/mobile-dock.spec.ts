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

test("the matrix and solution controls are both reachable on mobile", async ({
  page,
}) => {
  await expect(page.getByTestId("display-mode-btn")).toBeVisible();
  await expect(page.getByTestId("height-mode-btn")).toBeVisible();
  // Not part of the matrix row - it rides in the sim panel up top.
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

/**
 * The dock budgets its rows in pixels from a measured container width, so a
 * measurement that outlives the viewport it was taken in is a layout bug:
 * the rows keep the old width, the `justify-center` wrapper hangs them off
 * both edges, and the matrix is clipped where nothing can scroll to it.
 *
 * The way a phone gets there is pinch-zoom. `useElementSize` used to discard
 * every resize while `visualViewport.scale != 1`, so zooming in and then
 * turning the phone (or dropping the keyboard, or any viewport change) froze
 * the width at its pre-rotation value - 792px of layout inside a 375px
 * screen. Zoom is emulated through CDP because that is the only way to move
 * the visual viewport without a real touch device.
 */
test("the dock survives a viewport change made while pinch-zoomed", async ({
  page,
}) => {
  // Lay out wide (still under the 1024 single-range breakpoint, so the mobile
  // view stays mounted and keeps its measurement across the change).
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId("mobile-dock")).toBeVisible();
  await page.waitForTimeout(300);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
      { message: "horizontal overflow while zoomed" }
    )
    .toBeLessThanOrEqual(1);

  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
});
