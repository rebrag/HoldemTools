import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";

/**
 * In the single-range view the poker table's seats navigate the preflop tree
 * the same way the line strip's cards do - clicking a seat puts that player on
 * the spot, folding everyone in front of them, so their range is what you get
 * "as if it folded to them". Seats that already acted rewind to their own
 * decision instead.
 *
 * Two surfaces, one rule (see solver/seatNavigation.ts): the point of this spec
 * is that the table agrees with the strip rather than growing its own variant.
 */

let api: ApiStub;

const tableSeat = (page: Page, seat: string) =>
  page.getByRole("button", { name: `Seat ${seat}`, exact: true });

const activeCard = (page: Page) =>
  page.locator('[data-testid="line-card"][data-active="true"]');

const lineCard = (page: Page, seat: string) =>
  page.locator(`[data-testid="line-card"][data-seat="${seat}"]`);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
  });
  api = await stubSolverApi(page);
  await page.goto("/solutions");
  await expect(lineCard(page, "UTG")).toHaveAttribute("data-active", "true");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("clicking a seat still to act folds the seats in front of it", async ({ page }) => {
  await tableSeat(page, "CO").click();

  await expect(lineCard(page, "CO")).toHaveAttribute("data-active", "true");
  await expect(activeCard(page)).toHaveCount(1);
  // Everyone in front of CO is out, and their seats now point backwards.
  for (const seat of ["UTG", "UTG1", "LJ", "HJ"]) {
    await expect(tableSeat(page, seat)).toHaveAttribute(
      "title",
      `Back to ${seat}'s decision`
    );
  }
});

test("clicking a seat that already acted rewinds to its decision", async ({ page }) => {
  await tableSeat(page, "CO").click();
  await expect(lineCard(page, "CO")).toHaveAttribute("data-active", "true");

  await tableSeat(page, "UTG").click();
  await expect(lineCard(page, "UTG")).toHaveAttribute("data-active", "true");
  // Unwound: UTG is on the spot again, so the seats behind it are forward
  // targets rather than rewind ones.
  await expect(tableSeat(page, "CO")).toHaveAttribute("title", "Skip ahead to CO");
});

test("the seat on the spot is inert - there is nowhere to go", async ({ page }) => {
  const utg = tableSeat(page, "UTG");
  await expect(utg).not.toHaveAttribute("title", /./);
  await expect(utg).toHaveCSS("cursor", "default");
  // Its neighbours advertise themselves as clickable.
  await expect(tableSeat(page, "BTN")).toHaveCSS("cursor", "pointer");
});

test("the table and the line strip offer the same move for a seat", async ({ page }) => {
  /* Asserted rather than read back and compared: the skip targets only appear
     once the acting seat's plate has loaded (that is what says it can pass the
     action on), so reading the two surfaces in separate round trips can catch
     them on either side of that flip. */
  for (const seat of ["UTG1", "BTN", "SB", "BB"]) {
    const expected = `Skip ahead to ${seat}`;
    await expect(lineCard(page, seat)).toHaveAttribute("title", expected);
    await expect(tableSeat(page, seat)).toHaveAttribute("title", expected);
  }
});
