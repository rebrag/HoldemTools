// src/components/ProUpsell.tsx
import React, { useState } from "react";
import { getAuth } from "firebase/auth";
import { startSubscriptionCheckout } from "../lib/checkout";
import { getPriceIdForTier, TIER_LABEL, Tier } from "../lib/stripeTiers";
import { useCurrentTier } from "../context/TierContext";
import { openBillingPortal } from "../lib/openBillingPortal";

type ProUpsellProps = {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  busy?: boolean;
  pricePlusLabel?: string;
  priceProLabel?: string;
};

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
    <path
      fillRule="evenodd"
      d="M16.704 5.29a1 1 0 010 1.414l-7.01 7.01a1 1 0 01-1.414 0L3.296 8.72a1 1 0 111.414-1.414l3.156 3.156 6.303-6.303a1 1 0 011.535.131z"
      clipRule="evenodd"
    />
  </svg>
);

const Sparkle = () => (
  <svg className="h-5 w-5 text-white/90" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.9 4.7L18 8.6l-4.2 1.7L12 15l-1.8-4.7L6 8.6l4.1-1.9L12 2zM5 14l1.1 2.7L9 18l-2.9 1.2L5 22l-1.1-2.8L1 18l2.9-1.3L5 14zm14 0l1.1 2.7L23 18l-2.9 1.2L19 22l-1.1-2.8L15 18l2.9-1.3L19 14z" />
  </svg>
);

