// src/lib/uploadGameTree.ts
export type UploadGameTreeBody = {
  folder: string;
  line: string[];
  actingPos: string;
  isICM: boolean;
  text: string;
  uid?: string | null;
};

export async function uploadGameTree(apiBase: string, body: UploadGameTreeBody) {
  const url = `${apiBase}/api/gametrees`;
  const start = performance.now();

  // Helpful client-side diagnostics
  console.debug("[uploadGameTree] POST", url, {
    folder: body.folder,
    actions: body.line.join(" > "),
    actingPos: body.actingPos,
    isICM: body.isICM,
    textLen: body.text?.length ?? 0,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Trim whitespace on big text to avoid accidental trailing spaces
      body: JSON.stringify({ ...body, text: body.text?.trim?.() ?? body.text }),
    });
  } catch (networkErr) {
    const dur = (performance.now() - start).toFixed(0);
    console.error(`[uploadGameTree] Network error after ${dur}ms`, networkErr);
    throw networkErr;
  }

  const dur = (performance.now() - start).toFixed(0);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");

  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detail: any = undefined;
    try { detail = isJson ? await res.json() : await res.text(); } catch { /* ignore */ }
    console.error(`[uploadGameTree] HTTP ${res.status} after ${dur}ms`, detail);
    throw new Error(`Upload failed with status ${res.status}`);
  }

  const payload = isJson ? await res.json() : {};
  console.info(`[uploadGameTree] Uploaded in ${dur}ms`, payload);
  // payload.path is the full ADLS path (as your controller returns)
  return payload; // { ok: true, path: "gametrees/....json" }
}
