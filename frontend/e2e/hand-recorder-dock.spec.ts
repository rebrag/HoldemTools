import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * On a phone the recorder's controls column is docked to the bottom of the
 * viewport the same way the replayer docks its transport bar: a full-height
 * flex column with `mt-auto` on the last child, not a `fixed` overlay. Both
 * phases dock - the setup form and the action panel are the same column.
 *
 * From `lg` that column is beside the table rather than under it, and stays
 * top-aligned with the felt; bottom-docking a side column would only move the
 * dead space from below it to above it.
 *
 * The action panel's sizing row is deliberately short: 1/2 and Pot are the only
 * pot fractions worth a permanent button, All in sits beside them, and the
 * nudgers move in half a big blind rather than a single chip (at real stakes one
 * chip is a rounding error).
 */

let api: ApiStub;

/** Distance from the controls column's bottom edge to the page container's, in
 *  CSS pixels - i.e. how far the panel sits off the bottom of the page. */
const dockGap = (page: Page) =>
  page.evaluate(() => {
    const controls = document.querySelector('[data-testid="hh-controls"]')!;
    const root = controls.closest(".max-w-6xl")!;
    const pad = parseFloat(getComputedStyle(root).paddingBottom);
    return root.getBoundingClientRect().bottom - pad - controls.getBoundingClientRect().bottom;
  });

test.beforeEach(async ({ page }) => {
  api = await stubSolverApi(page);
  await page.goto("/hand-history/create");
  await expect(page.getByRole("button", { name: /quick setup/i })).toBeVisible();
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("the setup panel is docked to the bottom of the page", async ({ page, isMobile }) => {
  test.skip(!isMobile, "single-column layout only; lg puts the panel beside the table");

  expect(await dockGap(page)).toBeLessThanOrEqual(1);
});

test("the action panel is docked to the bottom too", async ({ page, isMobile }) => {
  test.skip(!isMobile, "single-column layout only; lg puts the panel beside the table");

  await page.getByRole("button", { name: /Start/ }).click();
  await expect(page.getByRole("button", { name: "Fold" })).toBeVisible();

  expect(await dockGap(page)).toBeLessThanOrEqual(1);
});

test("on desktop the panel stays beside the table, top-aligned", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop-only counterpart to the docking assertions");

  const boxes = await page.evaluate(() => {
    const controls = document.querySelector('[data-testid="hh-controls"]')!;
    const table = controls.previousElementSibling!;
    const c = controls.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    return { cTop: c.top, cLeft: c.left, tTop: t.top, tRight: t.right };
  });
  expect(boxes.cLeft).toBeGreaterThan(boxes.tRight - 1); // side by side
  expect(Math.abs(boxes.cTop - boxes.tTop)).toBeLessThanOrEqual(1); // not pushed down
});

test("sizing offers 1/2, Pot and All in - and nudges by half a big blind", async ({
  page,
}) => {
  // 2/5: a big blind of 5 makes the 0.5BB step (2.5) unmistakably not 1 chip.
  await page.getByLabel("Small blind").fill("2");
  await page.getByLabel("Big blind").fill("5");
  await page.getByRole("button", { name: /Start/ }).click();

  const panel = page.locator('[data-testid="hh-controls"]');
  await expect(panel.getByRole("button", { name: "1/2", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Pot", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "All in", exact: true })).toBeVisible();
  // The two fractions that were only ever a nudge away are gone.
  await expect(panel.getByRole("button", { name: "1/4", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "3/4", exact: true })).toHaveCount(0);

  const size = panel.locator('input[inputmode="decimal"]');
  const read = async () => Number(await size.inputValue());

  const before = await read();
  await panel.getByLabel("Increase").click();
  expect(await read()).toBeCloseTo(before + 2.5, 5);
  await panel.getByLabel("Decrease").click();
  expect(await read()).toBeCloseTo(before, 5);

  // All in is the largest sizing on offer - strictly above a pot-sized bet.
  await panel.getByRole("button", { name: "Pot", exact: true }).click();
  const pot = await read();
  await panel.getByRole("button", { name: "All in", exact: true }).click();
  expect(await read()).toBeGreaterThan(pot);
});
