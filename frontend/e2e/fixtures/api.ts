import type { BrowserContext, Page } from "@playwright/test";
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
  /** Boards the page asked to hide, minus any it later un-hid (Undo). */
  hidden: SolutionRefFixture[];
};

/** A saved hand as /api/handhistory returns it (rawText carries the replay). */
export type HandHistoryFixture = { id: number; rawText: string };

export type SolutionRefFixture = {
  stacks: string;
  nodeName: string;
  board: string;
};

/**
 * A solved board for the postflop routes: the library index, the board
 * manifest, and one street bundle per dotted seed suffix ("r.0").
 *
 * Served through the same catch-all as everything else rather than as extra
 * `page.route` calls, so there is no registration-order question about which
 * handler wins, and an unstubbed postflop path still lands in `unhandled`.
 */
export type PostflopFixture = {
  index: unknown;
  manifest: unknown;
  streets: Record<string, unknown>;
  /** The board's stacks folder id, whose preflop plates the Line loads. */
  stacks: string;
};

export async function stubSolverApi(
  /** A page, or the whole context when a spec follows a link into a second
   *  tab - `page.route` covers only the page it was registered on. */
  page: Page | BrowserContext,
  opts: {
    postflop?: PostflopFixture;
    handHistories?: HandHistoryFixture[];
    /** Sessions as /api/bankroll returns them (camelCase BankrollSession). */
    bankrollSessions?: unknown[];
  } = {}
): Promise<ApiStub> {
  const unhandled: string[] = [];
  const hidden: SolutionRefFixture[] = [];

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ json: body });

    if (pathname.endsWith("/api/Files/foldersWithMetadata")) {
      return json(foldersFixture);
    }

    /* Saved hands, for the previews above each hand's solved boards in the
       library. Empty by default - a spec that has not opted in should see the
       list request answered rather than escaping to the deployed API. */
    if (pathname.endsWith("/api/handhistory")) {
      return json(opts.handHistories ?? []);
    }

    /* Bankroll sessions, which /hand-history fetches for its per-row
       "location · blinds" chips and /bankroll lists. Empty by default -
       the calls just must not escape to the real API. */
    if (pathname.endsWith("/api/bankroll")) {
      return json(opts.bankrollSessions ?? []);
    }

    /* Hiding a solved board. The stub records the calls so a spec can assert
       what was sent; the library removes the row optimistically, so nothing
       has to be served back. */
    if (pathname.endsWith("/api/solutions/hidden")) {
      const method = route.request().method();
      const body = route.request().postDataJSON() as SolutionRefFixture;
      if (method === "POST") hidden.push(body);
      if (method === "DELETE") {
        const i = hidden.findIndex(
          (h) =>
            h.stacks === body.stacks &&
            h.nodeName === body.nodeName &&
            h.board === body.board
        );
        if (i >= 0) hidden.splice(i, 1);
      }
      return route.fulfill({ status: 204, body: "" });
    }

    // Postflop. An empty library is the honest default: a spec that has not
    // opted in should see no solved boards rather than a 404 banner.
    if (pathname.endsWith("/api/Files/piosolutionsIndex")) {
      return json(opts.postflop?.index ?? { schema: 3, entries: [] });
    }
    if (opts.postflop) {
      if (pathname.endsWith("/manifest")) return json(opts.postflop.manifest);
      const street = pathname.match(/\/streets\/([^/]+)\.json$/);
      if (street) {
        const bundle = opts.postflop.streets[decodeURIComponent(street[1])];
        if (bundle) return json(bundle);
      }
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

      /* The solved board's own stacks folder. Opening a board renders its
         preflop line, which loads the plate behind each preflop node - real
         calls for a folder that is not in foldersFixture. Serving them keeps
         the postflop specs hermetic without adding a row to the shared folder
         fixture, which every folder-selector baseline is sized against. */
      if (opts.postflop && folder === opts.postflop.stacks) {
        const seat = SEAT_BY_PLATE[name];
        if (name === "metadata.json") return json({ ante: 0 });
        return json(seat ? platePayload(seat, stackFor(folder, seat)) : {});
      }

      const entry = byFolder.get(folder);
      if (!entry) return route.fulfill({ status: 404, json: { error: "no such folder" } });

      if (name === "metadata.json") return json(entry.metadata);

      const seat = SEAT_BY_PLATE[name];
      if (seat) return json(platePayload(seat, stackFor(folder, seat)));
    }

    unhandled.push(pathname);
    return route.fulfill({ status: 404, json: { error: "unstubbed" } });
  });

  return { unhandled, hidden };
}
