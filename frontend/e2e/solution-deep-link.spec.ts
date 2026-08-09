import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * /solutions?open=<stacks|node|board> is the deep link the hand-history and
 * bankroll "view solution" buttons mint (see solutionOpenUrl): landing on it
 * must open that solved board directly, then consume the param so history
 * navigation cannot re-trigger it. A key that matches nothing (deleted or
 * hidden board, hand-crafted URL) must land in the solved-flops library
 * rather than dying silently.
 *
 * The board is grafted onto a synthetic hand-history stacks id, same as
 * hh-solution-view.spec.ts - the deep link's primary caller is a hand solve.
 */

const { board, index, manifest, flopBundle } = fixture;

const HH_STACKS = "100BB_98BTN";

const hhIndex = {
  ...index,
  entries: (index.entries as { stacks: string }[]).map((e) => ({ ...e, stacks: HH_STACKS })),
};

const hhManifest = {
  ...manifest,
  stacks: HH_STACKS,
  preflop: { ...manifest.preflop, folder: HH_STACKS },
};

const entry = (hhIndex.entries as { stacks: string; node_name: string; board: string }[])[0];
const openKey = `${entry.stacks}|${entry.node_name}|${entry.board}`;

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  api = await stubSolverApi(page, {
    postflop: { index: hhIndex, manifest: hhManifest, streets: { "r.0": flopBundle }, stacks: HH_STACKS },
  });
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("a valid ?open= link opens the solved board and consumes the param", async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, "asserts on the opened study matrix - desktop-only");

  await page.goto(`/solutions?open=${encodeURIComponent(openKey)}`);

  // The board opens without any clicking: the postflop matrix renders.
  await expect(page.getByTestId("hand-cell").first()).toBeVisible({ timeout: 45_000 });

  // The param was consumed (replace, so Back leaves /solutions cleanly).
  await expect(page).not.toHaveURL(/open=/);
});

test("an unknown ?open= key lands in the solved-flops library", async ({ page }) => {
  await page.goto(`/solutions?open=${encodeURIComponent("no|such|board")}`);

  // The library modal opens instead of a silent no-op...
  await expect(page.getByRole("heading", { name: "Solution Library" })).toBeVisible({
    timeout: 45_000,
  });
  // ...showing what does exist.
  await expect(
    page.locator(`[data-testid="library-board"][data-board="${board}"]`)
  ).toBeVisible();

  await expect(page).not.toHaveURL(/open=/);
});
