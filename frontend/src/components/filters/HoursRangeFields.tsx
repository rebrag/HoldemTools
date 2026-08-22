// src/components/filters/HoursRangeFields.tsx
// Bankroll's session-length (hours) min–max pair, passed to SessionFilterPanel
// as an `extraRows` slot. Bankroll-only: hands have no duration.
import React from "react";
import { FILTER_THEMES, type FilterTheme } from "./SessionFilterPanel";

interface Props {
  minHours: string;
  maxHours: string;
  onChange: (patch: { minHours?: string; maxHours?: string }) => void;
  theme?: FilterTheme;
}

const HoursRangeFields: React.FC<Props> = ({
  minHours,
  maxHours,
  onChange,
  theme = "light",
}) => {
  const t = FILTER_THEMES[theme];

  return (
    <div className="flex flex-col gap-1">
      <span className={t.label}>Session length (hrs)</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={0.25}
          className={t.hoursInput}
          placeholder="Min"
          value={minHours}
          onChange={(e) => onChange({ minHours: e.target.value })}
        />
        <span className={t.dash}>–</span>
        <input
          type="number"
          min={0}
          step={0.25}
          className={t.hoursInput}
          placeholder="Max"
          value={maxHours}
          onChange={(e) => onChange({ maxHours: e.target.value })}
        />
      </div>
    </div>
  );
};

export default HoursRangeFields;
