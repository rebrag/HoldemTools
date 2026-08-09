import { test, expect, type Locator, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * The line strip is the only way around the tree, so every card on it has to
 * lead somewhere: a seat still to act is reached by getting the seats in front
 * of it out of the way, a seat that has already acted (folded ones included) by
 * rewinding to its own decision, and the first card - the root of the tree - by
 * unwinding the line entirely, which is why there is no separate reset control.
 *
 * The same has to hold from a board: its preflop cards leave the postflop
 * session, which is why the explicit "Preflop" exit is gone too. Both of those
 * removals are only safe while the cards themselves work, so they are pinned
 * here together.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

const seatCard = (page: Page, seat: string) =>
  page.locator(`[data-testid="line-card"][data-seat="${seat}"]`);

const activeSeat = (page: Page) =>
  page.locator('[data-testid="line-card"][data-active="true"]');

/**
 * Click a card's empty area, which is what navigates - its action rows take
 * their own click. The seat label is the one part of a card that is always
 * inert, and a plain `click()` would land in the middle of the card, on a row.
 */
const clickCard = (card: Locator, seat: string) =>
  card.getByText(seat, { exact: true }).click();

test.describe("preflop line", () => {
  let api: ApiStub;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tourSeen", "1");
      window.localStorage.setItem("singleRangeView", "1");
    });
    api = await stubSolverApi(page);
    await page.goto("/solutions");
    // The strip is only navigable once the plates behind it have loaded.
    await expect(seatCard(page, "UTG")).toHaveAttribute("data-active", "true");
  });

  test.afterEach(() => {
    if (api) expect(api.unhandled).toEqual([]);
  });

  test("has no reset control - the first card is the root", async ({ page }) => {
    await expect(page.getByTitle("Reset to start of hand")).toHaveCount(0);
  });

  test("clicking a seat still to act folds the seats in front of it", async ({
    page,
  }) => {
    await clickCard(seatCard(page, "BTN"), "BTN");

    await expect(seatCard(page, "BTN")).toHaveAttribute("data-active", "true");
    await expect(activeSeat(page)).toHaveCount(1);
    // Everyone in front of BTN is out, and their cards now point backwards.
    for (const seat of ["UTG", "UTG1", "LJ", "HJ", "CO"]) {
      await expect(seatCard(page, seat)).toHaveAttribute(
        "title",
        `Back to ${seat}'s decision`
      );
    }
    // Seats behind it are still reachable forwards.
    await expect(seatCard(page, "SB")).toHaveAttribute(
      "title",
      "Skip ahead to SB"
    );
  });

  test("clicking a seat that already folded rewinds to its decision", async ({
    page,
  }) => {
    await clickCard(seatCard(page, "BTN"), "BTN");
    await expect(seatCard(page, "BTN")).toHaveAttribute("data-active", "true");

    await clickCard(seatCard(page, "HJ"), "HJ");

    await expect(seatCard(page, "HJ")).toHaveAttribute("data-active", "true");
    // HJ is back on the spot, so the seats behind it are undecided again.
    await expect(seatCard(page, "CO")).toHaveAttribute(
      "title",
      "Skip ahead to CO"
    );
    await expect(seatCard(page, "BTN")).toHaveAttribute(
      "title",
      "Skip ahead to BTN"
    );
  });

  test("clicking the first card unwinds the whole line", async ({ page }) => {
    await clickCard(seatCard(page, "BTN"), "BTN");
    await expect(seatCard(page, "BTN")).toHaveAttribute("data-active", "true");

    await clickCard(seatCard(page, "UTG"), "UTG");

    await expect(seatCard(page, "UTG")).toHaveAttribute("data-active", "true");
    // Back at the root nothing has acted, so every other card leads forwards.
    for (const seat of ["UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]) {
      await expect(seatCard(page, seat)).toHaveAttribute(
        "title",
        `Skip ahead to ${seat}`
      );
    }
  });
});

test.describe("postflop line", () => {
  let api: ApiStub;

  /** The board's preflop cards - divs, unlike their action rows. */
  const preflopCards = (page: Page) =>
    page.locator('div[title$="preflop decision"]');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tourSeen", "1");
      window.localStorage.setItem("singleRangeView", "1");
      // The solved-flops library is auth-gated; playwright.config compiles the
      // dev auth bypass in, and this flips its store to signed in.
      window.localStorage.setItem("ht_dev_signed_in", "true");
    });
    api = await stubSolverApi(page, {
      postflop: { index, manifest, streets: { "r.0": flopBundle }, stacks },
    });
    await page.goto("/solutions");

    await page.getByRole("button", { name: /solution library/i }).click();
    // Boards render as PlayingCards, so the button's title is the only text.
    await page.locator(`button[title="Open ${board}"]`).click();
    await expect(page.getByTitle("Back to the flop decision")).toBeVisible();
  });

  test.afterEach(() => {
    if (api) expect(api.unhandled).toEqual([]);
  });

  test("has a card per preflop decision of the line that reached it", async ({
    page,
  }) => {
    await expect(preflopCards(page).first()).toBeVisible();
  });

  test("has no exit control - the preflop cards are the way out", async ({
    page,
  }) => {
    await expect(page.getByTitle("Exit postflop view")).toHaveCount(0);
  });

  test("clicking the first preflop card leaves the board at the root", async ({
    page,
  }) => {
    const first = preflopCards(page).first();
    const seat = (await first.getAttribute("title"))!.match(/Back to (\w+)'s/)![1];

    await clickCard(first, seat);

    // The board is gone - the flop card goes with it - and the preflop strip is
    // back with the line's first seat on the spot, which is the tree's root.
    await expect(page.getByTitle("Back to the flop decision")).toHaveCount(0);
    await expect(seatCard(page, seat)).toHaveAttribute("data-active", "true");
  });
});
