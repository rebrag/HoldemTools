import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * A saved hand that has a solved board gets a fifth row action on
 * /hand-history: "View solution", which deep-links to that board on
 * /solutions. The mapping comes from the same overlaid index the solved-flops
 * library reads (source: "handHistory" + hand_history_id, attached
 * server-side per viewer), so a hand shows the button exactly when its
 * solution is openable.
 */

const { index, manifest, flopBundle } = fixture;

const HH_STACKS = "100BB_98BTN";
const SOLVED_HAND_ID = 42;
const UNSOLVED_HAND_ID = 43;
const SOLVED_TEXT = "Hero raises the button and the big blind calls";
const UNSOLVED_TEXT = "Hero open-folds the small blind, somehow";

const hhIndex = {
  ...index,
  entries: (index.entries as { stacks: string }[]).map((e) => ({
    ...e,
    stacks: HH_STACKS,
    source: "handHistory",
    hand_history_id: SOLVED_HAND_ID,
  })),
};

const hhManifest = {
  ...manifest,
  stacks: HH_STACKS,
  preflop: { ...manifest.preflop, folder: HH_STACKS },
};

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  api = await stubSolverApi(page, {
    postflop: { index: hhIndex, manifest: hhManifest, streets: { "r.0": flopBundle }, stacks: HH_STACKS },
    handHistories: [
      { id: SOLVED_HAND_ID, rawText: SOLVED_TEXT },
      { id: UNSOLVED_HAND_ID, rawText: UNSOLVED_TEXT },
    ],
  });
  await page.goto("/hand-history");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("only the solved hand offers a View solution button", async ({ page }) => {
  // Both hands render (HandPreview falls back to the first text line).
  const solvedRow = page.locator("li", { hasText: SOLVED_TEXT });
  const unsolvedRow = page.locator("li", { hasText: UNSOLVED_TEXT });
  await expect(solvedRow).toBeVisible();
  await expect(unsolvedRow).toBeVisible();

  await expect(solvedRow.getByRole("button", { name: "View solution" })).toBeVisible();
  await expect(unsolvedRow.getByRole("button", { name: "View solution" })).toHaveCount(0);
});

test("clicking it lands on /solutions with the board open", async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, "asserts on the opened study matrix - desktop-only");

  await page
    .locator("li", { hasText: SOLVED_TEXT })
    .getByRole("button", { name: "View solution" })
    .click();

  // The deep link routes to /solutions and auto-opens the hand's board.
  await expect(page).toHaveURL(/\/solutions/);
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({ timeout: 45_000 });
  await expect(page).not.toHaveURL(/open=/);
});
