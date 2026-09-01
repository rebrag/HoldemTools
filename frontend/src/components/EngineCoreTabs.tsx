// src/components/EngineCoreTabs.tsx
//
// Which htsolver core a tree is being built for, rendered at the top of both
// tree builders: /multiway's N-seat preflop builder and /compare's heads-up
// postflop TreeBuilding panel.
//
// The two are different solvers, not two settings of one - multiway preflop
// deals a real board every iteration and never buckets hands, while heads-up
// postflop is exact on a fixed board and gated against PioSolver. A builder
// that does not say which one it feeds is what this fixes; the navigation is
// a side effect of naming them, not the point.
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

export type EngineCore = "multiway" | "postflop";

const ROUTE: Record<EngineCore, string> = {
  multiway: "/multiway",
  postflop: "/compare",
};

const OTHER: Record<EngineCore, EngineCore> = {
  multiway: "postflop",
  postflop: "multiway",
};

/** What the active core actually solves, in one line - the whole reason the
 *  tabs sit on the builder rather than in a page header. */
const CAPTION: Record<EngineCore, string> = {
  multiway:
    "N-seat jam-or-fold preflop. Every combo keeps its own strategy - nothing is bucketed - and the only approximation is the board runout at an all-in showdown, averaged over a seeded sample.",
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
  /* Warm the other page's chunk on intent rather than on click, the way
     NavBar does: both cores are code-split routes, so switching is a full
     route change and the chunk is the latency. */
  const warm = () => preloadRoute(ROUTE[OTHER[value]]);

  return (
    <div className={`flex flex-col gap-1 ${className}`} onMouseEnter={warm} onFocus={warm}>
      <SegmentedControl<EngineCore>
        className="self-start text-xs"
        value={value}
        options={[
          { key: "multiway", label: "Multiway preflop" },
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
