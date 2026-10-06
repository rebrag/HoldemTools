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

/**
 * The poker table reserves its own gutter for the seat clusters that straddle
 * its rim, so the dock - whose `overflow-y: auto` would otherwise turn any
 * sideways overhang into a horizontal scrollbar - never scrolls sideways, and
 * no seat (UTG / CO on the side rails, SB at the bottom) is ever cut off.
 */
test("the table fits the dock: no sideways scroll, every seat inside its box", async ({
  page,
}) => {
  const dock = page.getByTestId("mobile-dock");
  await expect(page.getByTestId("segment-table")).toHaveAttribute("data-active", "true");
  await expect(dock.getByRole("button", { name: "Seat UTG", exact: true })).toBeVisible();

  const fit = await dock.evaluate((el) => {
    const box = el.querySelector('[data-testid="poker-table"]')!.getBoundingClientRect();
    const seats = Array.from(el.querySelectorAll('button[aria-label^="Seat "]')).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        name: b.getAttribute("aria-label"),
        inside:
          r.left >= box.left - 0.5 &&
          r.right <= box.right + 0.5 &&
          r.top >= box.top - 0.5 &&
          r.bottom <= box.bottom + 0.5,
      };
    });
    return { overflowX: el.scrollWidth - el.clientWidth, seats };
  });

  expect(fit.overflowX, "dock scrolls sideways").toBeLessThanOrEqual(1);
  expect(fit.seats.length).toBe(8);
  for (const seat of fit.seats) {
    expect(seat.inside, `${seat.name} leaves the table box`).toBe(true);
  }
});

/**
 * The dock adapts to the room it gets. A phone shows one panel at a time
 * behind the tabs (every test above), but a portrait tablet has room beside
 * the table and a tall narrow window has room below it: there the hands
 * panel is simply on screen next to / under the table, with no tab to tap,
 * so none of that width or height is left as empty backdrop.
 */
test("a portrait tablet seats the hands panel beside the table, no tabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 }); // iPad Air portrait
  const dock = page.getByTestId("mobile-dock");
  await expect(dock).toHaveAttribute("data-arrangement", "wide");
  await expect(page.getByTestId("segment-table")).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Seat UTG", exact: true })).toBeVisible();
  await expect(dock.getByText(/hover or click a hand/i)).toBeVisible();

  // Side by side: the hands panel starts to the right of the table.
  const table = await dock.locator('[data-testid="poker-table"]').boundingBox();
  const hint = await dock.getByText(/hover or click a hand/i).boundingBox();
  if (!table || !hint) throw new Error("dock panels not rendered");
  expect(hint.x).toBeGreaterThan(table.x + table.width);

  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { y: de.scrollHeight - de.clientHeight, x: de.scrollWidth - de.clientWidth };
  });
  expect(overflow.y).toBeLessThanOrEqual(1);
  expect(overflow.x).toBeLessThanOrEqual(1);
});

test("a tall narrow window seats the hands panel under the table, no tabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 1100 });
  const dock = page.getByTestId("mobile-dock");
  await expect(dock).toHaveAttribute("data-arrangement", "tall");
  await expect(page.getByTestId("segment-table")).toHaveCount(0);
  await expect(dock.getByText(/hover or click a hand/i)).toBeVisible();

  const table = await dock.locator('[data-testid="poker-table"]').boundingBox();
  const hint = await dock.getByText(/hover or click a hand/i).boundingBox();
  if (!table || !hint) throw new Error("dock panels not rendered");
  expect(hint.y).toBeGreaterThan(table.y + table.height);

  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { y: de.scrollHeight - de.clientHeight, x: de.scrollWidth - de.clientWidth };
  });
  expect(overflow.y).toBeLessThanOrEqual(1);
  expect(overflow.x).toBeLessThanOrEqual(1);
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
