// src/lib/handHistoryLinks.ts
// One source for the in-app URL of a saved hand's replay, mirroring
// `solutionOpenUrl` for solved boards. Both are opened in a new tab from every
// list that offers them, so the list the user was reading stays put.

/** Route that plays back a saved hand. `key` is the row key: a server hand's
 *  id, or a device-local hand's localId. */
export const replayOpenUrl = (key: string): string =>
  `/hand-history/replay/${encodeURIComponent(key)}`;
