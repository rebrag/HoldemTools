import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { foldersFixture } from "./fixtures/folders";

/** Blanks the page behind the glass panel - see the file's own comment.
 *  The package is ESM, so there is no __dirname to resolve against. */
const SNAPSHOT_STYLE = fileURLToPath(new URL("./screenshot.css", import.meta.url));

/**
 * The folder selector renders two ways: an anchored glass window with an
 * external tag rail on desktop, and a full-width sheet with a dimmed backdrop
 * and inline tags on mobile. Both are portaled to <body> and positioned by
 * hand, and both have layout that reads fine in review and breaks in use - the
 * desktop rail lives outside the scrolling panel and is synced by hand; the
 * panel sizes itself around a scrollbar gutter it has to measure. These tests
 * pin the invariants so a failure names which one broke.
 */

test.beforeEach(async ({ page }) => {
  /* A fresh profile is a first-time visitor, so Solver runs its intro.js tour
     and the helper layer swallows every click. These tests are about the
     returning-user state; the tour deserves its own spec. */
  await page.addInitScript(() => window.localStorage.setItem("tourSeen", "1"));

  await page.route("**/api/Files/foldersWithMetadata*", (route) =>
    route.fulfill({ json: foldersFixture })
  );
  await page.goto("/solutions");
});

/** Opens the dropdown. The pointer stays on the search input (above the panel
 *  on desktop), so no row is hovered and the highlight stays on row 0. */
async function openDropdown(page: Page) {
  const search = page.getByPlaceholder(/Preflop Solutions/i);
  await expect(search).toBeVisible();
  await search.click();

  const dropdown = page.getByTestId("folder-dropdown");
  await expect(dropdown).toBeVisible();
  await expect(page.getByTestId("row-avg").first()).toBeVisible();
  return dropdown;
}

/* ── Shared invariants: true on both desktop and mobile ─────────────── */

test("grid never scrolls sideways", async ({ page }) => {
  await openDropdown(page);
  const overflow = await page
    .getByTestId("folder-dropdown-scroll")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBe(0);
});

test("body never scrolls sideways", async ({ page }) => {
  await openDropdown(page);
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(scrolls).toBe(false);
});

test("renders a chip for every tag kind", async ({ page }) => {
  await openDropdown(page);
  const tags = await page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>("[data-testid=rail-chip]")];
    // The tag label is the chip's trailing text node; the lock is an <svg>.
    const label = (c: HTMLElement) =>
      (c.childNodes[c.childNodes.length - 1] as Text)?.nodeValue?.trim() ?? "";
    return [...new Set(chips.map(label).filter(Boolean))].sort();
  });
  expect(tags).toEqual(["FT", "HU", "ICM"]);
});

/* ── Desktop: anchored window + external tag rail ───────────────────── */

