// StudyTopStrip.tsx
//
// The solver's one top strip, every layout and viewport: compact SimSelect
// box with the Line strip beside it. The line is passed in as a slot because
// Solver builds it (it needs the postflop session); the solved-flops library
// button rides inside SimSelect's own control row, forwarded through
// SimSelectProps.
import type { ReactNode, Ref } from "react";
import SimSelect, { type SimSelectProps } from "../SimSelect";

interface StudyTopStripProps extends SimSelectProps {
  line: ReactNode;
  lineWrapperRef: Ref<HTMLDivElement>;
}

const StudyTopStrip = ({
  line,
  lineWrapperRef,
  ...simSelectProps
}: StudyTopStripProps) => (
  <div className="px-2 sm:px-4 mt-1">
    <div className="mx-auto w-full max-w-[1800px]">
      <div className="relative z-50 flex items-stretch gap-2 sm:gap-3">
        {/* The phone width is the sim panel's control row measured exactly -
            four 36px buttons, three 4px gaps, 6px padding each side - so every
            pixel the strip does not need goes to the line cards beside it. */}
        <div
          data-intro-target="folder-selector"
          className="w-[170px] flex-shrink-0 sm:w-[300px]"
        >
          <SimSelect {...simSelectProps} />
        </div>
        <div
          ref={lineWrapperRef}
          className="relative flex min-w-0 flex-1 items-stretch"
        >
          {line}
        </div>
      </div>
    </div>
  </div>
);

export default StudyTopStrip;
