import { test, expect } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * A river is extracted on demand: picking the card POSTs /api/noderequests and
 * the viewer polls the manifest until the street lands. When the API cannot
 * enqueue the request it answers 503, and nothing will ever extract that
 * street - so the viewer must say so at once instead of showing a spinner for
 * the six minutes the manifest poll runs.
 *
 * The shipped fixture carries only the flop bundle, so the turn street is
 * synthesized from it (as in postflop-caller-tile.spec.ts): the flop root doc
 * re-labelled as the turn seed, whose check leads straight to the river deal.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

const TURN_CARD = "2h";
const RIVER_CARD = "7d";
/* Flop: SB checks, BB checks -> the turn deal at r:0:c:c. */
const TURN_SUFFIX = `r.0.c.c.${TURN_CARD}`;
const TURN_ID = `r:0:c:c:${TURN_CARD}`;

const turnDoc = {
  ...(flopBundle.nodes as Record<string, object>)["r.0"],
  node_id: TURN_ID,
  node_suffix: TURN_SUFFIX,
  parent_id: "r:0:c:c",
  street: "turn",
  board: board + TURN_CARD,
};

const turnBundle = {
  ...flopBundle,
  seed: TURN_ID,
  seed_suffix: TURN_SUFFIX,
  street: "turn",
  board: board + TURN_CARD,
  nodes: { [TURN_SUFFIX]: turnDoc },
  meta: {
    [TURN_SUFFIX]: { type: "OOP_DEC", street: "turn", actions: ["c"], extracted: true },
    // The turn doc's one action closes the street: the river deal, not extracted.
    [`${TURN_SUFFIX}.c`]: { type: "SPLIT_NODE", street: "turn", extracted: false },
  },
};

const manifestWithTurn = {
  ...manifest,
  streets: {
    ...manifest.streets,
    [TURN_SUFFIX]: {
      street: "turn",
      file: `streets/${TURN_SUFFIX}.json.gz`,
      extracted: true,
      node_count: 1,
      updated_utc: manifest.streets["r.0"].updated_utc,
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
    postflop: {
      index,
      manifest: manifestWithTurn,
      streets: { "r.0": flopBundle, [TURN_SUFFIX]: turnBundle },
      stacks,
    },
    nodeRequestStatus: 503,
  });
  await page.goto("/solutions");

  await page.getByRole("button", { name: /solution library/i }).click();
  await page.locator(`button[title="Open ${board}"]`).click();
  await expect(page.getByTitle("Back to the flop decision")).toBeVisible();
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

test("a river request the API cannot queue says so instead of polling", async ({ page }) => {
  // Flop check-check, deal the (extracted) turn, check to the river deal.
  await page.getByTitle("SB: Check", { exact: true }).click();
  await page.getByTitle("BB: Check", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pick the turn card" })).toBeVisible();
  await page.getByRole("button", { name: TURN_CARD, exact: true }).click();
  await expect(page.getByTitle(`Jump to the ${TURN_CARD} deal`)).toBeVisible();

  await page.getByTitle("SB: Check", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pick the river card" })).toBeVisible();
  await page.getByRole("button", { name: RIVER_CARD, exact: true }).click();

  // The request went out for exactly that street...
  await expect.poll(() => api.nodeRequests.length).toBe(1);
  expect(api.nodeRequests[0]).toMatchObject({
    stacks,
    board,
    nodeId: `${TURN_ID}:c:${RIVER_CARD}`,
  });
  // ...and its 503 surfaces immediately, well inside the poll window.
  await expect(page.getByText("Could not queue the extraction.")).toBeVisible({ timeout: 5_000 });
  // Nothing is left pending: the river never arrived and no deal tile appears.
  await expect(page.getByTitle(`Jump to the ${RIVER_CARD} deal`)).toHaveCount(0);
});
