// src/lib/handTextCache.ts
// Cross-tab cache of saved hands' rawText, so opening a replay is instant.
//
// Every replay is opened from a list that already HAS the hand's text - the
// hand-history page, the session drawer, the Solution Library. The replay
// itself opens in a new tab, though, which throws that away and starts from
// nothing: boot the bundle, wait for Firebase to restore the session, mint an
// ID token, then hit the API. That serial chain is what made a replay take
// seconds to show a hand the previous tab was already displaying.
//
// localStorage (not sessionStorage) because the point is to share across
// tabs. Hands are immutable in practice but editable in principle, so the
// replay still revalidates in the background and swaps in any newer text -
// the cache buys the first paint, not correctness.
const KEY = "ht_hand_text_cache_v1";
const MAX_ENTRIES = 60;

type Cache = Record<string, string>;

function read(): Cache {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function write(cache: Cache): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or private mode - the cache is an optimization, never required */
  }
}

/** The hand's saved text, or null when this device hasn't seen it. */
export function readCachedHandText(key: string): string | null {
  return read()[key] ?? null;
}

/** Remember one hand. Re-inserting refreshes its position for the LRU trim. */
export function cacheHandText(key: string, rawText: string): void {
  const cache = read();
  if (cache[key] === rawText) return;
  delete cache[key];
  cache[key] = rawText;
  const keys = Object.keys(cache);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    delete cache[stale];
  }
  write(cache);
}

/** Bulk form for a list that just rendered a page of hands. */
export function cacheHandTexts(entries: Iterable<[string, string]>): void {
  const cache = read();
  let changed = false;
  for (const [key, rawText] of entries) {
    if (cache[key] === rawText) continue;
    delete cache[key];
    cache[key] = rawText;
    changed = true;
  }
  if (!changed) return;
  const keys = Object.keys(cache);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    delete cache[stale];
  }
  write(cache);
}

/** Drop a deleted hand so a stale replay link can't resurrect it. */
export function forgetCachedHandText(key: string): void {
  const cache = read();
  if (!(key in cache)) return;
  delete cache[key];
  write(cache);
}
