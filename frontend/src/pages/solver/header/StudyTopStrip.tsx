// StudyTopStrip.tsx
//
// Header for the desktop single-range "study" layout: compact SimSelect box
// with the Line strip beside it. The line and library button are passed in as
// slots because Solver builds them (they need the postflop session).
import type { ReactNode, Ref } from "react";
import SimSelect, { type SimSelectProps } from "../SimSelect";

interface StudyTopStripProps extends SimSelectProps {
  line: ReactNode;
  libraryButton: ReactNode;
  lineWrapperRef: Ref<HTMLDivElement>;
}

const StudyTopStrip = ({
  line,
  libraryButton,
  lineWrapperRef,
  ...simSelectProps
}: StudyTopStripProps) => (
  <div className="px-2 sm:px-4 mt-1">
    <div className="mx-auto w-full max-w-[1480px]">
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
        {libraryButton}
      </div>
    </div>
  </div>
);

export default StudyTopStrip;
