import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * Hand recorder setup ergonomics:
 *
 * 1. "Quick setup" opens a drawer that takes every seat's name and stack in
 *    one list, instead of a tap-edit-save round trip per seat.
 * 2. Moving the dealer button must never change the page's scrollable area.
 *    The D badge hangs off its seat's right edge, and on the right-most seat
 *    that used to push past the viewport - iOS Safari then let the whole page
 *    pan sideways. The page root now clips horizontal overflow, so the
 *    invariant is: whatever seat holds the button, no horizontal scroll.
 */

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  api = await stubSolverApi(page);
  await page.goto("/hand-history/create");
  await expect(page.getByRole("button", { name: /quick setup/i })).toBeVisible();
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("quick setup fills every seat's name and stack in one pass", async ({
  page,
}) => {
  await page.getByRole("button", { name: /quick setup/i }).click();

  await page.getByLabel("Seat 1 name").fill("Alice");
  await page.getByLabel("Seat 1 stack").fill("200");
  await page.getByLabel("Seat 2 name").fill("Bob");
  await page.getByLabel("Seat 2 stack").fill("150");
  await page.getByRole("button", { name: "Apply" }).click();

  // The table's seat chips pick the names up immediately.
  await expect(page.getByRole("button", { name: "Seat Alice" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Seat Bob" })).toBeVisible();
});

test("unchecking a seat in quick setup empties it", async ({ page }) => {
  await page.getByRole("button", { name: /quick setup/i }).click();

  await page.getByLabel("Seat 3 occupied").uncheck();
  await page.getByRole("button", { name: "Apply" }).click();

  // An empty seat renders its "Empty" chip on the felt.
  await expect(page.getByRole("button", { name: "Seat Empty" })).toBeVisible();
});

test("moving the dealer button never widens the page", async ({ page }) => {
  const overflowX = (p: Page) =>
    p.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth - de.clientWidth;
    });

  expect(await overflowX(page)).toBeLessThanOrEqual(1);

  // Walk the button around the whole table; every stop must leave the page
  // exactly viewport-wide (the right-most seats are the ones that used to
  // overflow).
  const seats = page.getByRole("button", { name: /^Seat / });
  const count = await seats.count();
  for (let i = 0; i < count; i++) {
    await page.getByLabel("Move dealer button").click();
    await expect(page.getByText("Tap a seat to move the button")).toBeVisible();
    await seats.nth(i).click();
    await expect(page.getByText("Tap a seat to move the button")).toBeHidden();
    expect(await overflowX(page), `overflow with the button on seat ${i + 1}`)
      .toBeLessThanOrEqual(1);
  }
});
