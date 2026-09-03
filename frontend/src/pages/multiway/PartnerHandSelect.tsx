// src/pages/multiway/PartnerHandSelect.tsx
//
// The conditioning control for a hand-sharing team's chart: which hand the
// PARTNER holds. Null is the partner-averaged marginal; a class picks the
// conditioned strategy, which is the shared-cards strategy itself. Used by
// the single-solve panel beside its matrix and, in its dense form, at the top
// of each team seat's plate in the group view.
import { CLASS_NAMES } from "./pushfoldResult";

export interface PartnerRollup {
  partner_reach?: number[];
  ev?: unknown;
}

const reachSuffix = (reach: number | undefined): string =>
  reach == null ? "" : reach < 0.005 ? " - never here" : reach < 0.05 ? " - rare here" : "";

/** What the chosen conditioning means for how to read the chart. */
const partnerReachNote = (rollup: PartnerRollup, value: number | null): string => {
  if (value == null) return "Partner-averaged chart; pick a hand to see the conditioned strategy.";
  const reach = rollup.partner_reach?.[value] ?? 1;
  if (reach < 0.005) {
    return "The partner never reaches this spot holding that hand - this conditioning never happens, so the chart is untrained noise.";
  }
  if (reach < 0.05) {
    return "The partner rarely arrives here with that hand, so this conditioned chart trains on thin data - read it loosely.";
  }
  return rollup.ev
    ? "Conditioned on the partner's hand - the shared-cards strategy itself. Tooltip EVs are the TEAM's (own + partner, in big blinds), the quantity the pair maximizes."
    : "Conditioned on the partner's hand - the shared-cards strategy itself. Frequencies only; this payload predates conditioned EVs.";
};

const PartnerHandSelect = ({
  rollup,
  partnerLabel,
  value,
  onChange,
  dense = false,
}: {
  rollup: PartnerRollup;
  partnerLabel: string;
  value: number | null;
  onChange: (partnerClass: number | null) => void;
  /** One tight row for a plate header; the note rides in the title. */
  dense?: boolean;
}) => {
  const note = partnerReachNote(rollup, value);
  const select = (
    <select
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      title={dense ? note : undefined}
      aria-label={`${partnerLabel} holds`}
      className={
        dense
          ? "min-w-0 flex-1 rounded border border-slate-700 bg-slate-800/80 px-1 py-0.5 text-[10px] text-slate-200"
          : "rounded border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-200"
      }
    >
      <option value="">any hand (marginal)</option>
      {CLASS_NAMES.map((name, i) => (
        <option key={name} value={String(i)}>
          {name + reachSuffix(rollup.partner_reach?.[i])}
        </option>
      ))}
    </select>
  );

  if (dense) {
    return (
      <label className="flex w-full items-center gap-1 text-[10px]">
        <span className="shrink-0 uppercase tracking-wide text-slate-400">{partnerLabel} holds</span>
        {select}
      </label>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{partnerLabel} holds</span>
      {select}
      <span className="text-[10px] text-slate-500">{note}</span>
    </div>
  );
};

export default PartnerHandSelect;
