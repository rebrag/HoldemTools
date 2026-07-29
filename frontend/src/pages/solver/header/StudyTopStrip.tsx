// StudyTopStrip.tsx
//
// Header for the desktop single-range "study" layout: compact SimSelect box
// with the Line strip beside it. The line is passed in as a slot because
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
      <div className="relative z-50 flex items-stretch gap-3">
        <div
          data-intro-target="folder-selector"
          className="w-[300px] flex-shrink-0"
        >
          <SimSelect {...simSelectProps} />
        </div>
        <div
          ref={lineWrapperRef}
          className="relative flex min-w-0 flex-1 items-center"
        >
          {line}
        </div>
      </div>
    </div>
  </div>
);

export default StudyTopStrip;