const ProUpsell: React.FC<ProUpsellProps> = ({
  open,
  onClose,
  pricePlusLabel = "$10/mo",
  priceProLabel = "$25/mo",
}) => {
  const [loading, setLoading] = useState<Tier | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const { tier: currentTier } = useCurrentTier(); // "free" | "plus" | "pro"

  if (!open) return null;

  async function handleSubscribe(tier: Tier) {
    if (loading || tier === "free") return;

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
    } catch (e) {
      console.error(e);
      alert((e as Error).message || "Unable to start checkout.");
      setLoading(null);
    }
  }

  async function handleManageBilling() {
    try {
      setBillingBusy(true);
      await openBillingPortal();
    } finally {
      setBillingBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upsell-title"
    >
      {/* Shine CSS (scoped) */}
      <style>{`
        @keyframes btn-shine-loop {
          0%, 72% {
            transform: translateX(-120%) skewX(-12deg);
            opacity: 0;
          }
          73% {
            opacity: 0.85;
          }
          85% {
            transform: translateX(140%) skewX(-12deg);
            opacity: 0;
          }
          100% {
            transform: translateX(140%) skewX(-12deg);
            opacity: 0;
          }
        }
        .btn-gloss {
          position: relative;
          overflow: hidden;
          will-change: transform;
        }
        .btn-gloss:active { transform: translateY(1px); }
        .btn-gloss .shine {
          pointer-events: none;
          position: absolute;
          top: -20%;
          bottom: -20%;
          width: 60%;
          left: -30%;
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0) 0%,
            rgba(255,255,255,0.62) 45%,
            rgba(255,255,255,0.85) 50%,
            rgba(255,255,255,0.62) 55%,
            rgba(255,255,255,0) 100%
          );
          transform: translateX(-120%) skewX(-12deg);
          filter: blur(1px);
          animation: btn-shine-loop 4s ease-in-out infinite;
        }
        .btn-gloss:hover .shine,
        .btn-gloss:focus-visible .shine {
          animation: btn-shine-loop 5s ease-in-out infinite,
                     btn-shine-hover 900ms ease-in-out 1;
        }
        @keyframes btn-shine-hover {
          0%   { transform: translateX(-120%) skewX(-12deg); opacity: 0; }
          40%  { opacity: 0.85; }
          100% { transform: translateX(140%)  skewX(-12deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .btn-gloss .shine { animation: none; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-[94vw] max-w-4xl rounded-3xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] overflow-hidden">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-500" />
          <div className="relative px-6 sm:px-8 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center ring-1 ring-white/20 shadow">
                <Sparkle />
              </div>
              <div>
                <h2
                  id="pro-upsell-title"
                  className="text-white text-lg sm:text-xl font-semibold tracking-wide"
                >
                  Unlock the full pre-flop library
                </h2>
                <p className="text-white/85 text-xs sm:text-sm">
                  Go <strong>Plus</strong> for ChipEV—or <strong>Pro</strong> for everything (ChipEV + ICM).
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-white/90 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Value bullets */}
        <div className="px-6 sm:px-8 pt-4 text-sm text-gray-700">
          <ul className="grid sm:grid-cols-3 gap-2 sm:gap-3">
            <li className="inline-flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-emerald-600" />
              <span>Fast, readable ranges with your UI</span>
            </li>
            <li className="inline-flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-emerald-600" />
              <span>Regular updates as new spots are added</span>
            </li>
            <li className="inline-flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-emerald-600" />
              <span>Cancel anytime—no lock-in</span>
            </li>
          </ul>
        </div>

        {/* Plans */}
        <div className="px-6 sm:px-8 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Plus */}
            <div className="relative rounded-2xl border border-emerald-200/80 bg-emerald-50/70 shadow-sm overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-400 to-emerald-600" />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-emerald-900">{TIER_LABEL.plus}</h3>
                    <p className="text-xs text-emerald-900/80 mt-0.5">
                      Everything you need for <strong>ChipEV</strong> study & drills
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-800">
                    {pricePlusLabel}
                  </span>
                </div>

                <ul className="mt-3 text-sm text-emerald-900/90 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-emerald-600" />
                    All ChipEV solutions
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-emerald-600" />
                    Shoving ranges & heads-up (non-ICM)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-emerald-600" />
                    Best for fundamentals & volume reps
                  </li>
                </ul>

                <button
                  onClick={() => handleSubscribe("plus")}
                  disabled={loading !== null || currentTier === "plus"}
                  className={[
                    "btn-gloss group mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-white",
                    "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800",
                    "shadow-sm shadow-emerald-300/40",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                    "transition-colors",
                  ].join(" ")}
                >
                  <span className="shine" />
                  {currentTier === "plus"
                    ? "Current plan"
                    : loading === "plus"
                    ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                            opacity=".25"
                          />
                          <path
                            d="M4 12a8 8 0 018-8"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                        </svg>
                        Redirecting…
                      </span>
                    )
                    : "Choose Plus"}
                </button>
              </div>
            </div>

            {/* Pro */}
            <div className="relative rounded-2xl border border-indigo-200/80 bg-indigo-50/70 shadow-sm overflow-hidden">
              <div className="absolute right-[-42px] top-4 rotate-45">
                <div className="bg-indigo-600 text-white text-[10px] font-semibold tracking-wide px-10 py-1 shadow-md">
                  MOST POPULAR
                </div>
              </div>
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-indigo-400 to-indigo-700" />
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-indigo-900">{TIER_LABEL.pro}</h3>
                    <p className="text-xs text-indigo-900/80 mt-0.5">
                      Full access to <strong>everything</strong>: ChipEV + ICM
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-indigo-800">
                    {priceProLabel}
                  </span>
                </div>

                <ul className="mt-3 text-sm text-indigo-900/90 space-y-1.5">
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-indigo-600" />
                    <strong>ALL</strong> solutions (ChipEV + ICM)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-indigo-600" />
                    Future formats & ongoing updates
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-indigo-600" />
                    Best for comprehensive study
                  </li>
                </ul>

                <button
                  onClick={() => {
                    if (currentTier === "plus") {
                      // Already paying → let Stripe portal handle prorated upgrade
                      handleManageBilling();
                    } else {
                      handleSubscribe("pro");
                    }
                  }}
                  disabled={loading !== null || currentTier === "pro"}
                  className={[
                    "btn-gloss group mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-white",
                    "bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800",
                    "shadow-sm shadow-indigo-300/40",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                    "transition-colors",
                  ].join(" ")}
                >
                  <span className="shine" />
                  {currentTier === "pro"
                    ? "Current plan"
                    : loading === "pro"
                    ? (
                      <span className="inline-flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                            opacity=".25"
                          />
                          <path
                            d="M4 12a8 8 0 018-8"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                        </svg>
                        Redirecting…
                      </span>
                    )
                    : currentTier === "plus"
                    ? "Upgrade to Pro"
                    : "Choose Pro"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer / Trust */}
        <div className="px-6 sm:px-8 pb-6">
          <div className="mb-3 text-[11px] text-gray-500">
            Prices in USD. Cancel anytime. You’ll be redirected to our secure checkout.
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <button
              onClick={onClose}
              disabled={loading !== null}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 transition-colors"
            >
              Keep Current Plan
            </button>

            {currentTier !== "free" && (
              <button
                onClick={handleManageBilling}
                disabled={billingBusy}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 transition-colors"
              >
                {billingBusy ? "Opening billing…" : "Manage subscription"}
              </button>
            )}

            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <div className="inline-flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1 14l-4-4 1.5-1.5L11 12l5.5-5.5L18 8l-7 8z" />
                </svg>
                Secure checkout
              </div>
              <span className="hidden sm:inline text-gray-300">•</span>
              <div className="inline-flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 text-indigo-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 5a4 4 0 014 4v2a1 1 0 102 0V10a6 6 0 00-12 0v2a1 1 0 102 0V10a4 4 0 014-4z" />
                </svg>
                Cancel anytime
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProUpsell;
