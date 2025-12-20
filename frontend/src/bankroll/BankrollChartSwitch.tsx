import React from "react";
import BankrollChart from "./BankrollChart";
import BankrollChartShadcn from "./BankrollChartShadcn";
import type { CumulativePoint } from "./types";

type Props = {
  points: CumulativePoint[];
  hoverIndex: number | null;
  onHoverIndexChange: (idx: number | null) => void;
};

const CHART_IMPL: "svg" | "shadcn" = "shadcn";

const BankrollChartSwitch: React.FC<Props> = (props) => {
  return CHART_IMPL === "shadcn" ? (
    <BankrollChartShadcn {...props} />
  ) : (
    <BankrollChart {...props} />
  );
};

export default BankrollChartSwitch;
