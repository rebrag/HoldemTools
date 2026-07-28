import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * Hand-history solves carry extra manifest metadata the sim uploads don't:
 * `seat_meta` (every player from the recorded hand - names, flop-time stacks,
 * folded state, known hole cards) and `hand_bb` (the hand's big blind in real
 * chips). The viewer must render the hand's real table and offer a chips/bb
 * display toggle that defaults to chips. These tests pin that on the shared
 * QsKh3c fixture with the metadata grafted on.
 */

const { board, index, manifest, flopBundle } = fixture;

/* The full study layout (table + seat stats) is desktop-only; the mobile view
   still shows the table, but the assertions here target the desktop layout. */
test.skip(({ isMobile }) => !!isMobile, "study layout is desktop-only");

// The fixture pot is 550 pio-chips = 5.5bb; with a 2-chip big blind the
// chips display reads 11 while the bb display reads 5.5.
const HAND_BB = 2;

/* Hand-history solves live under a synthetic {stacks} id that is NOT a
   preflop sim folder - opening one must not switch the sim (that used to
   fetch the folder's nonexistent plates and surface "Error fetching files"). */
const HH_STACKS = "100BB_98BTN";

const hhIndex = {
  ...index,
  entries: (index.entries as { stacks: string }[]).map((e) => ({ ...e, stacks: HH_STACKS })),
};

const hhManifest = {
  ...manifest,
  stacks: HH_STACKS,
  preflop: { ...manifest.preflop, folder: HH_STACKS },
  hand_bb: HAND_BB,
  seat_meta: [
    { pos: "BTN", name: "FoldedFred", stack_chips: 9475, folded: true, hero: false, cards: ["Ah", "Kd"] },
    { pos: "SB", name: "VillainSam", stack_chips: 1800, folded: false, hero: false, cards: ["Qd", "Qh"] },
    { pos: "BB", name: "HeroJosh", stack_chips: 1800, folded: false, hero: true, cards: [] },
  ],
};

/* The fixture's node EVs are not chip-denominated, so `chipEv` reads them as
   ICM and (correctly) refuses any unit conversion. Give the root node
   chip-scale EVs (sum == pot) so the bb <-> chips EV toggle is exercised:
   OOP 200 chips = 2 bb = 4 hand-chips at a 2-chip big blind. */
const fixtureRoot = (flopBundle.nodes as Record<string, { seat_stats?: { oop: object; ip: object } }>)["r.0"];
const hhBundle = {
  ...flopBundle,
  nodes: {
    ...flopBundle.nodes,
    "r.0": {
      ...fixtureRoot,
      seat_stats: {
        oop: { ...fixtureRoot.seat_stats?.oop, ev: 200 },
        ip: { ...fixtureRoot.seat_stats?.ip, ev: 350 },
      },
    },
  },
};

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  api = await stubSolverApi(page, {
    postflop: { index: hhIndex, manifest: hhManifest, streets: { "r.0": hhBundle }, stacks: HH_STACKS },
  });
  await page.goto("/solutions");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

async function openBoard(page: Page) {
  await page.getByRole("button", { name: /solved flops/i }).click();
  await page.locator(`button[title="Open ${board}"]`).click();
  await expect(page.getByTestId("hand-cell").first()).toBeVisible();
}

test("the hand's full table renders: names, folded seat, hole cards", async ({ page }) => {
  await openBoard(page);

  // Every seat from the hand appears under its real name - including the
  // player who folded preflop. (Live seats also show in the stats panel,
  // hence first().)
  await expect(page.getByText("VillainSam").first()).toBeVisible();
  await expect(page.getByText("HeroJosh").first()).toBeVisible();
  await expect(page.getByText("FoldedFred").first()).toBeVisible();

  // Known hole cards from the hand render face-up.
  await expect(page.getByTitle("Queen of diamonds").first()).toBeVisible();
  await expect(page.getByTitle("Ace of hearts").first()).toBeVisible();

  // The synthetic stacks id is not a sim folder: the open sim must not have
  // switched to it, and no fetch-error banner may appear.
  await expect(page.getByText("Error fetching files")).toHaveCount(0);
  await expect(page.getByPlaceholder("Select Sim")).not.toHaveValue(HH_STACKS);
});

test("money defaults to the hand's chips and toggles to bb (pot + EV)", async ({ page }) => {
  await openBoard(page);

  // Default: the hand's own chips (5.5bb * 2 = 11), no bb suffix.
  await expect(page.getByText(/Pot 11\b/)).toBeVisible();

  // OOP EV: 200 pio-chips = 2 bb = 4 hand-chips at the 2-chip big blind.
  const evCell = page
    .locator('[data-testid="seat-stats-row"][data-role="oop"] [data-metric="EV"]')
    .first();
  await expect(evCell).toContainText("4.00");
  await expect(evCell).not.toContainText("bb");

  // Toggle to big blinds.
  await page.getByRole("button", { name: /show in bb/i }).click();
  await expect(page.getByText(/Pot 5\.5 bb/)).toBeVisible();
  await expect(evCell).toContainText("2.00 bb");

  // And back to chips.
  await page.getByRole("button", { name: /show in chips/i }).click();
  await expect(page.getByText(/Pot 11\b/)).toBeVisible();
});
