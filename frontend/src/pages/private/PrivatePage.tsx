// src/pages/private/PrivatePage.tsx
// Private study tools, gated by the Pro subscription tier (useCurrentTier).
// Routable at /private but deliberately absent from NavBar. Four render
// states: signed out, tier loading, not Pro (upsell), and the tools.
import React, { useState } from "react";
import type { User } from "firebase/auth";
import LoginSignupModal from "@/components/LoginSignupModal";
import ProUpsell from "@/components/ProUpsell";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useCurrentTier } from "@/context/TierContext";
import RankingsTab from "./RankingsTab";
import TaiwaneseTab from "./TaiwaneseTab";
import AdvancedTab from "./AdvancedTab";
import ScoringVerifier from "./ScoringVerifier";
import InfoButton from "@/components/InfoButton";
import { Segmented } from "./controls";

interface PrivatePageProps {
  user: User | null;
}

type Tab = "rankings" | "taiwanese" | "advanced";

const PrivatePage: React.FC<PrivatePageProps> = ({ user }) => {
  const [tab, setTab] = useState<Tab>("taiwanese");
  const [showLogin, setShowLogin] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const { isPro, loading: tierLoading } = useCurrentTier();

  if (!user) {
    return (
      <div className="max-w-5xl mx-auto px-4 pb-12 pt-6">
        <h1 className="text-2xl font-semibold text-white mb-2">Private Tools</h1>
        <p className="text-sm text-emerald-100/90 max-w-md mb-4">
          This page is for Pro subscribers. Log in with your HoldemTools account to continue.
        </p>
        <button
          type="button"
          onClick={() => setShowLogin(true)}
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Log in
        </button>
        <LoginSignupModal open={showLogin} onClose={() => setShowLogin(false)} />
      </div>
    );
  }

  if (tierLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 pb-12 pt-6">
        <h1 className="text-2xl font-semibold text-white mb-4">Private Tools</h1>
        <div className="rounded-xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-10 max-w-md flex justify-center">
          <LoadingIndicator variant="ring" size={20} className="text-emerald-100/60" />
        </div>
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="max-w-5xl mx-auto px-4 pb-12 pt-6">
        <h1 className="text-2xl font-semibold text-white mb-4">Private Tools</h1>
        <div className="rounded-xl border border-white/10 bg-white/[0.07] backdrop-blur-xl p-5 max-w-md">
          <p className="text-base font-semibold text-white">Pro required</p>
          <p className="mt-2 text-sm text-emerald-100/70">
            The hand-ranking simulator and Taiwanese advisor are available on the Pro plan.
          </p>
          <button
            type="button"
            onClick={() => setUpsellOpen(true)}
            className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Upgrade to Pro
          </button>
        </div>
        <ProUpsell open={upsellOpen} onClose={() => setUpsellOpen(false)} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12 pt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          options={[
            { value: "rankings", label: "Hand Rankings" },
            { value: "taiwanese", label: "Taiwanese Advisor" },
            { value: "advanced", label: "Taiwanese Advanced" },
          ]}
          onChange={setTab}
        />
        {/* The checker is a reference tool, not an input to any tab, so it
            lives behind an info button rather than under every result. */}
        <InfoButton
          label="Score checker"
          title="Score checker"
          description="Enter every player's set hands and the board cards from a real deal; the points come from the exact code the advisor uses. It starts loaded with a scored deal from the home game, so the output can be compared with the real scoresheet."
          desktopMaxWidthClassName="sm:max-w-3xl"
        >
          <ScoringVerifier />
        </InfoButton>
      </div>
      {tab === "rankings" ? <RankingsTab /> : tab === "taiwanese" ? <TaiwaneseTab /> : <AdvancedTab />}
    </div>
  );
};

export default PrivatePage;
