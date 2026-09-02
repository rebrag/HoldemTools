// src/pages/multiway/fetchPushFoldDump.ts
//
// One job's push/fold payload, as served by the API. Shared by the page's
// result loader and the session simulator, which reads several at once.
import { authedFetch } from "@/lib/api";
import type { PushFoldDump } from "./pushfoldResult";

export async function fetchPushFoldDump(id: string): Promise<PushFoldDump> {
  const resp = await authedFetch(`/api/enginecompare/${id}/result/ht`);
  if (!resp.ok) throw new Error(`Result fetch failed (${resp.status})`);
  // Served with Content-Encoding: gzip, which the browser unwraps for us.
  const text = await resp.text();
  // A compare-mode watcher uploads the binary per-node .htc payload to the
  // same slot. Naming that explicitly is worth a branch: the alternative is
  // a raw "Unexpected token 'H'" from JSON.parse, which says nothing about
  // what to do, and the cause - a watcher running a build without
  // handle_pushfold - is entirely actionable.
  if (text.startsWith("HTCMP")) {
    throw new Error(
      "This job was solved by a watcher build that predates the pushfold mode, so it " +
        "uploaded a compare-mode .htc payload instead of a push/fold chart. Restart the " +
        "watcher and solve again."
    );
  }
  try {
    return JSON.parse(text) as PushFoldDump;
  } catch {
    throw new Error("The stored result is not a push/fold payload.");
  }
}
