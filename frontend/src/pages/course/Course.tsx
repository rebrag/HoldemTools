import React from "react";

const sections = [
  {
    number: 1,
    title: "Why Math Matters",
    description:
      "Understand why poker is a game of incomplete information and how mathematical thinking separates winning players from the rest.",
  },
  {
    number: 2,
    title: "Measurements",
    description:
      "Learn the fundamental units poker players use — pot odds, equity, expected value — and how to measure every situation accurately.",
  },
  {
    number: 3,
    title: "Getting Started with Numbers",
    description:
      "Build your number fluency: counting outs, estimating percentages, and doing quick mental math at the table.",
  },
  {
    number: 4,
    title: "Hit the Deck",
    description:
      "A deep dive into the deck itself — card combinations, hand frequencies, and how often different board textures appear.",
  },
  {
    number: 5,
    title: "Putting it Together",
    description:
      "Combine math and board reading to make informed decisions on every street from preflop through the river.",
  },
  {
    number: 6,
    title: "World of the Unknown",
    description:
      "Explore ranges, ranges vs. ranges, and how to think probabilistically when you can't see your opponent's cards.",
  },
  {
    number: 7,
    title: "Aggression",
    description:
      "Discover why aggression is mathematically profitable, when to bet, and how bet sizing shapes your opponents' decisions.",
  },
  {
    number: 8,
    title: "At the Table",
    description:
      "Translate theory into live play: reading timing tells, managing tilt, and applying GTO concepts under pressure.",
  },
  {
    number: 9,
    title: "Summary",
    description:
      "Review the core concepts, build a study plan, and take the next steps toward thinking like a poker professional.",
  },
];

const Course: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto px-4 pb-12 pt-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Course
        </p>
        <h1 className="text-2xl font-semibold text-white">
          Think Like a Professional
        </h1>
        <p className="text-sm text-emerald-100/80 max-w-md">
          An entry-level guide to understanding poker through the lens of mathematics and strategy.
        </p>
      </div>

      {/* Outline */}
      <div className="rounded-2xl border border-emerald-300/40 bg-white/95 shadow-lg shadow-emerald-500/20 overflow-hidden backdrop-blur-sm">
        <div className="border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">Course Outline</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {sections.map((section) => (
            <div key={section.number} className="flex gap-4 px-4 py-3.5">
              <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center mt-0.5">
                <span className="text-[11px] font-bold text-emerald-700">{section.number}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{section.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{section.description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 px-4 py-3 text-center">
          <p className="text-xs text-gray-400">Course content coming soon.</p>
        </div>
      </div>
    </div>
  );
};

export default Course;
