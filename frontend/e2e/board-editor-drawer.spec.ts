import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * The recorder's board card picker is the shared ResponsiveDrawer: a bottom
 * sheet on a phone, a centered modal on desktop.
 *
 * It also opens itself. Closing the flop's betting deals the turn and closing
 * the turn's deals the river, so the recorder asks for that card right then
 * rather than leaving the board half-empty until showdown - where a missing
 * card silently downgrades the winner to a manual pick.
 *
 * The sheet always fills the earliest empty slot, so it doubles as the catch-up
 * for a board that was never filled in: the flop gets no prompt of its own, but
 * a missing flop is what the turn's prompt asks for first.
 */

let api: ApiStub;

const controls = (page: Page) => page.locator('[data-testid="hh-controls"]');

/** Close the current betting round's next decision, whatever it is. */
const checkOrCall = async (page: Page) => {
  const panel = controls(page);
  const check = panel.getByRole("button", { name: "Check", exact: true });
  if (await check.isVisible()) await check.click();
  else await panel.getByRole("button", { name: /^Call/ }).click();
};

/** Tap a rank then a suit on the keypad, which emits the completed card. */
const pickCard = async (page: Page, rank: string, suit: string) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: rank, exact: true }).click();
  await dialog.getByRole("button", { name: `suit ${suit}` }).click();
};

/** Heads-up, so a street is two clicks wide. `flop` mirrors the normal path:
 *  the three cards are on the felt before the hand is recorded. */
const startHeadsUp = async (page: Page, opts: { flop?: boolean } = {}) => {
  await page.getByLabel("Table size").selectOption("2");
  if (opts.flop) {
    await page.getByRole("button", { name: "Edit board" }).click();
    await pickCard(page, "A", "♥");
    await pickCard(page, "K", "♦");
    await pickCard(page, "7", "♣");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.getByRole("button", { name: /Start/ }).click();
  await expect(controls(page).getByRole("button", { name: "Fold" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  api = await stubSolverApi(page);
  await page.goto("/hand-history/create");
  await expect(page.getByRole("button", { name: /quick setup/i })).toBeVisible();
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("the picker is a bottom sheet on a phone", async ({ page, isMobile, viewport }) => {
  test.skip(!isMobile, "desktop keeps the centered-modal presentation");

  await page.getByRole("button", { name: "Edit board" }).click();
  const box = (await page.getByRole("dialog").boundingBox())!;

  expect(box.x).toBeLessThanOrEqual(0.5); // full-bleed...
  expect(box.width).toBeGreaterThanOrEqual(viewport!.width - 0.5);
  expect(box.y + box.height).toBeGreaterThanOrEqual(viewport!.height - 0.5); // ...and flush to the bottom
});

test("and a centered modal on desktop", async ({ page, isMobile, viewport }) => {
  test.skip(!!isMobile, "mobile counterpart above");

  await page.getByRole("button", { name: "Edit board" }).click();
  const box = (await page.getByRole("dialog").boundingBox())!;

  expect(box.width).toBeLessThan(viewport!.width / 2);
  // Floating, not docked: real space below it.
  expect(viewport!.height - (box.y + box.height)).toBeGreaterThan(20);
});

test("the turn card is asked for when the flop's betting closes", async ({ page }) => {
  await startHeadsUp(page, { flop: true });

  await checkOrCall(page); // preflop
  await checkOrCall(page);
  await expect(page.getByRole("dialog")).toBeHidden(); // the flop gets no prompt

  await checkOrCall(page); // flop
  await checkOrCall(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Tap the turn card");
});

test("the river follows once the turn's betting closes", async ({ page }) => {
  await startHeadsUp(page, { flop: true });
  for (let i = 0; i < 4; i++) await checkOrCall(page); // preflop + flop

  await expect(page.getByRole("dialog")).toContainText("Tap the turn card");
  await pickCard(page, "9", "♦");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await checkOrCall(page); // turn
  await checkOrCall(page);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Tap the river card");
});

test("dismissing it does not re-open it for the same street", async ({ page }) => {
  await startHeadsUp(page, { flop: true });
  for (let i = 0; i < 4; i++) await checkOrCall(page);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Acting on the turn must not drag it back up...
  await checkOrCall(page);
  await expect(page.getByRole("dialog")).toBeHidden();

  // ...but the next street gets its own prompt, which asks for the turn card
  // that is still missing before it asks for the river.
  await checkOrCall(page);
  await expect(page.getByRole("dialog")).toContainText("Tap the turn card");
});

test("an unfilled board is caught up by the turn's prompt", async ({ page }) => {
  await startHeadsUp(page); // no flop entered

  for (let i = 0; i < 4; i++) await checkOrCall(page);

  // Earliest gap first: three flop cards are owed before the turn is.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Tap the flop card");

  await pickCard(page, "A", "♥");
  await pickCard(page, "K", "♦");
  await pickCard(page, "7", "♣");
  await expect(dialog).toContainText("Tap the turn card");
});

test("a board entered up front is not asked about again", async ({ page }) => {
  await page.getByLabel("Table size").selectOption("2");

  // Flop + turn, both known before the hand is recorded.
  await page.getByRole("button", { name: "Edit board" }).click();
  await pickCard(page, "A", "♥");
  await pickCard(page, "K", "♦");
  await pickCard(page, "7", "♣");
  await pickCard(page, "2", "♠");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: /Start/ }).click();
  for (let i = 0; i < 4; i++) await checkOrCall(page);

  // The turn is already known, so nothing interrupts.
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("dismissing by backdrop keeps the card that was just tapped", async ({
  page,
  viewport,
}) => {
  await startHeadsUp(page, { flop: true });
  for (let i = 0; i < 4; i++) await checkOrCall(page);
  await expect(page.getByRole("dialog")).toBeVisible();

  // The keypad emits its completed card from an effect, so wait for the slot to
  // fill before dismissing - a synthetic click can outrun a frame in a way no
  // hand can.
  await pickCard(page, "Q", "♠");
  await expect(page.getByRole("dialog").getByLabel("Remove Qs")).toBeVisible();
  // Aim at backdrop the layout actually leaves exposed: beside the centered
  // desktop modal, above the full-width mobile sheet. Deliberately not the
  // top-left corner - the drawer closes on mousedown, so the mouseup half of
  // that click would land on the navbar's menu button underneath.
  const panel = (await page.getByRole("dialog").boundingBox())!;
  const beside = panel.width < viewport!.width - 40;
  await page.mouse.click(
    beside ? panel.x / 2 : viewport!.width / 2,
    beside ? panel.y + panel.height / 2 : Math.max(60, panel.y - 20)
  );
  await expect(page.getByRole("dialog")).toBeHidden();

  // Committed, not discarded: re-opening finds it on the turn.
  await page.getByRole("button", { name: "Edit board" }).click();
  await expect(page.getByRole("dialog").getByLabel("Remove Qs")).toBeVisible();
});
