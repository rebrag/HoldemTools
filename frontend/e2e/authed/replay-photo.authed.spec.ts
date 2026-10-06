import { test, expect } from "./fixtures/readOnly";

/**
 * In the hand replayer a linked player's photo is a tap target that enlarges
 * it (the same lightbox the player editor uses), and only when there IS a
 * photo - a linked player without one keeps an inert initials avatar.
 *
 * Needs the real roster, so it lives in the authed lane: under the mocked
 * suite's auth bypass no roster loads and no seat ever resolves an avatar.
 * Real data drifts, so the spec finds a hand whose list row shows a player
 * photo and stays loose about which hand that is.
 */
test("tapping a player's photo in a replay enlarges it", async ({ page }) => {
  await page.goto("/hand-history");

  // A row that shows a player photo thumbnail is a hand with a photo to open.
  const row = page.locator("ul.divide-y li").filter({ has: page.locator("img") }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const href = await row.getByRole("link", { name: "Replay hand" }).getAttribute("href");
  if (!href) throw new Error("replay row has no replay link");
  // Open in place rather than through the link: on desktop it targets a new
  // tab, and the route alone is what matters here.
  await page.goto(href);

  const photo = page.getByRole("button", { name: /^View .*'s photo$/ }).first();
  await expect(photo).toBeVisible({ timeout: 20_000 });

  // Run the hand, then open a photo: the lightbox holds the frame still.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await photo.click();

  const lightbox = page.getByRole("dialog", { name: /, enlarged$/ });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  // Initials-only avatars (no photo) are not targets: the only role=button
  // avatars on the table are the ones that name a photo.
  const avatarButtons = page.locator('button[aria-label^="Seat "] [role="button"]');
  for (const label of await avatarButtons.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? "")
  )) {
    expect(label).toMatch(/^View .*'s photo$/);
  }
});
