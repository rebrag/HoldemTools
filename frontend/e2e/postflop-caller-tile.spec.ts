import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * When a street closes bet-call, the line strip has to keep a tile for the
 * player who called: the line reads Bet -> Call -> [turn card] rather than
 * jumping from the bet straight to the card (which is where the tile used to
 * vanish). The Call tile's taken row doubles as the way to re-pick the runout
 * card, so both directions are pinned here.
 *
 * The shipped fixture only carries the flop bundle, so the turn street the
 * call leads to is synthesized from it: same doc shape, re-labelled to the
 * turn seed node, plus a manifest entry marking that street extracted.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

const TURN_CARD = "2h";
/* SB checks is not a street close; the close under test is BB's bet (b138)
 * called by SB, whose chance node is r.0.c.b138.c. */
const SEED_SUFFIX = `r.0.c.b138.c.${TURN_CARD}`;
const SEED_ID = `r:0:c:b138:c:${TURN_CARD}`;

/** The flop root doc re-labelled as the turn seed node. Only the fields the
 *  session actually reads (node ids, street, board) change; strategy content
 *  is irrelevant to the line's shape. */
const turnDoc = {
  ...(flopBundle.nodes as Record<string, object>)["r.0"],
  node_id: SEED_ID,
  node_suffix: SEED_SUFFIX,
  parent_id: `r:0:c:b138:c`,
  street: "turn",
  board: board + TURN_CARD,
};

const turnBundle = {
  ...flopBundle,
  seed: SEED_ID,
  seed_suffix: SEED_SUFFIX,
  street: "turn",
  board: board + TURN_CARD,
  nodes: { [SEED_SUFFIX]: turnDoc },
  meta: {
    [SEED_SUFFIX]: {
      type: "OOP_DEC",
      street: "turn",
      actions: ["c"],
      extracted: true,
    },
  },
};

const manifestWithTurn = {
  ...manifest,
  streets: {
    ...manifest.streets,
    [SEED_SUFFIX]: {
      street: "turn",
      file: `streets/${SEED_SUFFIX}.json.gz`,
      extracted: true,
      node_count: 1,
      updated_utc: manifest.streets["r.0"].updated_utc,
    },
  },
};

let api: ApiStub;

/** Walk flop action to the bet-call close: SB checks, BB bets, SB calls. */
const playToCall = async (page: Page) => {
  await page.getByTitle("SB: Check", { exact: true }).click();
  await page.locator('[title^="BB: Bet"]').click();
  await page.getByTitle("SB: Call", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pick the turn card" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });
  api = await stubSolverApi(page, {
    postflop: {
      index,
      manifest: manifestWithTurn,
      streets: { "r.0": flopBundle, [SEED_SUFFIX]: turnBundle },
      stacks,
    },
  });
  await page.goto("/solutions");

  await page.getByRole("button", { name: /solution library/i }).click();
  await page.locator(`button[title="Open ${board}"]`).click();
  await expect(page.getByTitle("Back to the flop decision")).toBeVisible();
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("the caller keeps a tile ahead of the dealt card", async ({ page }) => {
  await playToCall(page);
  await page.getByRole("button", { name: TURN_CARD, exact: true }).click();

  // The line now reads ... Bet -> Call -> [2h]: the caller has a tile whose
  // taken row is the Call, followed by the dealt card's tile.
  const callRow = page.getByTitle("Jump to SB's Call");
  const cardTile = page.getByTitle(`Jump to the ${TURN_CARD} deal`);
  await expect(callRow).toBeVisible();
  await expect(cardTile).toBeVisible();

  // And in that order: the call sits left of the card it led to.
  const callBox = (await callRow.boundingBox())!;
  const cardBox = (await cardTile.boundingBox())!;
  expect(callBox.x).toBeLessThan(cardBox.x);
});

test("the caller tile's taken row re-opens the card picker", async ({ page }) => {
  await playToCall(page);
  await page.getByRole("button", { name: TURN_CARD, exact: true }).click();
  await expect(page.getByTitle(`Jump to the ${TURN_CARD} deal`)).toBeVisible();

  await page.getByTitle("Jump to SB's Call").click();

  // Back on the runout choice: the picker is open again and the line has
  // rewound past the dealt card (and the caller tile with it).
  await expect(page.getByRole("heading", { name: "Pick the turn card" })).toBeVisible();
  await expect(page.getByTitle(`Jump to the ${TURN_CARD} deal`)).toHaveCount(0);
  await expect(page.getByTitle("Jump to SB's Call")).toHaveCount(0);
});

test("the caller tile's body rewinds to the caller's decision", async ({ page }) => {
  await playToCall(page);
  await page.getByRole("button", { name: TURN_CARD, exact: true }).click();
  await expect(page.getByTitle(`Jump to the ${TURN_CARD} deal`)).toBeVisible();

  /* SB has two tiles by now (the flop check and the call) - the caller tile
   * under test is the later one. */
  await page.getByTitle("Back to SB's decision").last().click();

  // SB faces the bet again: their card is active with the Call on offer, and
  // the tiles past that point are gone.
  await expect(page.getByTitle("SB: Call", { exact: true })).toBeVisible();
  await expect(page.getByTitle(`Jump to the ${TURN_CARD} deal`)).toHaveCount(0);
});
