// src/lib/playersApi.ts
// Client for the /api/players endpoints (Firebase-authed; see PlayersController).
// Photos are owner-only server-side, so they are fetched with a bearer token and
// displayed via object URLs (usePlayerPhoto) - never a bare <img src>.
import { authedFetch } from "@/lib/api";

export interface Player {
  id: string; // server Guid; the durable identity hands reference via Seat.playerId
  name: string;
  notes: string | null;
  hasPhoto: boolean;
  photoUpdatedAt: string | null; // version key for cached photo blobs
  createdAt: string;
  updatedAt: string | null;
}

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function listPlayers(): Promise<Player[]> {
  const res = await expectOk(await authedFetch("/api/players"));
  return (await res.json()) as Player[];
}

export async function createPlayer(name: string, notes?: string): Promise<Player> {
  const res = await expectOk(
    await authedFetch("/api/players", {
      method: "POST",
      body: JSON.stringify({ name, notes }),
    })
  );
  return (await res.json()) as Player;
}

export async function updatePlayer(
  id: string,
  fields: { name: string; notes?: string | null }
): Promise<Player> {
  const res = await expectOk(
    await authedFetch(`/api/players/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as Player;
}

export async function deletePlayer(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/players/${id}`, { method: "DELETE" }));
}

export async function uploadPlayerPhoto(id: string, blob: Blob): Promise<Player> {
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  const res = await expectOk(
    await authedFetch(`/api/players/${id}/photo`, { method: "PUT", body: form })
  );
  return (await res.json()) as Player;
}

// 204 on success; callers update usePlayers' cache themselves.
export async function deletePlayerPhoto(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/players/${id}/photo`, { method: "DELETE" }));
}
