/**
 * A stand-in for `GET /api/Files/foldersWithMetadata`.
 *
 * The real endpoint is a deployed Azure API whose contents change, so tests
 * that read it would be both network-dependent and unpinnable as a visual
 * baseline. This fixture is small, fixed, and chosen to hit every branch the
 * folder selector renders differently:
 *
 *   - the free demo folder (the only unlocked row for a signed-out user)
 *   - an FT folder  -> amber rail chip, requires pro
 *   - an ICM folder -> blue rail chip
 *   - a heads-up folder -> only SB/BB, so the other seats render as "-"
 *   - decimal stacks -> the widest value the seat columns must fit ("12.5")
 *   - enough rows to overflow the panel, so the rail's scroll sync is exercised
 */

export type FolderMetadataFixture = {
  name: string;
  ante: number;
  isIcm: boolean;
  icmCount: number;
  seats?: number;
  tags?: string[];
};

export type FolderWithMetadataFixture = {
  folder: string;
  hasMetadata: boolean;
  metadata: FolderMetadataFixture | null;
};

const SEATS = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"] as const;

const build = (
  stacks: Array<number | null>,
  meta: Partial<FolderMetadataFixture> = {}
): FolderWithMetadataFixture => {
  const folder = SEATS.map((seat, i) => (stacks[i] === null ? null : `${stacks[i]}${seat}`))
    .filter(Boolean)
    .join("_");

  return {
    folder,
    hasMetadata: true,
    metadata: {
      name: meta.name ?? folder,
      ante: meta.ante ?? 1,
      isIcm: meta.isIcm ?? false,
      icmCount: meta.icmCount ?? 0,
      seats: stacks.filter((s) => s !== null).length,
      tags: meta.tags ?? [],
    },
  };
};

/* The one folder `requiredTierForFolder` grants to free users. Its id has to
   keep this exact prefix or the fixture silently loses its only unlocked row. */
const DEMO = build([23, 23, 23, 23, 23, 23, 23, 23]);

const FINAL_TABLE = build([12.5, 20, 8, 35, 15, 9, 18, 22], {
  name: "FT 12.5UTG_20UTG1",
  tags: ["FT"],
  isIcm: true,
  icmCount: 8,
});

const ICM = build([25, 40, 18, 12, 30, 22, 16, 11], {
  tags: ["ICM"],
  isIcm: true,
  icmCount: 8,
});

const HEADS_UP = build([null, null, null, null, null, null, 16, 12], {
  tags: ["HU"],
});

/* Deterministic filler - no randomness, so the baseline never drifts. */
const FILLER = Array.from({ length: 24 }, (_, i) =>
  build(SEATS.map((_seat, s) => 5 + ((i * 3 + s * 7) % 40)))
);

export const foldersFixture: FolderWithMetadataFixture[] = [
  DEMO,
  FINAL_TABLE,
  ICM,
  HEADS_UP,
  ...FILLER,
];

/** The folder the app should land on, and the one row that is not locked. */
export const DEMO_FOLDER = DEMO.folder;
