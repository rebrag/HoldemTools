import React, { useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import { useCurrentTier } from "@/context/TierContext";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { QuizTracker } from "./components/QuizTrackerContext";
import ProUpsell from "@/components/ProUpsell";
import { useState } from "react";
import Section1 from "./sections/Section1";
import Section2 from "./sections/Section2";
import Section3 from "./sections/Section3";
import Section4 from "./sections/Section4";
import Section5 from "./sections/Section5";
import Section6 from "./sections/Section6";
import Section7 from "./sections/Section7";
import Section8 from "./sections/Section8";
import Section9 from "./sections/Section9";

const SECTIONS = [
  { number: 1, title: "Why Math Matters" },
  { number: 2, title: "Measurements" },
  { number: 3, title: "Getting Started with Numbers" },
  { number: 4, title: "Hit the Deck" },
  { number: 5, title: "Putting it Together" },
  { number: 6, title: "World of the Unknown" },
  { number: 7, title: "Aggression" },
  { number: 8, title: "At the Table" },
  { number: 9, title: "Summary" },
];

function getSectionContent(id: number): React.ReactNode {
  switch (id) {
    case 1: return <Section1 />;
    case 2: return <Section2 />;
    case 3: return <Section3 />;
    case 4: return <Section4 />;
    case 5: return <Section5 />;
    case 6: return <Section6 />;
    case 7: return <Section7 />;
    case 8: return <Section8 />;
    case 9: return <Section9 />;
    default:
      return (
        <div className="text-center py-12 text-gray-400 text-sm">
          Section not found.
        </div>
      );
  }
}

const ChevronLeft: React.FC = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRight: React.FC = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

interface CourseSectionProps {
  user: User | null;
}

const CourseSection: React.FC<CourseSectionProps> = ({ user }) => {
  const { sectionId } = useParams<{ sectionId: string }>();
  const navigate = useNavigate();
  const { isFree, loading: tierLoading } = useCurrentTier();
  const { completedSections, markComplete } = useCourseProgress(user?.uid ?? null);
  const [upsellOpen, setUpsellOpen] = useState(false);

  const id = Math.max(1, Math.min(9, parseInt(sectionId ?? "1", 10) || 1));
  const section = SECTIONS[id - 1];
  const isFirst = id === 1;
  const isLast = id === SECTIONS.length;
  const isComplete = completedSections.has(id);

  const handleAllCorrect = useCallback(async () => {
    try {
      await markComplete(id);
    } catch (err) {
      console.error("Failed to mark section complete:", err);
    }
  }, [markComplete, id]);

  return (
    <>
      {/* Course secondary navbar */}
      <div className="sticky top-12 z-40 bg-[#121418]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 h-11 flex items-center gap-3">
          <button
            onClick={() => navigate("/course")}
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
          >
            <ChevronLeft />
            Course Outline
          </button>
          <span className="text-white/20 shrink-0">·</span>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400 shrink-0">
              {section.number}/{SECTIONS.length}
            </span>
            <span className="text-xs text-white/60 truncate">{section.title}</span>
          </div>
          {isComplete && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30 shrink-0">
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.414l-7.01 7.01a1 1 0 01-1.414 0L3.296 8.72a1 1 0 111.414-1.414l3.156 3.156 6.303-6.303a1 1 0 011.535.131z" clipRule="evenodd" />
              </svg>
              Complete
            </span>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-12 pt-6 space-y-6">
      {/* Content card */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        {tierLoading ? (
          <div className="px-5 py-10 flex justify-center">
            <svg className="w-5 h-5 animate-spin text-gray-300" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" fill="none" />
            </svg>
          </div>
        ) : isFree ? (
          <div className="px-5 py-10 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-gray-900">Plus or Pro required</p>
              <p className="text-sm text-gray-500 max-w-xs">
                Upgrade your plan to unlock all 9 course sections and track your progress.
              </p>
            </div>
            <button
              onClick={() => setUpsellOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
            >
              Upgrade to unlock
            </button>
          </div>
        ) : (
          <QuizTracker key={id} onAllCorrect={handleAllCorrect}>
            <div className="px-5 py-5">{getSectionContent(id)}</div>
          </QuizTracker>
        )}
      </div>

      {/* Prev / Next */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => (isFirst ? navigate("/course") : navigate(`/course/${id - 1}`))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-white/10 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-white/20 transition-colors"
        >
          <ChevronLeft />
          {isFirst ? "Back to Outline" : `Section ${id - 1}`}
        </button>

        {!isLast && (
          <button
            onClick={() => navigate(`/course/${id + 1}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/40 bg-white/10 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-white/20 transition-colors"
          >
            {`Section ${id + 1}`}
            <ChevronRight />
          </button>
        )}
      </div>

      {/* Upsell modal */}
      <ProUpsell open={upsellOpen} onClose={() => setUpsellOpen(false)} />
    </div>
    </>
  );
};

export default CourseSection;
