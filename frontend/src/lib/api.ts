// src/lib/api.ts
// Authenticated fetch helper: attaches the current user's Firebase ID token as a
// Bearer token so the API can verify the caller server-side (instead of trusting a
// client-supplied userId). Built generically so other endpoints can adopt it later.
import { getAuth } from "firebase/auth";
import { DEV_AUTH_BYPASS, mockDevUser } from "@/lib/devAuth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export async function authedFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  // Dev-only: fall back to the mock user so pages don't throw when signed out.
  // Note: the mock token won't pass server-side Firebase verification.
  const user = getAuth().currentUser ?? (DEV_AUTH_BYPASS ? mockDevUser : null);
  if (!user) {
    throw new Error("You must be signed in to do that.");
  }

  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}
