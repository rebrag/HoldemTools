import { test, expect } from "@playwright/test";

/**
 * A hand's replay link is meant to be sendable: the recipient is not signed
 * in, and the page must resolve from that one hand alone. This pins the whole
 * public path - no Firebase session, no authed request, exactly one anonymous
 * fetch for the hand being watched.
 */

const TOKEN = "sharedtoken123456789ab";

test("a shared replay opens with no auth and only that hand's data", async ({ page }) => {
  // Build the fixture hand's text (payload included) via the app's own module.
  await page.goto("/");
  const rawText = await page.evaluate(async () => {
    const fixture = await import("/src/pages/handhistory/create/testHand.ts");
    return fixture.buildTestHandText();
  });

  const authed: string[] = [];
  const sharedCalls: string[] = [];
  const otherApiCalls: string[] = [];

  // Anything carrying an Authorization header is a request a signed-out
  // recipient could not have made.
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (route.request().headers()["authorization"]) authed.push(url);
    if (url.includes("/api/shared/")) {
      sharedCalls.push(url);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rawText }),
      });
      return;
    }
    otherApiCalls.push(url);
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  // A recipient arrives cold: no stored session, no dev-auth flag.
  await page.context().clearCookies();
  await page.goto(`/hand-history/shared/${TOKEN}`, { waitUntil: "domcontentloaded" });

  // The table renders with the hand's seats and stacks, so it resolved end to
  // end - and it is flagged as a shared view.
  await expect(page.getByRole("button", { name: /^Seat BTN/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Shared", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" }).first()).toBeVisible();

  // One hand's worth of data and nothing else: no library listing, no authed
  // request. (Counting DISTINCT urls because React StrictMode double-invokes
  // effects in the dev server this suite runs against.)
  expect(new Set(sharedCalls).size).toBe(1);
  expect(sharedCalls[0]).toContain(TOKEN);
  expect(otherApiCalls).toEqual([]);
  expect(authed).toEqual([]);
});
