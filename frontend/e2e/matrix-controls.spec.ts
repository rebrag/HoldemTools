import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * The desktop study layout groups every control that changes how the matrix
 * draws - display mode, single-range toggle, cell height - into one row
 * directly above the matrix, and keeps the solved-flops library button in the
 * sim panel beside the search input.
 *
 * Two invariants here are the kind that read fine in review and break in use:
 *
 * 1. Both menus in that row hang off a hand-positioned edge. The cell-height
 *    menu is anchored to its button's RIGHT edge by default, which is correct
 *    when the pill sits at the end of a wide row but puts a 240px menu at a
 *    negative x once the pill is left-grouped near the viewport edge - hence
 *    its `align` prop. Nothing else measures popover geometry.
 *
 * 2. The single-range pill carries the intro tour's `color-key-btn` target and
 *    must be mounted exactly once. It moved out of the sim panel into this row,
 *    so in the study layout it comes from the view while the other three
 *    layouts still get it from FolderSelector. Two copies (or none) breaks the
 *    tour silently: the readiness gate just never fires, with no error.
 */

let api: ApiStub;

const BOOT_TIMEOUT = 45_000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
  });
  api = await stubSolverApi(page);
  await page.goto("/solutions");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

/** Count the tour's two anchors; both must be unique in every layout. */
const tourTargets = (page: Page) =>
  page.evaluate(() => ({
    folder: document.querySelectorAll('[data-intro-target="folder-selector"]').length,
    colorKey: document.querySelectorAll('[data-intro-target="color-key-btn"]').length,
  }));

