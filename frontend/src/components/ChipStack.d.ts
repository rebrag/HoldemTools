import { FC } from "react";

interface ChipStackProps {
  amount: number;
  singleStack?: boolean;
  showLabel?: boolean;
  showBreakdown?: boolean;
  showAmount?: boolean;
}

declare const ChipStack: FC<ChipStackProps>;
export default ChipStack;
