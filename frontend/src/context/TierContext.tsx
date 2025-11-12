// src/context/TierContext.tsx
import React, { createContext, useContext, useMemo } from "react";
import type { User } from "firebase/auth";
import { useTier } from "../hooks/useTier";
import type { Tier } from "../lib/stripeTiers";

type TierContextValue = {
  tier: Tier;
  loading: boolean;
  isFree: boolean;
  isPlus: boolean;
  isPro: boolean;
};

const TierContext = createContext<TierContextValue | null>(null);

export const TierProvider: React.FC<{ user: User | null; children: React.ReactNode }> = ({ user, children }) => {
  const { tier, loading, isFree, isPlus, isPro } = useTier(user?.uid ?? null);

  const value = useMemo(
    () => ({ tier, loading, isFree, isPlus, isPro }),
    [tier, loading, isFree, isPlus, isPro]
  );

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrentTier(): TierContextValue {
  const ctx = useContext(TierContext);
  if (!ctx) {
    // Optional: keep a safe default so tests or pages outside the provider don’t explode
    return { tier: "free", loading: false, isFree: true, isPlus: false, isPro: false };
  }
  return ctx;
}
