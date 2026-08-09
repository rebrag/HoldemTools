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

const { stacks, board, index, manifest, flopBundle } = fixture;

/* The full study layout (table + seat stats) is desktop-only; the mobile view
   still shows the table, but the assertions here target the desktop layout. */
test.skip(({ isMobile }) => !!isMobile, "study layout is desktop-only");

/* A money-denominated solve: the numbers in the manifest are the hand's own
   chips, scaled by chip_scale so Pio could use whole integers. The fixture pot
   of 550 Pio chips at scale 100 is $5.50, which is 2.75bb at a $2 big blind. */
const HAND_BB = 2;
const CHIP_SCALE = 100;

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
  chip_scale: CHIP_SCALE,
  seat_meta: [
    { pos: "BTN", name: "FoldedFred", stack_chips: 9475, folded: true, hero: false, cards: ["Ah", "Kd"] },
    { pos: "SB", name: "VillainSam", stack_chips: 1800, folded: false, hero: false, cards: ["Qd", "Qh"] },
    { pos: "BB", name: "HeroJosh", stack_chips: 1800, folded: false, hero: true, cards: [] },
  ],
};

/* The fixture's node EVs are not chip-denominated, so `chipEv` reads them as
   ICM and (correctly) refuses any unit conversion. Give the root node
   chip-scale EVs (sum == pot) so the money <-> bb EV toggle is exercised:
   OOP 200 Pio chips = $2.00, which is 1.00bb at a $2 big blind. */
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
  await expect(page.getByTestId("sim-select")).not.toHaveValue(HH_STACKS);
});

/* The hand's own cards are the reason to open a hand-history solve, so the
   study view starts on them rather than on an empty breakdown. OOP (SB) is
   VillainSam with QdQh; IP (BB) is HeroJosh, who never showed, so that side
   has nothing to pin - the empty `cards` array is the real shape of an
   unknown hand and must not select some arbitrary cell. */
test("opens on the hand the seat actually held", async ({ page }) => {
  await openBoard(page);

  const qq = page.locator('[data-testid="hand-cell"][data-hand="QQ"]');
  await expect(qq).toHaveAttribute("data-selected", "1");
  await expect(page.locator('[data-testid="hand-cell"][data-selected="1"]')).toHaveCount(1);

  // And the breakdown points at the one combo they held, not all six of QQ.
  const held = page.locator('[data-testid="combo-tile"][data-held="1"]');
  await expect(held).toHaveCount(1);
  await expect(held).toHaveAttribute("data-combo", /^(QdQh|QhQd)$/);
});

test("a seat whose cards are unknown starts with nothing pinned", async ({ page }) => {
  await openBoard(page);

  // Step into the next decision, which belongs to the other seat (BB/HeroJosh,
  // whose hole cards the hand never recorded).
  // The action buttons carry their percentages as text, so the title is the
  // stable handle here.
  await page.locator('button[title^="Click to see reactions to"]').first().click();

  await expect(page.locator('[data-testid="hand-cell"][data-selected="1"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="combo-tile"][data-held="1"]')).toHaveCount(0);
});

test("money defaults to the hand's chips and toggles to bb (pot + EV)", async ({ page }) => {
  await openBoard(page);

  // Default: the hand's own money. 550 Pio chips / scale 100 = $5.50.
  await expect(page.getByText(/Pot 5\.5\b/)).toBeVisible();
  await expect(page.getByText(/Pot 5\.5 bb/)).toHaveCount(0);

  // OOP EV: 200 Pio chips / 100 = $2.00, which is 1.00bb at a $2 big blind.
  const evCell = page
    .locator('[data-testid="seat-stats-row"][data-role="oop"] [data-metric="EV"]')
    .first();
  await expect(evCell).toContainText("2.00");
  await expect(evCell).not.toContainText("bb");

  // Toggle to big blinds.
  await page.getByRole("button", { name: /show in bb/i }).click();
  await expect(page.getByText(/Pot 2\.8 bb/)).toBeVisible();
  await expect(evCell).toContainText("1.00 bb");

  // And back to the hand's money.
  await page.getByRole("button", { name: /show in chips/i }).click();
  await expect(page.getByText(/Pot 5\.5\b/)).toBeVisible();
});

/* The regression fence for the default: a preflop-sim solve carries no
   chip_scale, so it must keep reading as big blinds and must not offer the
   money toggle. This is the guarantee that made the whole change safe to
   ship - every board solved before chip_scale existed lands here. */
test.describe("a board with no chip scale", () => {
  let simApi: ApiStub;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tourSeen", "1");
      window.localStorage.setItem("singleRangeView", "1");
      window.localStorage.setItem("ht_dev_signed_in", "true");
    });
    simApi = await stubSolverApi(page, {
      // The untouched fixture: no chip_scale, no hand_bb, no seat_meta.
      postflop: { index, manifest, streets: { "r.0": hhBundle }, stacks },
    });
    await page.goto("/solutions");
  });

  test.afterEach(() => {
    if (simApi) expect(simApi.unhandled).toEqual([]);
  });

  test("stays in big blinds and offers no money toggle", async ({ page }) => {
    await openBoard(page);

    await expect(page.getByText(/Pot 5\.5 bb/)).toBeVisible();
    await expect(page.getByRole("button", { name: /show in (bb|chips)/i })).toHaveCount(0);
    await expect(
      page.locator('[data-testid="seat-stats-row"][data-role="oop"] [data-metric="EV"]').first()
    ).toContainText("bb");
  });
});
