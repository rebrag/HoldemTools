import React from "react";
import { useNavigate } from "react-router-dom";

export interface CourseOutlineSection {
  number: number;
  title: string;
}

interface CourseOutlineSidebarProps {
  sections: CourseOutlineSection[];
  activeSection?: number;
  completedSections: Set<number>;
  isFree: boolean;
  /** Tailwind top offset for the sticky container; must clear any fixed/sticky headers above it. */
  stickyTopClassName?: string;
}

const CourseOutlineSidebar: React.FC<CourseOutlineSidebarProps> = ({
  sections,
  activeSection,
  completedSections,
  isFree,
  stickyTopClassName = "top-16",
}) => {
  const navigate = useNavigate();

  return (
    <aside className={`hidden lg:block w-64 shrink-0 sticky ${stickyTopClassName} self-start`}>
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">Course Outline</h2>
        </div>
        <div className="divide-y divide-gray-100 max-h-[calc(100vh-8rem)] overflow-y-auto">
          {sections.map((section) => {
            const isActive = section.number === activeSection;
            const isComplete = completedSections.has(section.number);
            return (
              <button
                key={section.number}
                type="button"
                onClick={() => navigate(`/course/${section.number}`)}
                className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 transition-colors group ${
                  isActive ? "bg-emerald-50" : "hover:bg-emerald-50/60"
                }`}
              >
                {isComplete ? (
                  <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 ring-1 ring-emerald-400 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.704 5.29a1 1 0 010 1.414l-7.01 7.01a1 1 0 01-1.414 0L3.296 8.72a1 1 0 111.414-1.414l3.156 3.156 6.303-6.303a1 1 0 011.535.131z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                ) : (
                  <div
                    className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                      isActive
                        ? "bg-emerald-100 ring-1 ring-emerald-400"
                        : "bg-emerald-50 ring-1 ring-emerald-200 group-hover:ring-emerald-400"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-emerald-700">{section.number}</span>
                  </div>
                )}
                <span
                  className={`text-xs truncate ${
                    isActive ? "font-semibold text-gray-900" : "text-gray-600 group-hover:text-gray-900"
                  }`}
                >
                  {section.title}
                </span>
                {isFree && (
                  <svg className="w-3 h-3 text-gray-300 ml-auto shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default CourseOutlineSidebar;