test.describe("desktop window", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
  });

  async function panelMetrics(page: Page) {
    return page.getByTestId("folder-dropdown-scroll").evaluate((el) => {
      const scroller = el as HTMLElement;
      const heads = [
        ...(scroller.querySelector("[data-testid=folder-dropdown-header]")?.children ?? []),
      ];
      const last = heads[heads.length - 1]?.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const gutter = scroller.offsetWidth - scroller.clientWidth;
      return {
        columnCount: heads.length,
        labels: heads.map((h) => h.textContent?.trim() ?? ""),
        gutter,
        lastColumnOverlap: last ? last.right - (box.right - gutter) : 0,
        anyLabelClipped: heads.some((h) => h.scrollWidth > h.clientWidth + 1),
      };
    });
  }

  test("shows every seat column with aligned labels", async ({ page }) => {
    await openDropdown(page);
    const m = await panelMetrics(page);
    expect(m.columnCount).toBe(9); // Avg + 8 seats
    expect(m.labels).toEqual(["Avg", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(m.anyLabelClipped).toBe(false);
  });

  test("keeps the last column clear of the scrollbar gutter", async ({ page }) => {
    await openDropdown(page);
    const m = await panelMetrics(page);
    // The gutter is added to the panel width, not carved out of the grid, so
    // the final column must stop before it rather than sit underneath it.
    expect(m.lastColumnOverlap).toBeLessThanOrEqual(0.5);
  });

  test("tag rail tracks the rows while the panel scrolls", async ({ page }) => {
    await openDropdown(page);
    const worstDrift = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-scroll]")!;
      const slots = [...document.querySelectorAll<HTMLElement>("[data-testid=rail-slot]")];
      const rows = [...document.querySelectorAll<HTMLElement>("[data-testid=row-avg]")];
      const settle = () =>
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const max = scroller.scrollHeight - scroller.clientHeight;
      let worst = 0;
      for (const y of [0, 137, max / 2, max]) {
        scroller.scrollTop = y;
        await settle();
        for (let i = 0; i < rows.length; i++) {
          const drift = slots[i].getBoundingClientRect().top - rows[i].getBoundingClientRect().top;
          worst = Math.max(worst, Math.abs(drift));
        }
      }
      return worst;
    });
    expect(worstDrift).toBeLessThanOrEqual(1);
  });

  test("rail has one chip per row, and locked chips are filled", async ({ page }) => {
    await openDropdown(page);
    const chips = await page.evaluate(() => {
      const all = [...document.querySelectorAll<HTMLElement>("[data-testid=rail-chip]")];
      const rail = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-rail]")!;
      const railW = rail.getBoundingClientRect().width;
      return {
        rows: document.querySelectorAll("[data-testid=row-avg]").length,
        locked: all.filter((c) => c.dataset.locked === "true").length,
        // A bare icon vanishes against the page showing through behind the rail.
        lockedWithoutFill: all
          .filter((c) => c.dataset.locked === "true")
          .filter((c) => getComputedStyle(c).backgroundColor === "rgba(0, 0, 0, 0)").length,
        overflowingRail: all.filter((c) => c.getBoundingClientRect().width > railW).length,
      };
    });
    // Only the free demo folder is unlocked, so every other row carries a chip.
    expect(chips.locked).toBe(chips.rows - 1);
    expect(chips.lockedWithoutFill).toBe(0);
    expect(chips.overflowingRail).toBe(0);
  });

  test("panel is sized by its content, not by the search bar", async ({ page }) => {
    await openDropdown(page);
    const { panelWidth, searchWidth } = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-panel]")!;
      const search = document.querySelector<HTMLElement>("input[placeholder*='Preflop Solutions']")!;
      return {
        panelWidth: panel.getBoundingClientRect().width,
        searchWidth: search.getBoundingClientRect().width,
      };
    });
    expect(Math.abs(panelWidth - searchWidth)).toBeGreaterThan(1);
  });

  test("rail and panel both stay on screen", async ({ page }) => {
    await openDropdown(page);
    const fits = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-panel]")!.getBoundingClientRect();
      const rail = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-rail]")!.getBoundingClientRect();
      return {
        railLeft: rail.left,
        panelRight: panel.right,
        viewport: document.documentElement.clientWidth,
      };
    });
    expect(fits.railLeft).toBeGreaterThanOrEqual(0);
    expect(fits.panelRight).toBeLessThanOrEqual(fits.viewport);
  });

  test("dropdown element encloses the rail", async ({ page }) => {
    const dropdown = await openDropdown(page);
    // Guards the screenshot below: if the rail ever escapes this box again,
    // the baseline would silently stop covering it.
    const encloses = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>("[data-testid=folder-dropdown]")!.getBoundingClientRect();
      const rail = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-rail]")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-panel]")!.getBoundingClientRect();
      return {
        railInside: rail.left >= box.left - 0.5 && rail.right <= box.right + 0.5,
        panelInside: panel.left >= box.left - 0.5 && panel.right <= box.right + 0.5,
        railLeftOfPanel: rail.right <= panel.left + 0.5,
      };
    });
    expect(encloses).toEqual({ railInside: true, panelInside: true, railLeftOfPanel: true });
    await expect(dropdown).toHaveScreenshot("dropdown.png", {
      stylePath: SNAPSHOT_STYLE,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("looks right scrolled to the tagged rows", async ({ page }) => {
    const dropdown = await openDropdown(page);
    /* FT and HU sort into the last buckets, so the at-rest snapshot only sees
       lock-only chips. Scrolling to the end puts the labelled chips in frame -
       and shows the rail's translation, not just its rest position. */
    await page.getByTestId("folder-dropdown-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() =>
        page
          .getByTestId("folder-dropdown-rail")
          .locator("> div")
          .evaluate((el) => (el as HTMLElement).style.transform)
      )
      .not.toBe("translateY(0px)");
    await expect(dropdown).toHaveScreenshot("dropdown-scrolled.png", {
      stylePath: SNAPSHOT_STYLE,
      maxDiffPixelRatio: 0.01,
    });
  });
});

/* ── Mobile: full-width sheet + backdrop + inline tags ──────────────── */

test.describe("mobile sheet", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  });

  test("is a near-full-width sheet with a backdrop and title bar", async ({ page }) => {
    await openDropdown(page);
    const s = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-panel]")!.getBoundingClientRect();
      const backdrop = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-backdrop]");
      const title = document.querySelector<HTMLElement>("[data-testid=folder-dropdown-titlebar]");
      const vw = document.documentElement.clientWidth;
      return {
        vw,
        panelWidth: panel.width,
        gapFromEdges: vw - panel.width,
        hasBackdrop: !!backdrop,
        backdropCoversViewport: backdrop
          ? backdrop.getBoundingClientRect().width >= vw && backdrop.getBoundingClientRect().height >= document.documentElement.clientHeight
          : false,
        hasTitleBar: !!title,
      };
    });
    // Full-width by design (not content-sized): a thin margin on each side.
    expect(s.gapFromEdges).toBeGreaterThan(0);
    expect(s.gapFromEdges).toBeLessThanOrEqual(24);
    expect(s.hasBackdrop).toBe(true);
    expect(s.backdropCoversViewport).toBe(true);
    expect(s.hasTitleBar).toBe(true);
  });

  test("close button dismisses the sheet", async ({ page }) => {
    await openDropdown(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("folder-dropdown")).toBeHidden();
  });

  test("backdrop tap dismisses the sheet", async ({ page }) => {
    await openDropdown(page);
    // Click a top corner, away from the sheet body.
    await page.getByTestId("folder-dropdown-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("folder-dropdown")).toBeHidden();
  });

  test("sheet looks right", async ({ page }) => {
    const dropdown = await openDropdown(page);
    await expect(dropdown).toHaveScreenshot("sheet.png", {
      stylePath: SNAPSHOT_STYLE,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("sheet looks right scrolled to the tagged rows", async ({ page }) => {
    const dropdown = await openDropdown(page);
    await page.getByTestId("folder-dropdown-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(dropdown).toHaveScreenshot("sheet-scrolled.png", {
      stylePath: SNAPSHOT_STYLE,
      maxDiffPixelRatio: 0.01,
    });
  });
});
