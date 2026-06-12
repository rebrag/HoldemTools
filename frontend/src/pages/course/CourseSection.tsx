import React from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  <svg
    className="w-4 h-4"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRight: React.FC = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const CourseSection: React.FC = () => {
  const { sectionId } = useParams<{ sectionId: string }>();
  const navigate = useNavigate();

  const id = Math.max(1, Math.min(9, parseInt(sectionId ?? "1", 10) || 1));
  const section = SECTIONS[id - 1];
  const isFirst = id === 1;
  const isLast = id === SECTIONS.length;

  return (
    <div className="max-w-2xl mx-auto px-4 pb-12 pt-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <button
          onClick={() => navigate("/course")}
          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-1"
        >
          <ChevronLeft />
          Course Outline
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Section {section.number} of {SECTIONS.length}
        </p>
        <h1 className="text-2xl font-semibold text-white">{section.title}</h1>
      </div>

      {/* Content card */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="px-5 py-5">{getSectionContent(id)}</div>
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
    </div>
  );
};

export default CourseSection;
