import React from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import { useCurrentTier } from "@/context/TierContext";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import CourseOutlineSidebar from "./components/CourseOutlineSidebar";

const sections = [
  {
    number: 1,
    title: "The Rules of Poker",
    description:
      "Start from zero - what poker is, the deck, the hand rankings every game shares, betting, and the showdown. No variant-specific rules yet.",
  },
  {
    number: 2,
    title: "Texas Hold'em",
    description:
      "The world's most popular variant, in depth - hole cards and community cards, the betting rounds, why the blinds matter, and reading tricky showdowns.",
  },
  {
    number: 3,
    title: "Other Poker Variants",
    description:
      "Tour the rest of the poker world from most to least popular - Omaha, Stud, Draw, Short Deck, lowball and more - and how brand-new variants get invented.",
  },
];

interface CourseProps {
  user: User | null;
}

const Course: React.FC<CourseProps> = ({ user }) => {
  const navigate = useNavigate();
  const { isFree } = useCurrentTier();
  const { completedSections, resetComplete } = useCourseProgress(user?.uid ?? null);

  const completedCount = completedSections.size;

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12 pt-6 lg:flex lg:items-start lg:gap-8">
      <CourseOutlineSidebar
        sections={sections}
        completedSections={completedSections}
        isFree={isFree}
      />
      <div className="min-w-0 flex-1 max-w-2xl mx-auto lg:mx-0 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Course
        </p>
        <h1 className="text-2xl font-semibold text-white">Think Like a Professional</h1>
        <p className="text-sm text-emerald-100/80 max-w-md">
          An entry-level guide to understanding poker through the lens of mathematics and strategy.
        </p>
        {!isFree && completedCount > 0 && (
          <p className="text-xs text-emerald-400">
            {completedCount} of {sections.length} sections complete
          </p>
        )}
      </div>

      {/* Tier notice for free users */}
      {isFree && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-amber-200/90 leading-relaxed">
            Section content requires a <strong>Plus or Pro</strong> subscription. Upgrade to track your progress and unlock all sections.
          </p>
        </div>
      )}

      {/* Outline */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">Course Outline</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {sections.map((section) => {
            const isComplete = completedSections.has(section.number);
            return (
              <div
                key={section.number}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/course/${section.number}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") navigate(`/course/${section.number}`);
                }}
                className="w-full text-left flex gap-4 px-4 py-3.5 hover:bg-emerald-50 transition-colors group cursor-pointer"
              >
                {/* Section number / completion indicator */}
                {isComplete ? (
                  <button
                    title="Reset completion"
                    onClick={(e) => {
                      e.stopPropagation();
                      void resetComplete(section.number);
                    }}
                    className="shrink-0 w-7 h-7 rounded-full bg-emerald-100 ring-1 ring-emerald-400 flex items-center justify-center mt-0.5 hover:bg-red-50 hover:ring-red-300 transition-colors group/undo"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-emerald-600 group-hover/undo:text-red-400 transition-colors"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 5.29a1 1 0 010 1.414l-7.01 7.01a1 1 0 01-1.414 0L3.296 8.72a1 1 0 111.414-1.414l3.156 3.156 6.303-6.303a1 1 0 011.535.131z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                ) : (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-50 ring-1 ring-emerald-200 group-hover:ring-emerald-400 group-hover:bg-emerald-100 flex items-center justify-center mt-0.5 transition-colors">
                    <span className="text-[11px] font-bold text-emerald-700">{section.number}</span>
                  </div>
                )}

                {/* Title + description */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{section.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    {section.description}
                  </p>
                </div>

                {/* Right arrow / lock */}
                <div className="shrink-0 flex items-center self-center transition-colors">
                  {isFree ? (
                    <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4 text-gray-300 group-hover:text-emerald-400 transition-colors"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 px-4 py-3 text-center">
          <p className="text-xs text-gray-400">{sections.length} sections · Start with Section 1</p>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Course;
