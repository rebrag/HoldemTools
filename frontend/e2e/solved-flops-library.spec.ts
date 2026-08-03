import { test, expect, type Page } from "@playwright/test";
import { stubSolverApi, type ApiStub } from "./fixtures/api";
import fixture from "./fixtures/postflop.json" with { type: "json" };

/**
 * The solved-flops library splits by provenance: boards solved from a hand the
 * viewer recorded sit above the ones solved off a preflop sim line, previewed
 * and linked back to the hand they came from. Boards can be removed, which is
 * per-viewer and reversible - so Undo has to put the row back, not just say it
 * did.
 *
 * The provenance labels are attached server-side (see PostflopLibraryOverlay);
 * here they are part of the index fixture, which is exactly what the API sends.
 */

const { stacks, board, index, manifest, flopBundle } = fixture;

const HAND_ID = 42;
const HAND_TEXT = "Hero raises to 2bb on the button and gets called";
const SIM_BOARD = "AsKdQc";

const entry = (index.entries as Record<string, unknown>[])[0];

/* Two boards: one from a recorded hand (with the id that links it back), one
   from a sim line. Same node, different boards - the manifest fixture is only
   fetched for the one that gets opened. */
const libraryIndex = {
  ...index,
  entries: [
    { ...entry, source: "handHistory", hand_history_id: HAND_ID },
    { ...entry, board: SIM_BOARD, source: "sim" },
  ],
};

let api: ApiStub;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tourSeen", "1");
    window.localStorage.setItem("singleRangeView", "1");
    // The library is auth-gated; playwright.config compiles the dev auth
    // bypass in, and this flips its store to signed in.
    window.localStorage.setItem("ht_dev_signed_in", "true");
  });

  api = await stubSolverApi(page, {
    postflop: { index: libraryIndex, manifest, streets: { "r.0": flopBundle }, stacks },
    handHistories: [{ id: HAND_ID, rawText: HAND_TEXT }],
  });

  await page.goto("/solutions");
});

test.afterEach(() => {
  if (api) expect(api.unhandled).toEqual([]);
});

const openLibrary = async (page: Page) => {
  await page.getByRole("button", { name: /solved flops/i }).click();
  await expect(page.getByRole("heading", { name: "Solved flops" })).toBeVisible();
};

test("groups hand-history solves apart from sim solves", async ({ page }) => {
  await openLibrary(page);

  const hands = page.getByTestId("library-hand-section");
  const sims = page.getByTestId("library-sim-section");
  await expect(hands).toBeVisible();
  await expect(sims).toBeVisible();

  // Each board sits under the section its provenance says it does.
  await expect(hands.locator(`[data-testid="library-board"][data-board="${board}"]`)).toBeVisible();
  await expect(
    sims.locator(`[data-testid="library-board"][data-board="${SIM_BOARD}"]`)
  ).toBeVisible();
  await expect(hands.locator(`[data-board="${SIM_BOARD}"]`)).toHaveCount(0);
});

test("previews the hand behind a solve and links to its replay", async ({ page }) => {
  await openLibrary(page);

  const hands = page.getByTestId("library-hand-section");
  // The preview is the shared HandPreview: a hand with no embedded replay
  // payload falls back to its first line of text.
  await expect(hands.getByText(HAND_TEXT)).toBeVisible();
  await expect(hands.getByRole("link", { name: /replay hand/i })).toHaveAttribute(
    "href",
    `/hand-history/replay/${HAND_ID}`
  );
});

test("removing a board takes it out of the library, and Undo puts it back", async ({
  page,
}) => {
  await openLibrary(page);

  const tile = page.locator(`[data-testid="library-board"][data-board="${board}"]`);
  await expect(tile).toBeVisible();

  await page
    .getByRole("button", { name: new RegExp(`remove ${board} from library`, "i") })
    .click();

  await expect(tile).toHaveCount(0);
  expect(api.hidden).toEqual([
    { stacks: entry.stacks, nodeName: entry.node_name, board },
  ]);

  await page.getByRole("button", { name: "Undo" }).click();

  await expect(tile).toBeVisible();
  expect(api.hidden).toEqual([]);
});

test("a removed board's section disappears when it was the only one", async ({ page }) => {
  await openLibrary(page);

  await page
    .getByRole("button", { name: new RegExp(`remove ${board} from library`, "i") })
    .click();

  // The hand had exactly one solved board, so its whole group goes with it.
  await expect(page.getByTestId("library-hand-section")).toHaveCount(0);
  await expect(page.getByTestId("library-sim-section")).toBeVisible();
});
