// src/lib/handHistoryLinks.ts
// One source for the in-app URL of a saved hand's replay, mirroring
// `solutionOpenUrl` for solved boards. Both are opened in a new tab from every
// list that offers them, so the list the user was reading stays put.
//
// Two shapes of link, and the difference matters:
//
//   /hand-history/shared/{token}  public. Resolves through the anonymous
//                                 /api/shared/{token} endpoint, needs no
//                                 Firebase session, and fetches exactly one
//                                 hand. This is the link to hand to a friend,
//                                 and the fast one to open - nothing waits on
//                                 auth.
//   /hand-history/replay/{key}    owner-only fallback for hands with no token:
//                                 device-local (signed-out) hands, and server
//                                 hands whose owner revoked sharing.
//
// Every saved hand is minted a token on create, so the public form is the
// normal case and the fallback is the exception.

/** Public, auth-free replay link. */
export const sharedReplayUrl = (token: string): string =>
  `/hand-history/shared/${encodeURIComponent(token)}`;

/** Owner-only replay route. `key` is the row key: a server hand's id, or a
 *  device-local hand's localId. */
export const replayOpenUrl = (key: string): string =>
  `/hand-history/replay/${encodeURIComponent(key)}`;

/**
 * The best replay link for a hand: public when it has a share token,
 * owner-only otherwise.
 */
export const bestReplayUrl = (key: string, shareToken?: string | null): string =>
  shareToken ? sharedReplayUrl(shareToken) : replayOpenUrl(key);
