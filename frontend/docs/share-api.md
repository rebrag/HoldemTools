# Hand-share API (backend contract)

The **Share** feature lets a user turn one of their saved hands into a public,
link-shareable replay. The frontend is built and wired (see `src/lib/shareApi.ts`)
but gated behind the `VITE_SHARE_ENABLED` env flag until these three endpoints
exist in the backend (**HoldemToolsAPI**). Flip `VITE_SHARE_ENABLED=true` once
they're live.

A hand's `rawText` already carries a self-contained, base64 `HT_REPLAY` payload
(setup + actions + winners) that the client uses to reconstruct the replay. So the
public endpoint only needs to return that same `rawText` — no new hand model is
required, just a token→hand mapping.

## Endpoints

### `POST /api/handhistory/{id}/share` — mint a share token
- **Auth:** required (Bearer Firebase ID token). Must verify the caller **owns**
  hand `{id}`.
- **Behavior:** create (or return the existing) public share token for the hand.
  Idempotent per hand is preferred (repeated calls return the same token).
- **Response 200:** `{ "token": "<short-url-safe-string>" }`
- **Errors:** `401` (unauthenticated), `403` (not the owner), `404` (no such hand).

### `GET /api/shared/{token}` — fetch a shared hand (public)
- **Auth:** **none.** Anyone with the link can read it.
- **Response 200:** `{ "rawText": "<hand text incl. HT_REPLAY payload>" }`
- **Errors:** `404` if the token is unknown or has been revoked.
- **Notes:** return the full `rawText` exactly as stored (the client strips the
  `HT_REPLAY` marker for display and decodes it for the replay). Do not require or
  set any auth cookies. CORS must allow the web origin.

### `DELETE /api/handhistory/{id}/share` — revoke
- **Auth:** required; owner only.
- **Behavior:** invalidate the token so `GET /api/shared/{token}` returns `404`.
- **Response:** `204` (or `200`).
- **Errors:** `401`, `403`, `404`.

## Token guidance
- Short, URL-safe, and **unguessable** (e.g. 16+ random base62 chars, or a UUID).
  The token is the only access control for the public GET, so it must not be
  enumerable or derived from the numeric hand `id`.

## Frontend touch points
- `src/lib/shareApi.ts` — `createShareToken`, `fetchSharedHand`, `revokeShareToken`,
  `shareUrl`, and the `SHARE_ENABLED` flag.
- Public viewer route: `/hand-history/shared/:token` (`src/pages/handhistory/HandReplay.tsx`,
  `shared` mode) — works for logged-out viewers.
- Share button: `src/pages/handhistory/HandHistoryTool.tsx` (only shown for
  server-backed hands when `SHARE_ENABLED`).
