// src/pages/multiway/MultiwayTreeBuilder.tsx
//
// The multiway preflop tree builder: game / limit / street / players, then
// stacks, blinds and the button, then the solve settings - laid out after
// MonkerSolver's two-step tree setup.
//
// Split out of MultiwaySolver so the page can host it in a ResponsiveDrawer
// the way /compare hosts TreeBuilding. In flow this is ~370 lines tall, which
// put the push/fold charts below the fold on anything narrower than a wide
// desktop.
//
// CONTENT ONLY - no drawer, no title, no engine-core tabs. The caller owns
// its drawer header (which is where EngineCoreTabs goes), for the same reason
// TreeBuilding.tsx leaves that to its two callers.
//
// Deliberately not TreeBuilding.tsx itself: that panel is structurally
// heads-up (oop/ip everywhere) and pinned byte-for-byte to PioViewer's
// clipboard format. See the header of multiwayView.ts.
import { useMemo, type ReactNode } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  actionOrder,
  blindSeats,
  effectiveBb,
  isSampledCore,
  potChips,
  seatLabels,
  withPlayers,
  type MultiwayView,
} from "./multiwayView";

/** Shared with the page, so its chrome matches the builder it opens. */
export const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 " +
  "transition-colors hover:border-slate-600 focus:border-emerald-500 focus:outline-none " +
  "focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-40";

export const buttonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 " +
  "bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors " +
  "hover:border-slate-500 hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-40";

export const labelCls = "text-[10px] font-medium uppercase tracking-wide text-slate-500";

/** A select whose unimplemented options stay visible but disabled. Showing
 *  them is the point - it says what this engine will grow into - and
 *  disabling them is what stops it silently accepting a tree it cannot
 *  solve. */
const GatedSelect = <T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; enabled: boolean; why?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) => (
  <label className="flex flex-col gap-1">
    <span className={labelCls}>{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={inputCls}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={!o.enabled} title={o.why}>
          {o.label}
          {o.enabled ? "" : "  (not yet)"}
        </option>
      ))}
    </select>
  </label>
);

export interface MultiwayTreeBuilderProps {
  value: MultiwayView;
  onChange: (next: MultiwayView) => void;
  /** Read-only while a solve is in flight. */
  disabled?: boolean;
  /** Everything wrong with the tree, from multiwayView's validate(). */
  issues: string[];
  /** Whatever the last queue / fetch / poll failed with. */
  error?: string | null;
  onSolve: () => void;
  onDownloadConfig: () => void;
  /** Job status beside the Solve button while one is running. */
  statusSlot?: ReactNode;
}

