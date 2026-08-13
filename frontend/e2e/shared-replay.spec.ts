import { test, expect } from "@playwright/test";

/**
 * A hand's replay link is meant to be sendable: the recipient is not signed
 * in, and the page must resolve from that one hand alone. This pins the whole
 * public path - no Firebase session, no authed request, exactly one anonymous
 * fetch for the hand being watched.
 */

const TOKEN = "sharedtoken123456789ab";

test("a shared replay opens with no auth and only that hand's data", async ({ page }) => {
  // Build the fixture hand's text (payload included) via the app's own module,
  // so the shared hand is a real one rather than a hand-written blob. The
  // specifier is passed in as a value: it is a URL the dev server resolves at
  // runtime, not a module this spec can import (tsc would try to find it).
  // The homepage fires a best-effort SQL warm-up at the real API, throttled
  // hourly through this key (see Homepage.tsx). It has nothing to do with the
  // shared path, but it is in flight while the route below is being registered,
  // so whether it lands as an "other" API call is a pure race - and when it
  // loses, the request escapes the suite to Azure. Pre-dating the throttle
  // stops it firing at all.
  await page.addInitScript(() => {
    window.localStorage.setItem("ht_sql_warmup_last_hit_v1", String(Date.now()));
  });

  await page.goto("/");
  const rawText = await page.evaluate(async (modulePath) => {
    const fixture = (await import(modulePath)) as { buildTestHandText: () => string };
    return fixture.buildTestHandText();
  }, "/src/pages/handhistory/create/testHand.ts");

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
