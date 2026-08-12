import { test, expect, type Page } from "@playwright/test";

/**
 * Two behaviours the hand-history section owes its users, neither of which any
 * component test can see because both live on the document:
 *
 *  - The list, the recorder and the replayer all budget their layout to the
 *    viewport, so they suppress document-level overscroll (`no-overscroll` on
 *    <html>, see useNoOverscroll). Leaving the section has to release it, or
 *    every other page inherits a rubber-band it never asked to lose.
 *  - Opening a replay leaves the list, so it opens in a new tab and the list
 *    the user was reading stays exactly where it was.
 *
 * No API stubs: signed out, /hand-history reads the device-local store and the
 * dev-only sample hand, so nothing here reaches a real endpoint.
 */

const htmlClass = (page: Page) =>
  page.evaluate(() => document.documentElement.className);

/** Tools sit inline on the desktop navbar and behind a "Tools" dropdown on
 *  mobile, so reveal them only when they are not already on screen. */
const gotoTool = async (page: Page, name: string) => {
  const tool = page.getByRole("button", { name }).first();
  if (!(await tool.isVisible())) await page.getByRole("button", { name: "Tools" }).click();
  await tool.click();
};

test("hand-history routes suppress overscroll, and release it on leave", async ({
  page,
}) => {
  await page.goto("/hand-history");
  await expect.poll(() => htmlClass(page)).toContain("no-overscroll");

  await page.getByRole("button", { name: "Create HH" }).click();
  await expect(page).toHaveURL(/\/hand-history\/create/);
  await expect.poll(() => htmlClass(page)).toContain("no-overscroll");

  await gotoTool(page, "Equity Calculator");
  await expect(page).toHaveURL(/\/equity/);
  await expect.poll(() => htmlClass(page)).not.toContain("no-overscroll");
});

test("a replay opens in a new tab, leaving the list where it was", async ({
  page,
  context,
}) => {
  await page.goto("/hand-history");

  const link = page.getByRole("link", { name: "Replay hand" }).first();
  await expect(link).toHaveAttribute("target", "_blank");

  const [replay] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await expect(replay).toHaveURL(/\/hand-history\/replay\//);
  await expect(page).toHaveURL(/\/hand-history$/);
  await expect.poll(() => htmlClass(replay)).toContain("no-overscroll");
});
