// src/pages/multiway/solveGroupsApi.ts
//
// Client for /api/solvegroups (Firebase-authed; see SolveGroupsController):
// the user's saved rotations for the session simulator. A group is a name
// and an ORDERED list of job ids - hand k of a session plays member k mod
// n - and a write replaces the whole list, so there is no per-member call.
import { authedFetch } from "@/lib/api";

export interface SolveGroup {
  id: string;
  name: string;
  /** Member job ids in rotation order; a job may repeat. */
  jobIds: string[];
  createdAtUtc: string;
  updatedAtUtc: string | null;
}

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res;
}

export async function fetchSolveGroups(): Promise<SolveGroup[]> {
  const res = await expectOk(await authedFetch("/api/solvegroups"));
  return (await res.json()) as SolveGroup[];
}

export async function createSolveGroup(name: string, jobIds: string[]): Promise<SolveGroup> {
  const res = await expectOk(
    await authedFetch("/api/solvegroups", {
      method: "POST",
      body: JSON.stringify({ name, jobIds }),
    })
  );
  return (await res.json()) as SolveGroup;
}

export async function updateSolveGroup(
  id: string,
  name: string,
  jobIds: string[]
): Promise<SolveGroup> {
  const res = await expectOk(
    await authedFetch(`/api/solvegroups/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, jobIds }),
    })
  );
  return (await res.json()) as SolveGroup;
}

export async function deleteSolveGroup(id: string): Promise<void> {
  const res = await authedFetch(`/api/solvegroups/${id}`, { method: "DELETE" });
  // Already gone is the outcome that was asked for.
  if (!res.ok && res.status !== 404) await expectOk(res);
}
