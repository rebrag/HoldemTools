// src/lib/shareApi.ts
// Client for the public hand-share endpoints. The endpoints themselves live in
// the separate HoldemToolsAPI backend (see docs/share-api.md); this repo is
// frontend-only. Sharing is gated behind VITE_SHARE_ENABLED so nothing ships
// until the backend is live.
import { authedFetch } from "@/lib/api";

/** Master switch for the Share UI. Off unless the backend is deployed. */
export const SHARE_ENABLED = import.meta.env.VITE_SHARE_ENABLED === "true";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

interface ShareTokenResponse {
  token: string;
}
interface SharedHandResponse {
  rawText: string;
}

/**
 * Mint (or return the existing) public share token for one of the signed-in
 * user's server-backed hands. Authed — only the owner can share their hand.
 */
export async function createShareToken(handId: number): Promise<string> {
  const res = await authedFetch(`/api/handhistory/${handId}/share`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Couldn't create a share link (${res.status}).`);
  const data = (await res.json()) as ShareTokenResponse;
  if (!data?.token) throw new Error("Share link response was malformed.");
  return data.token;
}

/**
 * Fetch a shared hand's rawText by its public token. Deliberately a plain
 * (unauthenticated) fetch: anyone with the link can view, signed in or not.
 */
export async function fetchSharedHand(token: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/shared/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Shared hand not found (${res.status}).`);
  const data = (await res.json()) as SharedHandResponse;
  if (typeof data?.rawText !== "string") throw new Error("Shared hand was malformed.");
  return data.rawText;
}

/** Revoke a hand's share token (authed). Wired for a future "unshare" control. */
export async function revokeShareToken(handId: number): Promise<void> {
  const res = await authedFetch(`/api/handhistory/${handId}/share`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Couldn't revoke the share link (${res.status}).`);
}

/** Public URL a viewer opens to watch the shared replay. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/hand-history/shared/${token}`;
}
