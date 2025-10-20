// src/components/ProUpsell.tsx
import React, { useState } from "react";
import { getAuth } from "firebase/auth";
import { startSubscriptionCheckout } from "../lib/checkout";
import { getPriceIdForTier, TIER_LABEL, Tier } from "../lib/stripeTiers";
// import { useTier } from "../hooks/useTier";

type ProUpsellProps = {
  open: boolean;
  onClose: () => void;               // "Keep Free Plan"
  // backward-compat props from older versions; ignored if present
  onConfirm?: () => void;
  busy?: boolean;
  pricePlusLabel?: string;           // e.g. "$3/mo"
  priceProLabel?: string;            // e.g. "$7/mo"
};

const ProUpsell: React.FC<ProUpsellProps> = ({
  open,
  onClose,
  pricePlusLabel = "$10/mo",
  priceProLabel = "$25/mo",
}) => {
  const [loading, setLoading] = useState<Tier | null>(null);
  if (!open) return null;

  async function handleSubscribe(tier: Tier) {
    if (loading) return;
    if (tier === "free") return;

    try {
      setLoading(tier);

      const auth = getAuth();
      const uid = auth.currentUser?.uid ?? null;
      if (!uid) {
        setLoading(null);
        alert("Please sign in to continue.");
        return;
      }

      const priceId = getPriceIdForTier(tier);
      if (!priceId) {
        setLoading(null);
        alert(
          `Missing price for ${TIER_LABEL[tier]}.\n\nSet VITE_STRIPE_PRICE_ID_${tier.toUpperCase()} in your .env.`
        );
        return;
      }

      await startSubscriptionCheckout({
        uid,
        priceId,
        successUrl: `${window.location.origin}/success`,
        cancelUrl: `${window.location.origin}/billing`,
        allowPromotionCodes: true,
      });
      // Redirect occurs via the extension; UI will be torn down after navigation.
    } catch (e) {
      console.error(e);
      alert((e as Error).message || "Unable to start checkout.");
      setLoading(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upsell-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="relative w-[92vw] max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 id="pro-upsell-title" className="text-lg font-semibold text-gray-900">
            Upgrade your access
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-gray-100 text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Pitch */}
        <div className="px-5 pt-4 text-sm text-gray-700">
          <p className="mb-2">
            <strong>Pro</strong> has access to <strong>ALL</strong> solutions.
          </p>
          <p>
            <strong>Plus</strong> includes <strong>ChipEV solutions</strong> only — including{" "}
            <em>shoving ranges, heads-up</em>, and all <em>non-ICM</em> solutions.
          </p>
        </div>

        {/* Plans */}
        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Plus */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-emerald-900">{TIER_LABEL.plus}</h3>
                <span className="text-sm font-semibold text-emerald-800">{pricePlusLabel}</span>
              </div>
              <ul className="mt-3 text-sm text-emerald-900/90 list-disc pl-5 space-y-1">
                <li>All ChipEV solutions</li>
                <li>Shoving ranges & HU (non-ICM)</li>
                <li>Great for study & drills</li>
              </ul>

              <button
                onClick={() => handleSubscribe("plus")}
                disabled={loading !== null}
                className={[
                  "mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-white",
                  "bg-emerald-600 hover:bg-emerald-700",
                  "shadow-sm shadow-emerald-300/40",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                {loading === "plus" ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" fill="none" />
                    </svg>
                    Redirecting…
                  </span>
                ) : (
                  "Choose Plus"
                )}
              </button>
            </div>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-indigo-900">{TIER_LABEL.pro}</h3>
                <span className="text-sm font-semibold text-indigo-800">{priceProLabel}</span>
              </div>
              <ul className="mt-3 text-sm text-indigo-900/90 list-disc pl-5 space-y-1">
                <li><strong>ALL</strong> solutions (ChipEV + ICM)</li>
                <li>Future formats & updates</li>
                <li>Best for full access</li>
              </ul>

              <button
                onClick={() => handleSubscribe("pro")}
                disabled={loading !== null}
                className={[
                  "mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-white",
                  "bg-indigo-600 hover:bg-indigo-700",
                  "shadow-sm shadow-indigo-300/40",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                {loading === "pro" ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" fill="none" />
                    </svg>
                    Redirecting…
                  </span>
                ) : (
                  "Choose Pro"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            disabled={loading !== null}
            className="w-full px-4 py-2.5 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-60"
          >
            Keep Current Plan
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProUpsell;
