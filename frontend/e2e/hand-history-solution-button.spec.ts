import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * A saved hand that has a solved board gets a fifth row action on
 * /hand-history: "View solution", which deep-links to that board on
 * /solutions. The mapping comes from the same overlaid index the solved-flops
 * library reads (source: "handHistory" + hand_history_id, attached
 * server-side per viewer), so a hand shows the action exactly when its
 * solution is openable.
 *
 * It is a real link. On desktop it carries target="_blank": opening a solution
 * leaves the list, so it opens in a new tab and the hand list stays where the
 * user left it. On touch devices it navigates in place instead - on iOS a tab
 * opened from a page shares the opener's WebContent process, and a second live
 * copy of the app in that process is what got these tabs killed with Safari's
 * "A problem repeatedly occurred" (see HandSummaryRow / lib/pointer.ts).
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

test.beforeEach(async ({ page, context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  // Context-scoped: the "View solution" link opens a second tab, which needs
  // the same stubs as the first.
  api = await stubSolverApi(context, {
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

test("only the solved hand offers a View solution link", async ({ page, isMobile }) => {
  // Both hands render (HandPreview falls back to the first text line).
  const solvedRow = page.locator("li", { hasText: SOLVED_TEXT });
  const unsolvedRow = page.locator("li", { hasText: UNSOLVED_TEXT });
  await expect(solvedRow).toBeVisible();
  await expect(unsolvedRow).toBeVisible();

  const link = solvedRow.getByRole("link", { name: "View solution" });
  await expect(link).toBeVisible();
  // New tab on desktop, in-place navigation on touch (see the header note).
  if (isMobile) await expect(link).not.toHaveAttribute("target");
  else await expect(link).toHaveAttribute("target", "_blank");
  await expect(unsolvedRow.getByRole("link", { name: "View solution" })).toHaveCount(0);
});

test("clicking it opens /solutions in a new tab with the board open", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!!isMobile, "asserts on the opened study matrix - desktop-only");

  const [solutions] = await Promise.all([
    context.waitForEvent("page"),
    page
      .locator("li", { hasText: SOLVED_TEXT })
      .getByRole("link", { name: "View solution" })
      .click(),
  ]);

  // The deep link routes to /solutions and auto-opens the hand's board.
  await expect(solutions).toHaveURL(/\/solutions/);
  await expect(solutions.getByTestId("hand-cell").first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(solutions).not.toHaveURL(/open=/);

  // The hand list is untouched in the tab the user came from.
  await expect(page).toHaveURL(/\/hand-history$/);
});

test("mobile: View solution navigates in place", async ({ page, isMobile }) => {
  test.skip(!isMobile, "desktop opens a new tab - covered by the test above");

  await page
    .locator("li", { hasText: SOLVED_TEXT })
    .getByRole("link", { name: "View solution" })
    .click();
  await expect(page).toHaveURL(/\/solutions/);
});
