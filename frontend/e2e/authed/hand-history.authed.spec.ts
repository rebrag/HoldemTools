import { test, expect } from "./fixtures/readOnly";

/**
 * Proof spec for the authed lane: the restored real session produces a real
 * Firebase JWT that the deployed API accepts on an [Authorize] endpoint, and
 * the account's real hand histories render.
 *
 * Real data drifts, so assertions stay loose - presence and status, never
 * exact rows, and no screenshot baselines in this lane.
 */
test("signed-in account loads its real hand histories", async ({ page }) => {
  const listResponse = page.waitForResponse(
    (res) => res.url().toLowerCase().includes("/api/handhistory") && res.request().method() === "GET",
  );
  await page.goto("/hand-history");

  // The real JWT must clear the [Authorize] gate - a 401 here means the
  // restored session did not survive into this context.
  expect((await listResponse).status()).toBe(200);

  await expect(page.getByText(/couldn't load your hand histories/i)).toHaveCount(0);
  // The account has sample hands, so the list should be non-empty.
  await expect(page.locator("ul.divide-y li").first()).toBeVisible({ timeout: 20_000 });
});
