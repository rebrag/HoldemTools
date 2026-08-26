// src/lib/savedRangesApi.ts
// Client for the /api/savedranges endpoints (Firebase-authed; see
// SavedRangesController). The whole library comes back in one call - it is tens
// of rows and the picker renders all of it, so there is no per-folder fetch and
// no loading state inside the tree.
import { authedFetch } from "@/lib/api";

export interface RangeFolder {
  id: string;
  name: string;
  /** null = a root-level folder. */
  parentId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface SavedRange {
  id: string;
  name: string;
  /** null = sits at the library root. */
  folderId: string | null;
  /** Pio token string, e.g. "AA,KK:0.5,AK:0.25,T4". */
  weights: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface RangeLibrary {
  folders: RangeFolder[];
  ranges: SavedRange[];
}

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function fetchRangeLibrary(): Promise<RangeLibrary> {
  const res = await expectOk(await authedFetch("/api/savedranges"));
  return (await res.json()) as RangeLibrary;
}

export async function createFolder(
  name: string,
  parentId: string | null
): Promise<RangeFolder> {
  const res = await expectOk(
    await authedFetch("/api/savedranges/folders", {
      method: "POST",
      body: JSON.stringify({ name, parentId }),
    })
  );
  return (await res.json()) as RangeFolder;
}

/** Rename and/or move. The server rejects a move into the folder's own subtree. */
export async function updateFolder(
  id: string,
  fields: { name: string; parentId: string | null }
): Promise<RangeFolder> {
  const res = await expectOk(
    await authedFetch(`/api/savedranges/folders/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as RangeFolder;
}

/** Deletes the folder and every folder beneath it. Ranges inside are KEPT and
 *  fall back to the library root - see the controller for why. */
export async function deleteFolder(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/savedranges/folders/${id}`, { method: "DELETE" }));
}

export async function createRange(fields: {
  name: string;
  folderId: string | null;
  weights: string;
}): Promise<SavedRange> {
  const res = await expectOk(
    await authedFetch("/api/savedranges/ranges", {
      method: "POST",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as SavedRange;
}

export async function updateRange(
  id: string,
  fields: { name: string; folderId: string | null; weights: string }
): Promise<SavedRange> {
  const res = await expectOk(
    await authedFetch(`/api/savedranges/ranges/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as SavedRange;
}

export async function deleteRange(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/savedranges/ranges/${id}`, { method: "DELETE" }));
}
