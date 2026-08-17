import { FC } from "react";

interface ChipStackProps {
  amount: number;
  singleStack?: boolean;
  /** Spread the chips left→right instead of stacking them upward. */
  horizontal?: boolean;
  showLabel?: boolean;
  showBreakdown?: boolean;
  showAmount?: boolean;
}

declare const ChipStack: FC<ChipStackProps>;
export default ChipStack;
