import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * The recorder's seat editor shares the board picker's overlay shell
 * (ResponsiveDrawer): a bottom sheet on a phone, a centered modal on desktop.
 * It also shares the dismissal contract - backdrop/Escape COMMIT the edit,
 * with Cancel as the explicit way to back out untouched - so tapping away
 * after typing a name must not silently discard it.
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

test("the seat editor is a bottom sheet on a phone", async ({
  page,
  isMobile,
  viewport,
}) => {
  test.skip(!isMobile, "desktop keeps the centered-modal presentation");

  await page.getByRole("button", { name: /^Seat / }).first().click();
  const box = (await page.getByRole("dialog").boundingBox())!;

  expect(box.x).toBeLessThanOrEqual(0.5); // full-bleed...
  expect(box.width).toBeGreaterThanOrEqual(viewport!.width - 0.5);
  expect(box.y + box.height).toBeGreaterThanOrEqual(viewport!.height - 0.5); // ...and flush to the bottom
});

test("and a centered modal on desktop", async ({ page, isMobile, viewport }) => {
  test.skip(!!isMobile, "mobile counterpart above");

  await page.getByRole("button", { name: /^Seat / }).first().click();
  const box = (await page.getByRole("dialog").boundingBox())!;

  expect(box.width).toBeLessThan(viewport!.width / 2);
  // Floating, not docked: real space below it.
  expect(viewport!.height - (box.y + box.height)).toBeGreaterThan(20);
});

test("dismissing by backdrop commits the edit", async ({ page, viewport }) => {
  await page.getByRole("button", { name: /^Seat / }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/^Name/).fill("Alice");

  // Aim at backdrop the layout actually leaves exposed: beside the centered
  // desktop modal, above the full-width mobile sheet. Deliberately not the
  // top-left corner - the drawer closes on mousedown, so the mouseup half of
  // that click would land on the navbar's menu button underneath.
  const panel = (await dialog.boundingBox())!;
  const beside = panel.width < viewport!.width - 40;
  // The mobile sheet is tall, so halve whatever strip it leaves exposed above
  // itself instead of assuming 20px of clearance exists.
  await page.mouse.click(
    beside ? panel.x / 2 : viewport!.width / 2,
    beside ? panel.y + panel.height / 2 : Math.max(16, panel.y / 2)
  );
  await expect(dialog).toBeHidden();

  // Committed, not discarded.
  await expect(page.getByRole("button", { name: "Seat Alice" })).toBeVisible();
});

test("Cancel backs out without keeping the edit", async ({ page }) => {
  const seat = page.getByRole("button", { name: /^Seat / }).first();
  const original = await seat.getAttribute("aria-label");

  await seat.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/).fill("Bob");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("button", { name: "Seat Bob" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: original! })).toBeVisible();
});
