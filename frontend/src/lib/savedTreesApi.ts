// src/lib/savedTreesApi.ts
// Client for the /api/savedtrees endpoints (Firebase-authed; see
// SavedTreesController). The whole library comes back in one call - it is tens
// of rows and the picker renders all of it, so there is no per-folder fetch and
// no loading state inside the folder tree.
//
// A deliberate parallel of savedRangesApi.ts: the two libraries are the same
// shape end to end, so keeping the clients structurally identical is worth more
// than a generic one that would have to be parameterised over the payload
// field name and the route segment.
import { authedFetch } from "@/lib/api";

export interface TreeFolder {
  id: string;
  name: string;
  /** null = a root-level folder. */
  parentId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface SavedTree {
  id: string;
  name: string;
  /** null = sits at the library root. */
  folderId: string | null;
  /** The versioned JSON envelope from pages/compare/savedTreePayload.ts. The
   *  server treats it as opaque text; only this app understands it. */
  config: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface TreeLibraryData {
  folders: TreeFolder[];
  trees: SavedTree[];
}

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function fetchTreeLibraryData(): Promise<TreeLibraryData> {
  const res = await expectOk(await authedFetch("/api/savedtrees"));
  return (await res.json()) as TreeLibraryData;
}

export async function createFolder(
  name: string,
  parentId: string | null
): Promise<TreeFolder> {
  const res = await expectOk(
    await authedFetch("/api/savedtrees/folders", {
      method: "POST",
      body: JSON.stringify({ name, parentId }),
    })
  );
  return (await res.json()) as TreeFolder;
}

/** Rename and/or move. The server rejects a move into the folder's own subtree. */
export async function updateFolder(
  id: string,
  fields: { name: string; parentId: string | null }
): Promise<TreeFolder> {
  const res = await expectOk(
    await authedFetch(`/api/savedtrees/folders/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as TreeFolder;
}

/** Deletes the folder and every folder beneath it. Trees inside are KEPT and
 *  fall back to the library root - see the controller for why. */
export async function deleteFolder(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/savedtrees/folders/${id}`, { method: "DELETE" }));
}

export async function createTree(fields: {
  name: string;
  folderId: string | null;
  config: string;
}): Promise<SavedTree> {
  const res = await expectOk(
    await authedFetch("/api/savedtrees/trees", {
      method: "POST",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as SavedTree;
}

export async function updateTree(
  id: string,
  fields: { name: string; folderId: string | null; config: string }
): Promise<SavedTree> {
  const res = await expectOk(
    await authedFetch(`/api/savedtrees/trees/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    })
  );
  return (await res.json()) as SavedTree;
}

export async function deleteTree(id: string): Promise<void> {
  await expectOk(await authedFetch(`/api/savedtrees/trees/${id}`, { method: "DELETE" }));
}