const MultiwayTreeBuilder = ({
  value,
  onChange,
  disabled = false,
  issues,
  error,
  onSolve,
  onDownloadConfig,
  statusSlot,
}: MultiwayTreeBuilderProps) => {
  const set = <K extends keyof MultiwayView>(key: K, next: MultiwayView[K]) =>
    onChange({ ...value, [key]: next });

  const labels = useMemo(
    () => seatLabels(value.players, value.button),
    [value.players, value.button]
  );
  const { sb, bb } = useMemo(
    () => blindSeats(value.players, value.button),
    [value.players, value.button]
  );
  const order = useMemo(
    () => actionOrder(value.players, value.button),
    [value.players, value.button]
  );
  const bbCount = effectiveBb(value);
  const pot = potChips(value);
  // On the sampled-deal core board_sample stops being a solve parameter and
  // becomes only the measuring stick, which changes what half these fields
  // mean. The predicate is the config's own, so the copy cannot drift from
  // the tree that gets built.
  const sampled = isSampledCore(value);

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Step 1: New tree ---- */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 className="mb-2 text-xs font-semibold text-slate-200">New tree</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <GatedSelect
            label="Game"
            value={value.game}
            disabled={disabled}
            onChange={(v) => set("game", v)}
            options={[
              { value: "holdem", label: "Hold'em", enabled: true },
              {
                value: "omaha",
                label: "Omaha Hi",
                enabled: false,
                why: "PLO needs a 270k-combo hand universe and a four-card terminal evaluator.",
              },
              { value: "omaha_hi_lo", label: "Omaha Hi/Lo", enabled: false },
            ]}
          />
          <GatedSelect
            label="Limit"
            value={value.limit}
            disabled={disabled}
            onChange={(v) => set("limit", v)}
            options={[
              { value: "nl", label: "No limit", enabled: true },
              { value: "pl", label: "Pot limit", enabled: false },
            ]}
          />
          <GatedSelect
            label="Street"
            value={value.street}
            disabled={disabled}
            onChange={(v) => set("street", v)}
            options={[
              { value: "preflop", label: "Preflop", enabled: true },
              {
                value: "flop",
                label: "Flop",
                enabled: false,
                why: "Multiway postflop is the next milestone.",
              },
              { value: "turn", label: "Turn", enabled: false },
              { value: "river", label: "River", enabled: false },
            ]}
          />
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Players</span>
            <input
              type="number"
              min={MIN_PLAYERS}
              max={MAX_PLAYERS}
              value={value.players}
              disabled={disabled}
              onChange={(e) => onChange(withPlayers(value, Number(e.target.value)))}
              className={`${inputCls} tabular-nums`}
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Actions are all-in or fold. Real preflop sizings are a later pass - the tree builder
          already carries the fields and refuses them.
        </p>
      </section>

      {/* ---- Step 2: stacks, blinds, button ---- */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-200">Stacks and blinds</h2>
          <span className="text-[10px] tabular-nums text-emerald-400">
            {Number.isFinite(bbCount) ? `${bbCount.toFixed(1)} bb effective` : ""}
          </span>
        </div>
        <div className="mb-2 grid grid-cols-4 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Pot</span>
            <input
              readOnly
              value={pot}
              title="Blinds, antes and dead money. Derived, not typed: the engine computes it the same way."
              className={`${inputCls} tabular-nums opacity-70`}
            />
          </label>
          {(
            [
              ["smallBlind", "SB"],
              ["bigBlind", "BB"],
              ["ante", "Ante"],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className={labelCls}>{text}</span>
              <input
                inputMode="decimal"
                value={value[key]}
                disabled={disabled}
                onChange={(e) => set(key, e.target.value)}
                className={`${inputCls} tabular-nums`}
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-[2.5rem_1fr_3.2rem_3.2rem] items-center gap-x-2 gap-y-1">
          <span className={labelCls}>Seat</span>
          <span className={labelCls}>Stack (chips)</span>
          <span className={`${labelCls} text-center`}>Button</span>
          <span
            className={`${labelCls} text-center`}
            title="Mark exactly two seats to share hole cards and maximize their SUMMED EV - collusion research. The pair plays one joint strategy conditioned on both hands."
          >
            Share
          </span>
          {Array.from({ length: value.players }, (_, i) => (
            <div key={i} className="contents">
              <span className="text-[11px] font-semibold text-slate-300">{labels[i]}</span>
              <input
                inputMode="decimal"
                value={value.stacks[i] ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const stacks = [...value.stacks];
                  stacks[i] = e.target.value;
                  onChange({ ...value, stacks });
                }}
                className={`${inputCls} tabular-nums`}
              />
              <input
                type="radio"
                name="button-seat"
                checked={value.button === i}
                disabled={disabled}
                onChange={() => set("button", i)}
                aria-label={`Button on seat ${i + 1}`}
                className="mx-auto h-3.5 w-3.5 accent-emerald-500"
              />
              <input
                type="checkbox"
                checked={value.teamSeats.includes(i)}
                disabled={disabled || (value.teamSeats.length >= 2 && !value.teamSeats.includes(i))}
                onChange={() =>
                  onChange({
                    ...value,
                    teamSeats: value.teamSeats.includes(i)
                      ? value.teamSeats.filter((s) => s !== i)
                      : [...value.teamSeats, i],
                  })
                }
                aria-label={`Seat ${i + 1} shares hands`}
                className="mx-auto h-3.5 w-3.5 accent-amber-500"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          The button sets everything else: {labels[sb]} posts the small blind, {labels[bb]} the big
          blind, and the action runs {order.map((s) => labels[s]).join(" → ")}.
          {value.players === 2 ? " Heads-up the button is the small blind and acts first." : ""}
        </p>
        {value.teamSeats.length === 2 && (
          <div className="mt-2 rounded-lg border border-amber-900/60 bg-amber-950/20 p-2">
            <div className="flex items-center gap-3">
              <span className={labelCls}>
                {labels[value.teamSeats[0]]}+{labels[value.teamSeats[1]]} share hands. Opponents
              </span>
              {(["unaware", "aware"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1 text-[11px] text-slate-300">
                  <input
                    type="radio"
                    name="awareness"
                    checked={value.awareness === mode}
                    disabled={disabled}
                    onChange={() => set("awareness", mode)}
                    className="h-3 w-3 accent-amber-500"
                  />
                  {mode === "unaware" ? "don't know" : "know"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {value.awareness === "unaware"
                ? "Opponents play the frozen no-team baseline (solved first); the team computes a joint best response against it - the maximum-extraction answer, with a real convergence guarantee (one payoff, one optimizer)."
                : "Everyone trains together with the team as one payoff-coupled player, so opponents adapt - and being known to share hands can cost more than the sharing gains."}{" "}
              Research and analysis tooling: using this against live tables is cheating and bannable
              everywhere.
            </p>
            {value.awareness === "unaware" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={labelCls}
                  title="Phase-1 iterations for the no-team baseline the opponents get frozen at. The baseline converges quickly; the team phase (Max iterations) is what sharpens the conditioned charts, so long solves want this much smaller than Max iterations."
                >
                  Baseline iterations
                </span>
                <input
                  value={value.baselineIterations}
                  disabled={disabled}
                  onChange={(e) => set("baselineIterations", e.target.value)}
                  placeholder="= max iterations"
                  inputMode="numeric"
                  className="w-36 rounded border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-600"
                />
                <span className="text-[10px] text-slate-500">
                  phase 1 (baseline); Max iterations is phase 2 (the team)
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <h2 className="mb-2 text-xs font-semibold text-slate-200">Solve settings</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              [
                "boardSamplePair",
                "Pairwise boards",
                "Boards behind the exact heads-up equity matrix. Built once; costs setup time, not iterations.",
              ],
              [
                "boardSampleIter",
                sampled ? "Measuring boards" : "Multiway boards",
                sampled
                  ? "The SOLVE never reads this - it deals a real board every iteration. This only sizes the fixed-board evaluator behind the EVs shown below, and it is most of the wall clock: halve it to halve the wait, at the price of noise on the EVs and none on the strategy."
                  : "Boards averaged per iteration at 3+ way showdowns, where the value does not factorize.",
              ],
              [
                "accuracy",
                "Target (chips)",
                sampled
                  ? "Ignored at four or more seats: the evaluator that measures exploitability is itself approximate there, so the solve runs the full iteration count rather than stopping on a number it cannot trust."
                  : "Per-player exploitability to stop at.",
              ],
              [
                "maxIterations",
                "Max iterations",
                sampled
                  ? "One dealt hand per iteration, so this is the real convergence knob here."
                  : "",
              ],
            ] as const
          ).map(([key, text, why]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className={labelCls} title={why}>
                {text}
              </span>
              <input
                inputMode="decimal"
                value={value[key]}
                disabled={disabled}
                onChange={(e) => set(key, e.target.value)}
                className={`${inputCls} tabular-nums`}
              />
            </label>
          ))}
        </div>
        {/* Continuation, made explicit. A solve is a lineage, not one run:
            with an id set, solving again picks up where that id left off and
            Max iterations is the TOTAL to reach. Loading a past solve fills
            this in, which is what makes "load it, raise the budget, solve"
            a deliberate continuation. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
          <span
            className={labelCls}
            title="Names the solve so it can be continued. Leave it blank and the engine derives one from the spot, so re-solving the same spot continues it anyway - the id just makes that intentional and visible."
          >
            Solve ID
          </span>
          <input
            value={value.solveId}
            disabled={disabled}
            onChange={(e) => set("solveId", e.target.value)}
            placeholder="auto (derived from the spot)"
            className="w-52 rounded border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-600"
          />
          <span className="text-[10px] text-slate-500">
            {value.solveId.trim() !== ""
              ? "Solving continues this id from where it stopped; Max iterations is the total to reach."
              : "Blank = derived from the spot. Re-solving the same spot still continues it."}
          </span>
        </div>
      </section>

      {issues.length > 0 && (
        <ul className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSolve}
          disabled={disabled || issues.length > 0}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? "Solving…" : "Solve"}
        </button>
        <button type="button" onClick={onDownloadConfig} className={buttonCls} disabled={disabled}>
          Download config
        </button>
        {statusSlot}
      </div>
    </div>
  );
};

export default MultiwayTreeBuilder;
