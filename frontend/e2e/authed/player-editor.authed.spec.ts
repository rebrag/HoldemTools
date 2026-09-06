import { test, expect } from "./fixtures/readOnly";

/**
 * The player editor's two reference features, against the account's real
 * roster: the "Showdown hands" section under Delete, and the photo lightbox.
 *
 * The mocked suite cannot reach this: under the dev auth bypass the roster
 * hook sees no Firebase user, so the roster never loads and the editor only
 * ever opens as "New player". Real data drifts, so assertions stay loose -
 * the section exists and settles into a list or its empty state, and the
 * lightbox is only exercised when the first player happens to have a photo.
 */
test("editing a player lists their showdown hands and enlarges their photo", async ({
  page,
}) => {
  await page.goto("/hand-history/players");

  const firstRow = page.locator("ul li button").first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  await firstRow.click();

  const editor = page.getByRole("dialog", { name: "Edit player" });
  await expect(editor).toBeVisible();

  // The section is present as soon as the editor opens, and resolves to
  // either card fans or the empty note (never a stuck spinner).
  const section = editor.getByRole("region", { name: "Showdown hands" });
  await expect(section).toBeVisible();
  await expect(
    section.locator("ul li").first().or(section.getByText(/showed cards yet/))
  ).toBeVisible({ timeout: 20_000 });

  const view = editor.getByRole("button", { name: "View photo" });
  if ((await view.count()) === 0) {
    // No photo on this player: tapping the avatar is still the "add" path.
    await expect(editor.getByRole("button", { name: "Add photo" })).toBeVisible();
    return;
  }

  await view.click();
  const lightbox = page.getByRole("dialog", { name: /, enlarged$/ });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toBeVisible();

  // Escape closes only the lightbox; the editor underneath stays put.
  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
  await expect(editor).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});