test.describe("desktop study control row", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "study layout is desktop-only");
    await expect(page.getByTestId("hand-cell").first()).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });
  });

  test("all three matrix controls share one row above the matrix", async ({
    page,
  }) => {
    const box = async (locator: ReturnType<Page["locator"]>) => {
      const b = await locator.boundingBox();
      if (!b) throw new Error("control not rendered");
      return b;
    };

    const display = await box(page.getByTestId("display-mode-btn"));
    const single = await box(page.getByRole("button", { name: /single range/i }));
    const height = await box(page.getByTestId("height-mode-btn"));
    const matrix = await box(page.getByTestId("hand-cell").first());

    // Same baseline: equal heights, tops within a pixel of each other.
    for (const c of [single, height]) {
      expect(c.height).toBeCloseTo(display.height, 0);
      expect(Math.abs(c.y - display.y)).toBeLessThanOrEqual(1);
    }
    // Left-to-right in that order, and all of them above the grid.
    expect(display.x).toBeLessThan(single.x);
    expect(single.x).toBeLessThan(height.x);
    expect(display.y + display.height).toBeLessThanOrEqual(matrix.y);
  });

  test("neither menu is clipped by the viewport", async ({ page }) => {
    const width = page.viewportSize()!.width;

    for (const [btn, menu] of [
      ["display-mode-btn", "display-mode-menu"],
      ["height-mode-btn", "height-mode-menu"],
    ] as const) {
      await page.getByTestId(btn).click();
      const box = await page.getByTestId(menu).boundingBox();
      if (!box) throw new Error(`${menu} did not open`);
      expect(box.x, `${menu} runs off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${menu} runs off the right edge`).toBeLessThanOrEqual(
        width
      );
      // Close it again so the next button is not covered.
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId(menu)).toBeHidden();
    }
  });

  test("the sim panel holds the library button, not the matrix pills", async ({
    page,
  }) => {
    const panel = page.locator('[data-intro-target="folder-selector"]');
    await expect(panel.getByPlaceholder("Select Sim")).toBeVisible();
    await expect(panel.getByRole("button", { name: /solved flops/i })).toBeVisible();
    // The two pills moved out of this panel and up to the matrix.
    await expect(panel.getByTestId("height-mode-btn")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /single range/i })).toHaveCount(0);
  });

  test("the tour anchors stay unique in the study layout", async ({ page }) => {
    expect(await tourTargets(page)).toEqual({ folder: 1, colorKey: 1 });
  });

  test("the page fits the viewport exactly, at any height", async ({ page }) => {
    /* The study layout budgets its height from the viewport, so any chrome it
     * fails to account for shows up as a few pixels of scroll - which is what
     * the page wrapper's bottom padding used to do. Allow 1px for subpixel
     * rounding of the square matrix.
     *
     * Checked at two heights because the matrix grows to fill the taller one:
     * a budget that is merely off by a constant would pass at one size. */
    const overflow = () =>
      page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollHeight - de.clientHeight;
      });
    const matrixWidth = () =>
      page
        .locator(".grid-cols-13")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));

    expect(await overflow()).toBeLessThanOrEqual(1);
    const short = await matrixWidth();

    await page.setViewportSize({ width: 1600, height: 1200 });
    await expect
      .poll(matrixWidth, { message: "matrix did not grow with the viewport" })
      .toBeGreaterThan(short);
    expect(await overflow()).toBeLessThanOrEqual(1);
  });

  test("the breakdown previews on hover and pins on click", async ({ page }) => {
    const cell = (hand: string) =>
      page.locator(`[data-testid="hand-cell"][data-hand="${hand}"]`);
    const pinned = page.locator('[data-testid="hand-cell"][data-selected="1"]');
    /* The panel header names the hand it is showing, so it distinguishes a
     * preview from a pin without depending on tile contents. */
    const showing = page.getByText(/^\S+ · \d+ combos$/);

    // Nothing pinned: the pointer drives the panel, but never pins.
    await expect(page.getByText(/hover or click a hand in the matrix/i)).toBeVisible();
    await cell("AKo").hover();
    await expect(showing).toHaveText("AKo · 12 combos");
    await expect(pinned).toHaveCount(0);

    await cell("A5s").hover();
    await expect(showing).toHaveText("A5s · 4 combos");
    await expect(pinned).toHaveCount(0);

    // Clicking pins that hand and rings its cell.
    await cell("A5s").click();
    await expect(cell("A5s")).toHaveAttribute("data-selected", "1");
    await expect(pinned).toHaveCount(1);

    // While pinned the pointer no longer moves the panel - the point of a pin.
    await cell("72o").hover();
    await expect(showing).toHaveText("A5s · 4 combos");
    await expect(cell("A5s")).toHaveAttribute("data-selected", "1");

    // Clicking a different cell moves the pin; only ever one is pinned.
    await cell("72o").click();
    await expect(cell("72o")).toHaveAttribute("data-selected", "1");
    await expect(cell("A5s")).toHaveAttribute("data-selected", "0");
    await expect(pinned).toHaveCount(1);

    // Clicking the pinned cell again releases it, handing the panel back to
    // the pointer - which is still over that same cell.
    await cell("72o").click();
    await expect(pinned).toHaveCount(0);
    await expect(showing).toHaveText("72o · 12 combos");

    // ...and hover drives it again from there.
    await cell("AKo").hover();
    await expect(showing).toHaveText("AKo · 12 combos");
    await expect(pinned).toHaveCount(0);
  });
});

test("the tour anchors stay unique after leaving the study layout", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "starts from the study layout");
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({
    timeout: BOOT_TIMEOUT,
  });

  // Study layout -> multi-range: the pill must hand off to FolderSelector,
  // which is the other component that renders it. The wide search placeholder
  // is what tells us ClassicHeader/FolderSelector has taken over from
  // StudyTopStrip/SimSelect's compact "Select Sim" trigger.
  await page.getByRole("button", { name: /single range/i }).click();
  await expect(page.getByPlaceholder(/Preflop Solutions/i)).toBeVisible();
  expect(await tourTargets(page)).toEqual({ folder: 1, colorKey: 1 });
});

test("the tour anchors stay unique on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({
    timeout: BOOT_TIMEOUT,
  });
  expect(await tourTargets(page)).toEqual({ folder: 1, colorKey: 1 });
});

test("the mobile single-range layout fits the viewport too", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({
    timeout: BOOT_TIMEOUT,
  });
  /* The mobile view sizes the range to fill what the table leaves behind, from
   * the same measured budget as the desktop study view, so it shares the same
   * failure mode. The grid's last row is what falls off the bottom first. */
  const lastCell = page.locator('[data-testid="hand-cell"][data-hand="22"]');
  await expect(lastCell).toBeInViewport();
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollHeight - de.clientHeight;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
