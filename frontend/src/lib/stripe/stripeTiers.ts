// src/lib/stripeTiers.ts
export type Tier = "free" | "plus" | "pro";

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  plus: "HoldemTools Plus",
  pro: "HoldemTools Pro",
};

// order for comparisons
const TIER_ORDER: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

export function isTierSufficient(user: Tier, need: Tier): boolean {
  return TIER_ORDER[user] >= TIER_ORDER[need];
}

type EnvLike = {
  VITE_STRIPE_PRICE_ID_PLUS?: string;
  VITE_STRIPE_PRICE_ID_PRO?: string;
};

function env(): EnvLike {
  return (import.meta.env ?? {}) as unknown as EnvLike;
}

export function getPriceIdForTier(tier: Tier): string | null {
  const e = env();
  if (tier === "plus") return e.VITE_STRIPE_PRICE_ID_PLUS ?? null;
  if (tier === "pro") return e.VITE_STRIPE_PRICE_ID_PRO ?? null;
  return null;
}

// ---------- folder classification (meta-aware) ----------
export type FolderMetaLike = {
  name?: string;
  icm?: unknown; // array for ICM, "none" or undefined otherwise
  ante?: number;
};

function looksICM(meta?: FolderMetaLike): boolean {
  // ICM if 'icm' is an array with length > 0
  return Array.isArray(meta?.icm) && meta!.icm.length > 0;
}

function hasFTFlag(meta?: FolderMetaLike, folderId?: string): boolean {
  // detect FT in the metadata name (preferred) or fallback to folderId
  const hay = ((meta?.name ?? folderId) ?? "").toUpperCase();
  // \bFT\b catches “FT” as a separate token (e.g. "FT 19UTG...")
  return /\bFT\b/.test(hay);
}

function isDemoFolder(folderId: string): boolean {
  const id = folderId.toLowerCase();
  // your current public demo
  return (
    id.startsWith("23utg_23utg1_23lj_23hj_23co_23btn_23sb_23bb") ||
    id.includes("demo")
  );
}

/**
 * Decide the minimum tier needed for this folder.
 * Rules:
 *  - Demo → free
 *  - FT (from metadata name) OR ICM present → pro
 *  - Otherwise → plus
 */
// src/lib/stripeTiers.ts
export function requiredTierForFolder(folderId: string, meta?: FolderMetaLike): Tier {
  if (isDemoFolder(folderId)) return "free";     // only 23bb demo stays free
  if (hasFTFlag(meta, folderId)) return "pro";   // FT → Pro
  if (looksICM(meta)) return "plus";             // ICM (non-FT) → Plus
  return "plus";                                 // non-ICM regular → Plus
}


// Optional filename-only gate if you ever need it (kept for compat)
export function isFolderAllowed(userTier: Tier, folderId: string): boolean {
  const need = requiredTierForFolder(folderId);
  return isTierSufficient(userTier, need);
}
