import type { Page } from "@playwright/test";
import { foldersFixture, type FolderWithMetadataFixture } from "./folders";
import { getInitialMapping } from "../../src/lib/solver/getInitialMapping";

/**
 * Serves every `/api/**` call the solver page makes, from fixtures.
 *
 * `foldersFixture` alone was not enough. Stubbing only
 * `foldersWithMetadata` left the plate list, the plate bodies and the sim
 * metadata reaching the deployed Azure API, and the fixture's folder ids do
 * not exist there - so `useFiles` 404'd and rendered "Error fetching files"
 * above the header. That banner is 24px tall, it pushes the search input down
 * by its own height, and the dropdown sizes its scroll area from
 * `viewport.h - anchor.bottom`, so every visual baseline came out exactly one
 * row shorter. Whether it landed before or after the screenshot depended on
 * the round trip to Azure, which is why it read as flake rather than as a
 * broken stub.
 *
 * A single catch-all route keeps that honest: anything not answered here is
 * failed locally rather than escaping to production, and recorded in
 * `unhandled` so a test can name it instead of letting the page quietly
 * render an error state.
 */

/** The 169 canonical starting hands, high card first. */
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const HANDS = RANKS.flatMap((r1, i) =>
  RANKS.map((r2, j) => (i === j ? `${r1}${r2}` : i < j ? `${r1}${r2}s` : `${r2}${r1}o`))
);

/** file name -> seat, for the 8-handed tree every fixture folder uses. */
const SEAT_BY_PLATE: Record<string, string> = Object.fromEntries(
  Object.entries(getInitialMapping(8)).map(([seat, plate]) => [plate, seat])
);

/**
 * A push/fold plate. The split is a fixed function of the hand's index, so the
 * matrix behind the dropdown is real content that never drifts between runs.
 */
const platePayload = (position: string, bb: number) => {
  const allin: Record<string, [number, number]> = {};
  const fold: Record<string, [number, number]> = {};
  HANDS.forEach((hand, i) => {
    const push = ((i * 37) % 101) / 100;
    allin[hand] = [push, Math.round((push * 4 - 2) * 100) / 100];
    fold[hand] = [Math.round((1 - push) * 100) / 100, 0];
  });
  return { Position: position, bb, ALLIN: allin, Fold: fold };
};

const byFolder = new Map<string, FolderWithMetadataFixture>(
  foldersFixture.map((f) => [f.folder, f])
);

/** Stacks are encoded in the folder id ("23UTG_23UTG1_..."), same as in prod. */
const stackFor = (folder: string, seat: string): number => {
  const token = folder.split("_").find((t) => t.endsWith(seat));
  return token ? Number(token.slice(0, -seat.length)) : 0;
};

export type ApiStub = {
  /** Paths that reached the catch-all - i.e. calls no fixture answers. */
  unhandled: string[];
};

export async function stubSolverApi(page: Page): Promise<ApiStub> {
  const unhandled: string[] = [];

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ json: body });

    if (pathname.endsWith("/api/Files/foldersWithMetadata")) {
      return json(foldersFixture);
    }

    const list = pathname.match(/\/api\/Files\/listJSONs\/([^/]+)$/);
    if (list) {
      const folder = decodeURIComponent(list[1]);
      return json(byFolder.has(folder) ? Object.values(getInitialMapping(8)) : []);
    }

    const file = pathname.match(/\/api\/Files\/([^/]+)\/([^/]+)$/);
    if (file) {
      const folder = decodeURIComponent(file[1]);
      const name = decodeURIComponent(file[2]);
      const entry = byFolder.get(folder);
      if (!entry) return route.fulfill({ status: 404, json: { error: "no such folder" } });

      if (name === "metadata.json") return json(entry.metadata);

      const seat = SEAT_BY_PLATE[name];
      if (seat) return json(platePayload(seat, stackFor(folder, seat)));
    }

    unhandled.push(pathname);
    return route.fulfill({ status: 404, json: { error: "unstubbed" } });
  });

  return { unhandled };
}
