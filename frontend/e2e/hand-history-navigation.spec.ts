import { test, expect, type Page } from "@playwright/test";

/**
 * Two behaviours the hand-history section owes its users, neither of which any
 * component test can see because both live on the document:
 *
 *  - The list, the recorder and the replayer all budget their layout to the
 *    viewport, so they suppress document-level overscroll (`no-overscroll` on
 *    <html>, see useNoOverscroll). Leaving the section has to release it, or
 *    every other page inherits a rubber-band it never asked to lose.
 *  - Opening a replay leaves the list. On desktop it opens in a new tab so the
 *    list stays exactly where it was; on touch devices it navigates in place,
 *    because on iOS a tab opened from a page shares the opener's WebContent
 *    process and a second live copy of the app in that process is what got
 *    replay tabs killed with Safari's "A problem repeatedly occurred"
 *    (see HandSummaryRow / lib/pointer.ts).
 *
 * Signed out, /hand-history reads the device-local store and the dev-only
 * sample hand, so nothing here reaches a real endpoint. The one exception is
 * the overscroll test, which leaves via Bankroll Tracker and stubs /api/* so
 * that page's fetches stay off the network too.
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
  // Leaving must be an SPA navigation (a full load starts without the class and
  // would pass vacuously), and the destination must not suppress overscroll
  // itself. Of the navbar tools that leaves Bankroll Tracker (Solutions also
  // suppresses it), which sits behind the auth gate - so sign the dev-bypass
  // user in, and stub its API calls to keep the test off the network.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
  await page.goto("/hand-history");
  await expect.poll(() => htmlClass(page)).toContain("no-overscroll");

  await page.getByRole("button", { name: "Create HH" }).click();
  await expect(page).toHaveURL(/\/hand-history\/create/);
  await expect.poll(() => htmlClass(page)).toContain("no-overscroll");

  await page.evaluate(() =>
    (window as unknown as { __devAuth: { signIn: () => void } }).__devAuth.signIn()
  );
  await gotoTool(page, "Bankroll Tracker");
  await expect(page).toHaveURL(/\/bankroll/);
  await expect.poll(() => htmlClass(page)).not.toContain("no-overscroll");
});

test("desktop: a replay opens in a new tab, leaving the list where it was", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!!isMobile, "touch devices navigate in place - see the mobile variant");
  await page.goto("/hand-history");

  const link = page.getByRole("link", { name: "Replay hand" }).first();
  await expect(link).toHaveAttribute("target", "_blank");

  const [replay] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await expect(replay).toHaveURL(/\/hand-history\/replay\//);
  await expect(page).toHaveURL(/\/hand-history$/);
  await expect.poll(() => htmlClass(replay)).toContain("no-overscroll");
});

test("mobile: a replay navigates in place, and Back returns to the list", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "desktop keeps the new tab - see the desktop variant");
  await page.goto("/hand-history");

  // No target="_blank": the same tab must host the replay (see header note).
  const link = page.getByRole("link", { name: "Replay hand" }).first();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("target");

  await link.click();
  await expect(page).toHaveURL(/\/hand-history\/replay\//);
  await expect.poll(() => htmlClass(page)).toContain("no-overscroll");

  // The list is one Back away - SPA history, not a lost tab.
  await page.goBack();
  await expect(page).toHaveURL(/\/hand-history$/);
});
