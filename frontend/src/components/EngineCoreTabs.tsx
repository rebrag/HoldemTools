// src/components/EngineCoreTabs.tsx
//
// Which htsolver core a tree is being built for, rendered at the top of every
// tree builder: /multiway's N-seat preflop builder, /multiway-postflop's
// N-seat postflop one, and /compare's heads-up postflop TreeBuilding panel.
//
// These are different solvers, not settings of one. Multiway preflop deals a
// real board every iteration and never buckets hands; heads-up postflop is
// exact on a fixed board and gated against PioSolver; multiway postflop is
// exact at three seats and sampled past that, because the vectorized showdown
// sweep has no O(H) form beyond three. A builder that does not say which one
// it feeds is what this fixes; the navigation is a side effect of naming
// them, not the point.
//
// Deliberately NOT a prop on TreeBuilding.tsx. That panel is also rendered by
// pages/solver/TreeBuildingModal for a PioSOLVER game-tree upload, where
// there is no engine-core choice at all, so a prop there would mean "not
// here" at two of its three call sites. Both engine pages put this in their
// own drawer header instead, which also keeps src/components free of any
// dependency on src/pages.
import { useNavigate } from "react-router-dom";
import SegmentedControl from "@/components/SegmentedControl";
import { preloadRoute } from "@/lib/routePreload";

export type EngineCore = "multiway" | "multiwayPostflop" | "postflop";

const ROUTE: Record<EngineCore, string> = {
  multiway: "/multiway",
  multiwayPostflop: "/multiway-postflop",
  postflop: "/compare",
};

const ORDER: EngineCore[] = ["multiway", "multiwayPostflop", "postflop"];

/** What the active core actually solves, in one line - the whole reason the
 *  tabs sit on the builder rather than in a page header. */
const CAPTION: Record<EngineCore, string> = {
  multiway:
    "N-seat jam-or-fold preflop. Every combo keeps its own strategy - nothing is bucketed - and the only approximation is the board runout at an all-in showdown, averaged over a seeded sample.",
  multiwayPostflop:
    "3 to 9 seats on one board, with side pots. Exact at three seats, where the showdown sweep still runs in O(H); past three it deals concrete cards instead, which conserves chips at any seat count but reports no exploitability.",
  postflop:
    "Heads-up postflop, solved exactly on one board and checked node for node against PioSolver.",
};

const EngineCoreTabs = ({
  value,
  className = "",
}: {
  value: EngineCore;
  className?: string;
}) => {
  const navigate = useNavigate();
  /* Warm the other pages' chunks on intent rather than on click, the way
     NavBar does: every core is a code-split route, so switching is a full
     route change and the chunk is the latency. */
  const warm = () => {
    for (const core of ORDER) {
      if (core !== value) preloadRoute(ROUTE[core]);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`} onMouseEnter={warm} onFocus={warm}>
      <SegmentedControl<EngineCore>
        className="self-start text-xs"
        value={value}
        options={[
          { key: "multiway", label: "Multiway preflop" },
          { key: "multiwayPostflop", label: "Multiway postflop" },
          { key: "postflop", label: "Heads-up postflop" },
        ]}
        onChange={(next) => {
          if (next !== value) navigate(ROUTE[next]);
        }}
      />
      <p className="max-w-2xl text-[10px] leading-relaxed text-slate-500">{CAPTION[value]}</p>
    </div>
  );
};

export default EngineCoreTabs;
