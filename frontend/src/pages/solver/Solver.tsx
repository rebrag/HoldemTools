// src/components/Solver.tsx
import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import SingleRangeDesktopView from "./views/SingleRangeDesktopView";
import SingleRangeMobileView from "./views/SingleRangeMobileView";
import MultiRangeDesktopView from "./views/MultiRangeDesktopView";
import MultiRangeMobileView from "./views/MultiRangeMobileView";
import { displayedPot } from "@/lib/pokerPot";
import { getInitialMapping } from "@/lib/solver/getInitialMapping";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import useNoOverscroll from "@/hooks/useNoOverscroll";
import useSolverLayout from "./useSolverLayout";
import useFolders from "@/hooks/useFolders";
import useFiles from "@/hooks/useFiles";
import axios from "axios";
import { JsonData, passiveAction, plateActions } from "@/lib/solver/utils";
import Line from "./Line";
import { Steps } from "intro.js-react";
import "intro.js/introjs.css";
import { User } from "firebase/auth";
import LoginSignupModal from "@/components/LoginSignupModal";
import StudyTopStrip from "./header/StudyTopStrip";
import { MatrixHeightModePill } from "./FolderSelector";
import ProUpsell from "@/components/ProUpsell";
import {
  requiredTierForFolder,
  getPriceIdForTier,
  TIER_LABEL,
  type Tier,
  isTierSufficient,
  type FolderMetaLike,
} from "@/lib/stripe/stripeTiers";
import { startSubscriptionCheckout } from "@/lib/stripe/checkout";
import { uploadGameTree } from "@/lib/solver/uploadGameTree";
import { useCurrentTier } from "@/context/TierContext";
import PlayingCard from "@/components/PlayingCard";
import TreeBuildingModal, { type TreeBuildingInit } from "./TreeBuildingModal";
import { handleActionClickImpl, type PendingFlopUpload } from "@/lib/solver/handleActionClick";
import { POSTFLOP_ORDER, buildTreeConfigText, type TreeParams } from "@/lib/solver/treeConfig";
import { parseGametreePathForSolution } from "@/lib/solver/postflopClient";
import {
  fetchBoardManifest,
  solutionKey,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";
import { pollSolveJob, type SolveJobStatus } from "@/lib/solver/solveJobs";
import {
  boardToCards,
  docToJsonData,
  pooledCommitChips,
  potSplitChips,
} from "@/lib/solver/postflopNode";
import {
  loadMatrixHeightMode,
  saveMatrixHeightMode,
  type MatrixHeightMode,
} from "@/lib/solver/matrixHeight";
import {
  loadMatrixDisplayMode,
  saveMatrixDisplayMode,
  type MatrixDisplayMode,
} from "@/lib/solver/matrixDisplayMode";
import { comboKey, handClassOf } from "@/lib/solver/comboDetail";
import { usePostflopSession } from "@/hooks/usePostflopSession";
import usePostflopIndex from "@/hooks/usePostflopIndex";
import useHandHistoryTexts from "@/hooks/useHandHistoryTexts";
import PostflopLine from "./PostflopLine";
import { preflopNodeFiles, usePreflopLineNodes } from "./usePreflopLineNodes";
import PostflopLibrary from "./PostflopLibrary";
import PostflopCardPicker from "./PostflopCardPicker";
import { Library } from "lucide-react";
import { fmtMoney, type MoneyDisplay } from "./boardDisplay";
import type { PokerTableSeat } from "@/components/PokerTable";

// Toggle experimental postflop pipeline (upload + polling).
// Off unless VITE_POSTFLOP_ENABLED=true (frontend/.env locally; Vercel env var in prod).
import { POSTFLOP_ENABLED } from "@/lib/solver/constants";

const tourSteps = [
  { element: '[data-intro-target="folder-selector"]', intro: "Choose a pre-flop sim here.", position: "bottom" },
  { element: '[data-intro-target="color-key-btn"]', intro: "Toggle single-range view here.", position: "bottom" },
];

/**
 * Solution Library button: a compact dark square in the sim panel's
 * control row, matching the filter and single-range buttons beside it. (It
 * used to have a light wide variant for the classic header, which is gone.)
 *
 * The `aria-label` is load-bearing - several e2e specs reach this button by
 * accessible name, since its only content is an icon.
 */
const SolutionLibraryButton = ({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) => (
  <div className="relative flex-shrink-0">
    <button
      type="button"
      onClick={onClick}
      aria-label="Solution library"
      title="Browse your solution library"
      className="
        relative inline-flex h-9 w-9 items-center justify-center
        rounded-lg border border-hairline bg-white/5 shadow-sm
        text-slate-300 transition-colors
        hover:border-white/25 hover:text-slate-100
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60
      "
    >
      <Library size={16} strokeWidth={2.2} className="text-emerald-400" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[1rem] rounded-full bg-emerald-600 px-1 text-center text-[10px] font-bold leading-4 text-white shadow">
          {count}
        </span>
      )}
    </button>
  </div>
);

/** What the pending banner says for each queue stage. */
const pendingStageLabel = (status?: SolveJobStatus, queuePosition?: number | null): string => {
  switch (status) {
    case "Queued":
      return queuePosition && queuePosition > 1
        ? `Queued · #${queuePosition} in line`
        : "Queued";
    case "Extracting":
      return "Preparing turns";
    case "Uploading":
      return "Publishing";
    default:
      // Claimed/Solving, or no job status yet.
      return "Solving flop";
  }
};

/** Pending banner shown while the local solver works on a fresh flop request.
 *  Tracks the solve job's stage and queue position; a failed job turns the
 *  card red with the watcher's error and a dismiss button.
 *
 *  It floats: the outer row is `h-0`, so the card overlays whatever is below
 *  it instead of pushing the study layout down. That matters beyond looks -
 *  the views budget their height from `useTopOffset`, so an in-flow banner
 *  shrank the matrix the moment a solve started and grew it back when the
 *  solve landed. */
const PendingSolveCard = ({
  board,
  startedAt,
  status,
  queuePosition,
  error,
  onDismiss,
}: {
  board: string[];
  startedAt: number;
  status?: SolveJobStatus;
  queuePosition?: number | null;
  error?: string | null;
  onDismiss?: () => void;
}) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const failed = status === "Failed";
  // items-start on the row is load-bearing: a flex child of a zero-height row
  // stretches to it by default and collapses to nothing but its own padding.
  return (
    <div className="pointer-events-none relative z-[70] flex h-0 items-start justify-center px-2">
      <div
        className={[
          "pointer-events-auto inline-flex items-center gap-2 rounded-md border px-3 py-1.5",
          "bg-slate-900/95 shadow-lg backdrop-blur-sm",
          "animate-in fade-in slide-in-from-top-2 duration-200",
          failed ? "border-red-400/60" : "border-amber-400/50",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-2 w-2 rounded-full",
            failed ? "bg-red-400" : "bg-amber-400 animate-pulse",
          ].join(" ")}
        />
        <span
          className={[
            "text-[11px] font-semibold tracking-wide",
            failed ? "text-red-300" : "text-amber-200",
          ].join(" ")}
        >
          {failed ? "Solve failed" : pendingStageLabel(status, queuePosition)}
        </span>
        {board.map((code) => (
          <PlayingCard key={code} code={code} width="clamp(24px, 5vw, 36px)" />
        ))}
        {failed ? (
          <>
            {error && (
              <span className="max-w-[16rem] truncate text-[11px] text-gray-300" title={error}>
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-gray-200 hover:bg-white/10"
            >
              Dismiss
            </button>
          </>
        ) : (
          <span className="text-[11px] tabular-nums text-gray-300">
            {mm}:{ss} elapsed · usually 2-10 min
          </span>
        )}
      </div>
    </div>
  );
};

type SolverProps = { user: User | null };

const Solver = ({ user }: SolverProps) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const uid = user?.uid ?? null;
  const { tier, loading: tierLoading } = useCurrentTier();

  const [folder, setFolder] = useState<string>("23UTG_23UTG1_23LJ_23HJ_23CO_23BTN_23SB_23BB");
  const [plateData, setPlateData] = useState<Record<string, JsonData>>({});
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});
  const [lastRange, setLastRange] = useState<string>("");
  const [lastRangePos, setLastRangePos] = useState<string>("");
  // Starts true: the fetch effect below resolves it on mount (immediately, via
  // its early return, when there is nothing to fetch). Starting at `false`
  // painted an empty range grid before the spinner appeared.
  const [loading, setLoading] = useState<boolean>(true);
  const [preflopLine, setPreflopLine] = useState<string[]>(["Root"]);
  const playerCount = useMemo(() => (folder ? folder.split("_").length : 1), [folder]);
  const [alivePlayers, setAlivePlayers] = useState<Record<string, boolean>>({});
  const [activePlayer, setActivePlayer] = useState<string>("");
  const [metadata, setMetadata] = useState<{ name: string; ante: number; icm: number[] }>({
    name: "",
    ante: 0,
    icm: [],
  });
  const isICMSim = Array.isArray(metadata.icm) && metadata.icm.length > 0;
  const [potSize, setPotSize] = useState<number>(0);
  const [playerBets, setPlayerBets] = useState<Record<string, number>>({});
  /* Chips each seat has already pushed into the middle, in bb. Preflop this
   * stays empty - bets sit in front of the seats until the flop - and the
   * postflop session fills it with the preflop money plus every matched
   * street, so a called bet keeps leaving the stack once it joins the pot. */
  const [potCommitted, setPotCommitted] = useState<Record<string, number>>({});

  const [tourRun, setTourRun] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [showLoginOverlay, setShowLoginOverlay] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [upsellBusy, setUpsellBusy] = useState(false);

  // Postflop modal
  const [pendingFlopUpload, setPendingFlopUpload] = useState<PendingFlopUpload | null>(null);
  const [showFlopModal, setShowFlopModal] = useState(false);

  const [currentBoard, setCurrentBoard] = useState<string[]>([]);

  // Postflop session (navigation) + solutions library
  const pf = usePostflopSession();
  /* `pf` is a fresh object every render but `close` is a stable useCallback -
   * callbacks that only close the session depend on this, not on `pf`. */
  const { close: closePostflop } = pf;
  const pfIndex = usePostflopIndex(Boolean(uid));
  const { hide: hideSolutions } = pfIndex;
  const [showLibrary, setShowLibrary] = useState(false);
  // Only fetched while the library is open: it is the previews above each
  // hand's solved boards, and nothing else on this page needs saved hands.
  const handTexts = useHandHistoryTexts(showLibrary && Boolean(uid));
  const [postflopPending, setPostflopPending] = useState<{
    board: string[];
    startedAt: number;
    status?: SolveJobStatus;
    queuePosition?: number | null;
    error?: string | null;
  } | null>(null);
  const pendingCancelRef = useRef(false);
  /* Preflop line being walked back into after leaving a board: the actions to
   * replay from the root, and how many of them have been applied. See the
   * replay effect below. */
  const [preflopReplay, setPreflopReplay] = useState<{
    folder: string;
    actions: string[];
    files: string[];
    step: number;
  } | null>(null);
  /* Seat the Line was asked to skip ahead to, with the steps taken so far as
   * a runaway guard. See the skip effect below. */
  const [skipTarget, setSkipTarget] = useState<{
    seat: string;
    steps: number;
  } | null>(null);

  // Single-range view toggle (persisted)
  const [singleRangeView, setSingleRangeView] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("singleRangeView");
      return raw === null ? true : raw === "1"; // default ON, respect saved "0"
    } catch {
      return true;
    }
  });

  // Matrix cell-height mode (persisted): normalized / range / full
  const [matrixHeightMode, setMatrixHeightMode] =
    useState<MatrixHeightMode>(loadMatrixHeightMode);

  // Matrix display mode (persisted): strategy / ev / equity
  const [matrixDisplayMode, setMatrixDisplayMode] =
    useState<MatrixDisplayMode>(loadMatrixDisplayMode);

  const lineWrapperRef = useRef<HTMLDivElement | null>(null);

  const tourBooted = useRef(localStorage.getItem("tourSeen") === "1");
  const lastClickRef = useRef<{ plate: string; action: string } | null>(null);

  const alivePositions = useMemo(
    () =>
      Object.entries(alivePlayers)
        .filter(([, alive]) => alive)
        .map(([pos]) => pos),
    [alivePlayers]
  );

  const defaultPlateNames = useMemo(() => {
    const filesArray: string[] = [];
    for (let i = 0; i < playerCount - 1; i++) {
      filesArray.push(i === 0 ? "root.json" : Array(i).fill("0").join(".") + ".json");
    }
    if (playerCount > 1) {
      const zeros = Array(playerCount - 1).fill("0");
      zeros[zeros.length - 1] = "1";
      filesArray.push(zeros.join(".") + ".json");
    }
    return filesArray;
  }, [playerCount]);

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 7) return ["SB", "BB", "UTG1", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 6) return ["SB", "BB", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 5) return ["SB", "BB", "HJ", "CO", "BTN"];
    if (playerCount === 4) return ["SB", "BB", "CO", "BTN"];
    if (playerCount === 3) return ["SB", "BB", "BTN"];
    if (playerCount === 2) return ["BTN", "BB"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

  // Pre-flop acting order (UTG … BTN, SB, BB); positionOrder is SB/BB-first seat order.
  const actingOrder = useMemo(
    () =>
      positionOrder.length <= 2
        ? positionOrder
        : [...positionOrder.slice(2), ...positionOrder.slice(0, 2)],
    [positionOrder]
  );

  // Average starting stack, parsed from the folder name (e.g. "23UTG_23BB").
  const avgStack = useMemo(() => {
    const stacks: number[] = [];
    folder.split("_").forEach((ch) => {
      const m = ch.match(/^(\d+(?:\.\d+)?)([A-Z][A-Z0-9+]*)$/i);
      if (m) stacks.push(Number(m[1]));
    });
    if (!stacks.length) return null;
    return Math.round((stacks.reduce((s, v) => s + v, 0) / stacks.length) * 10) / 10;
  }, [folder]);

  // Which of the four solver layouts is active (see useSolverLayout.ts).
  // displayPlates always has one entry per position, so positionOrder.length
  // is the plate count.
  const { mode, windowWidth, windowHeight } = useSolverLayout(
    singleRangeView,
    positionOrder.length
  );
  // Only the single-range layouts render a real PokerTable, and those deal the
  // board onto the felt themselves; the multi-range layouts show plates over a
  // bare felt backdrop and still need the standalone board strip.
  const boardOnTable = mode === "single-desktop" || mode === "single-mobile";

  // Chips actually in the pot (shared rule: lib/pokerPot displayedPot).
  // potSize is the inclusive pot on both sides of the flop - the preflop
  // machinery and the postflop sync both keep the live bets in it - so one
  // rule covers both. Folded players' dead chips deliberately stay in front
  // of their seats until the street completes.
  const actualPot = displayedPot(potSize, Object.values(playerBets));

  useEffect(() => {
    const initialAlive: Record<string, boolean> = {};
    const positions =
      playerCount === 8
        ? ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"]
        : playerCount === 7
        ? ["SB", "BB", "UTG1", "LJ", "HJ", "CO", "BTN"]
        : playerCount === 6
        ? ["SB", "BB", "LJ", "HJ", "CO", "BTN"]
        : playerCount === 5
        ? ["SB", "BB", "HJ", "CO", "BTN"]
        : playerCount === 4
        ? ["SB", "BB", "CO", "BTN"]
        : playerCount === 3
        ? ["SB", "BB", "BTN"]
        : playerCount === 2
        ? ["BB", "BTN"]
        : Object.keys(plateMapping);
    positions.forEach((pos) => (initialAlive[pos] = true));
    setAlivePlayers(initialAlive);
    const bbIdx = positions.indexOf("BB");
    const defaultIdx = (bbIdx + 1) % positions.length;
    setActivePlayer(positions[defaultIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerCount]);

  const [loadedPlates, setLoadedPlates] = useState<string[]>(defaultPlateNames);
  const folderRef = useRef(folder);
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  const defaultStateRef = useRef<{
    plateData: Record<string, JsonData>;
    plateMapping: Record<string, string>;
  }>({ plateData: {}, plateMapping: {} });

  useEffect(() => {
    defaultStateRef.current = { plateData: { ...plateData }, plateMapping: { ...plateMapping } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  const { folders, folderMetaMap, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, folder);

  const displayPlates = useMemo(
    () => positionOrder.map((pos) => plateMapping[pos] || ""),
    [plateMapping, positionOrder]
  );

  useEffect(() => {
    const folderNode = document.querySelector('[data-intro-target="folder-selector"]');
    const btnKey = document.querySelector('[data-intro-target="color-key-btn"]');
    setTourReady(Boolean(folderNode && btnKey));
  }, [displayPlates]);

  useEffect(() => {
    if (tourReady && !tourBooted.current) {
      setTourRun(true);
      tourBooted.current = true;
      localStorage.setItem("tourSeen", "1");
    }
  }, [tourReady]);

  const actuallyOpenFolder = useCallback(
    (selectedFolder: string) => {
      /* A folder pick means preflop study: an open postflop session (board,
       * line, pending solve banner) would otherwise stay on screen over the
       * new sim. This was previously only reachable through the line strip's
       * exit control, which hand-history sessions no longer render.
       * (openSolvedBoard also routes through here, then opens the next
       * session - the close is just the start of its swap.) */
      pendingCancelRef.current = true;
      setPostflopPending(null);
      closePostflop();
      setCurrentBoard([]);

      const newPlayerCount = selectedFolder.split("_").length;
      const freshPlates = defaultPlateNames;
      const freshMapping = getInitialMapping(newPlayerCount);
      setLoadedPlates(freshPlates);
      setPlateMapping(freshMapping);
      setPlateData({});
      setFolder(selectedFolder);
      setPreflopLine(["Root"]);
      setPotCommitted({});
      setPreflopReplay(null);
      setSkipTarget(null);
      setRandomFillEnabled(false);
      const initialAlive: Record<string, boolean> = {};
      Object.keys(freshMapping).forEach((pos) => (initialAlive[pos] = true));
      setAlivePlayers(initialAlive);
      const bbIdx = Object.keys(freshMapping).indexOf("BB");
      const nextIdx = (bbIdx + 1) % Object.keys(freshMapping).length;
      setActivePlayer(Object.keys(freshMapping)[nextIdx]);
    },
    [defaultPlateNames, closePostflop]
  );

  useEffect(() => {
    if (!uid || !pendingFolder || tierLoading) return;

    (async () => {
      let meta: FolderMetaLike | undefined;
      try {
        const r = await axios.get<FolderMetaLike>(
          `${API_BASE_URL}/api/Files/${pendingFolder}/metadata.json`,
          { timeout: 3000 }
        );
        meta = r.data;
      } catch {
        // no metadata; fall back to filename-only rules
      }

      const need = requiredTierForFolder(pendingFolder, meta);
      if (isTierSufficient(tier ?? "free", need)) {
        actuallyOpenFolder(pendingFolder);
        setPendingFolder(null);
        setPendingTier(null);
        setShowProModal(false);
        setUpsellBusy(false);
      }
    })();
  }, [uid, pendingFolder, tier, tierLoading, API_BASE_URL, actuallyOpenFolder]);

  useLayoutEffect(() => {
    setLoadedPlates(defaultPlateNames);
  }, [folder, playerCount, defaultPlateNames]);

  useEffect(() => {
    setPlateMapping((prev) => {
      const filtered: Record<string, string> = {};
      Object.keys(prev).forEach((pos) => {
        if (loadedPlates.includes(prev[pos])) filtered[pos] = prev[pos];
      });
      return filtered;
    });
  }, [loadedPlates]);

  // Fetch plate data
  useEffect(() => {
    const platesToFetch = loadedPlates.filter((plate) => !(plate in plateData));
    if (platesToFetch.length === 0) {
      setLoading(false);
      return;
    }
    // Flip synchronously. The old code deferred this behind setTimeout(…, 0) to
    // avoid a flash, but a 0ms threshold fires long before any response, so it
    // never suppressed one. The real anti-flash delay is useDelayedLoading,
    // applied where the spinner is rendered.
    setLoading(true);
    const source = axios.CancelToken.source();

    Promise.all(
      platesToFetch.map((plate) =>
        axios
          .get(`${API_BASE_URL}/api/Files/${folderRef.current}/${plate}`, { cancelToken: source.token })
          .then((res) => ({ plate, data: res.data }))
          .catch(() => null)
      )
    )
      .then((results) => {
        const validResults = results.filter((r): r is { plate: string; data: JsonData } => r !== null);
        if (validResults.length > 0) {
          const newPlateData: Record<string, JsonData> = {};
          const newPlateMapping: Record<string, string> = {};
          validResults.forEach(({ plate, data }) => {
            newPlateData[plate] = data;
            newPlateMapping[data.Position] = plate;
          });
          setPlateData((prev) => ({ ...prev, ...newPlateData }));
          setPlateMapping((prev) => ({ ...prev, ...newPlateMapping }));
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => source.cancel();
  }, [loadedPlates, folder, API_BASE_URL, plateData]);

  const handleFolderSelect = useCallback(
    async (selectedFolder: string) => {
      if (!selectedFolder || selectedFolder === folder) return;

      if (!uid) {
        setPendingFolder(selectedFolder);
        setPendingTier(requiredTierForFolder(selectedFolder));
        setShowLoginOverlay(true);
        return;
      }

      let meta: FolderMetaLike | null = null;
      try {
        const res = await axios.get<FolderMetaLike>(
          `${API_BASE_URL}/api/Files/${selectedFolder}/metadata.json`,
          { timeout: 4000 }
        );
        meta = res.data ?? null;
      } catch {
        // ignore, fallback to filename rules
      }

      const need = requiredTierForFolder(selectedFolder, meta ?? undefined);

      if (!tierLoading) {
        const ok = isTierSufficient(tier ?? "free", need);
        if (!ok) {
          setPendingFolder(selectedFolder);
          setPendingTier(need);
          setShowProModal(true);
          return;
        }
      }

      actuallyOpenFolder(selectedFolder);
    },
    [uid, folder, API_BASE_URL, tier, tierLoading, actuallyOpenFolder]
  );

  const beginUpgrade = useCallback(async () => {
    if (!uid) {
      setShowProModal(false);
      setShowLoginOverlay(true);
      return;
    }
    const targetTier: Tier = pendingTier ?? "pro";
    const priceId = getPriceIdForTier(targetTier);
    if (!priceId) {
      alert(`Missing Stripe price id for: ${TIER_LABEL[targetTier]}. Check your env.`);
      return;
    }
    try {
      setUpsellBusy(true);
      await startSubscriptionCheckout({
        uid,
        priceId,
        successUrl: `${window.location.origin}/success`,
        cancelUrl: `${window.location.origin}/billing`,
        allowPromotionCodes: true,
      });
    } catch (err) {
      console.error("Checkout failed:", err);
      setUpsellBusy(false);
      alert((err as Error).message || "Failed to start checkout.");
    }
  }, [uid, pendingTier]);

  useEffect(() => {
    if (!folder) return;
    axios
      .get(`${API_BASE_URL}/api/Files/${folder}/metadata.json`)
      .then((res) => {
        setMetadata(res.data);
        const ante = res.data.ante;
        const initialBets: Record<string, number> = {};
        if (playerCount === 2) {
          initialBets["BTN"] = 0.5;
          initialBets["BB"] = 1;
        } else {
          initialBets["SB"] = 0.5;
          initialBets["BB"] = 1;
        }
        setPlayerBets(initialBets);
        const blindPot = Object.values(initialBets).reduce((sum, b) => sum + b);
        const totalPot = blindPot + ante;
        setPotSize(totalPot);
        })
      .catch(() => {
        setMetadata({ name: "", ante: 0, icm: [] });
        setPlayerBets({ SB: 0.5, BB: 1 });
        setPotSize(1.5);
        });
  }, [folder, API_BASE_URL, playerCount]);

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      // Postflop mode: clicks on the acting seat's plate navigate the
      // postflop tree; the preflop machinery is bypassed entirely.
      if (pf.view && fileName.endsWith("_postflop.json")) {
        if (fileName === `${pf.view.actorSeat}_postflop.json`) {
          void pf.clickAction(action);
        }
        return;
      }
      handleActionClickImpl(
        {
          API_BASE_URL,
          folder,
          uid,
          isICMSim,
          metadata,
          positionOrder,
          playerCount,
          plateData,
          plateMapping,
          playerBets,
          potSize,
          preflopLine,
          lastRange,
          lastRangePos,
          loadedPlates,
          availableJsonFiles,
          setAlivePlayers,
          setActivePlayer,
          setLoadedPlates,
          setPlayerBets,
          setPotSize,
          setPreflopLine,
          setRandomFillEnabled,
          setLastRange,
          setLastRangePos,
          setPlateMapping,
          lastClickRef,
          setPendingFlopUpload,
        },
        action,
        fileName
      );
    },
    // pf.view and pf.clickAction are the only pf members used; the rule wants
    // the whole pf object, but usePostflopSession returns a fresh object each
    // render, which would defeat this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      API_BASE_URL,
      folder,
      uid,
      isICMSim,
      metadata,
      positionOrder,
      playerCount,
      plateData,
      plateMapping,
      playerBets,
      potSize,
      preflopLine,
      lastRange,
      lastRangePos,
      loadedPlates,
      availableJsonFiles,
      pf.view,
      pf.clickAction,
    ]
  );

  /* Preflop nodes of the session's line, replayed from the sim's plate files:
   * the postflop Line renders them as cards, and their committed-chip totals
   * are what keeps a folded seat's blind off its stack. The ante only matters
   * for % raise replay accuracy; use it when the session's folder is the one
   * whose metadata is loaded. */
  const pfPreflop = usePreflopLineNodes(
    API_BASE_URL,
    pf.view?.manifest.preflop.folder ?? null,
    pf.view?.manifest.preflop.line ?? null,
    pf.view && pf.view.manifest.preflop.folder === folder ? metadata.ante : 0
  );

  // Sync the postflop session into the plate state: the acting seat's plate
  // shows the current node; the other seat shows their latest decision (or
  // the check-response preview at the root). Postflop plates use
  // "{seat}_postflop.json" names, which the preflop fetch effect ignores.
  useEffect(() => {
    const view = pf.view;
    if (!view) return;

    /* Starting stack per seat, in the solve's display money (the folder
     * tokens): big blinds for a sim, the hand's chips for a recorded hand. */
    const startingFor = (seat: string) => view.manifest.stacks_map?.[seat] ?? 0;
    const roleOf = (seat: string): "oop" | "ip" => (seat === view.oopSeat ? "oop" : "ip");
    const scale = view.chipScale;
    const eff = view.manifest.effective_stack_chips;
    const chipScaleArg = view.manifest.chip_scale;

    const updates: Record<string, JsonData> = {};
    const mapping: Record<string, string> = {};
    if (view.actorDoc) {
      const file = `${view.actorSeat}_postflop.json`;
      updates[file] = docToJsonData(view.actorDoc, roleOf(view.actorSeat), view.actorSeat, startingFor(view.actorSeat), eff, chipScaleArg);
      mapping[view.actorSeat] = file;
    }
    if (view.opponentDoc) {
      const file = `${view.opponentSeat}_postflop.json`;
      updates[file] = docToJsonData(view.opponentDoc, roleOf(view.opponentSeat), view.opponentSeat, startingFor(view.opponentSeat), eff, chipScaleArg);
      mapping[view.opponentSeat] = file;
    }

    setPlateData((prev) => ({ ...prev, ...updates }));
    setPlateMapping((prev) => {
      const next = { ...prev, ...mapping };
      if (!view.opponentDoc) delete next[view.opponentSeat];
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const unchanged =
        prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k]);
      return unchanged ? prev : next;
    });

    setAlivePlayers((prev) => {
      const aliveMap: Record<string, boolean> = {};
      Object.keys(prev).forEach((pos) => {
        aliveMap[pos] = pos === view.actorSeat || pos === view.opponentSeat;
      });
      return aliveMap;
    });
    setActivePlayer(view.actorSeat);

    // Money on the table for the current node (chips -> bb). potSplitChips
    // reads it off the node path instead of Pio's running per-player totals,
    // so a bet that got called on the flop or turn ends up in the pot rather
    // than parked in front of both seats for the rest of the hand. While a
    // card picker is open the street's betting is already matched, so the
    // chips are swept in the way a dealer would before dealing the next card.
    const chanceNode = view.picker?.chanceNodeId ?? null;
    const moneyNode = chanceNode ?? view.currentNodeId;
    const streetComplete = chanceNode != null;
    const money = potSplitChips(
      moneyNode,
      view.manifest.pot_chips ?? 0,
      streetComplete
    );
    setPlayerBets({
      [view.oopSeat]: money.oopChips / scale,
      [view.ipSeat]: money.ipChips / scale,
    });
    // What each seat has already paid into the pot - their preflop money plus
    // any street that has been matched - so the seat stacks lose those chips
    // even though they no longer show as bets. The preflop part comes off the
    // manifest for the two seats still in the hand (exact and available
    // immediately); the line replay covers the seats that folded, and boards
    // solved before effective_stack_chips was recorded.
    /* The line-replay fallback is in big blinds, which only matches a sim.
     * A money-denominated solve must never mix it in - a wrong-unit number
     * here looks perfectly plausible on the table. */
    const replayCommitted = view.moneyDenominated ? {} : pfPreflop?.committed ?? {};
    const preflopFor = (seat: string) =>
      view.preflopCommitChips > 0
        ? view.preflopCommitChips / scale
        : replayCommitted[seat] ?? 0;
    setPotCommitted({
      ...replayCommitted,
      [view.oopSeat]:
        preflopFor(view.oopSeat) +
        pooledCommitChips(moneyNode, "oop", 0, streetComplete) / scale,
      [view.ipSeat]:
        preflopFor(view.ipSeat) +
        pooledCommitChips(moneyNode, "ip", 0, streetComplete) / scale,
    });
    // potSize is the inclusive pot (live bets included), matching preflop;
    // actualPot subtracts what's still in front of the players.
    setPotSize((money.potChips + money.oopChips + money.ipChips) / scale);
    // NOTE: beyond the session view this depends only on the line replay.
    // positionOrder is derived from plateMapping, which this effect writes -
    // including it loops.
  }, [pf.view, pfPreflop]);

  /* Put the preflop tree back at the root of the folder that is already open,
   * keeping the plate JSON fetched so far so walking a line again costs no
   * requests. Unlike actuallyOpenFolder this is not a folder change: the sim,
   * its metadata, and the plate cache all stay put. */
  const resetPreflopToRoot = useCallback(() => {
    const freshMapping = getInitialMapping(playerCount);
    const seats = Object.keys(freshMapping);
    setLoadedPlates(defaultPlateNames);
    setPlateMapping(freshMapping);
    setPreflopLine(["Root"]);
    setRandomFillEnabled(false);
    setAlivePlayers(Object.fromEntries(seats.map((pos) => [pos, true])));
    setActivePlayer(seats[(seats.indexOf("BB") + 1) % seats.length]);
    const resetBets: Record<string, number> =
      playerCount === 2 ? { BTN: 0.5, BB: 1 } : { SB: 0.5, BB: 1 };
    setPlayerBets(resetBets);
    setPotCommitted({});
    setSkipTarget(null);
    setPotSize(
      Object.values(resetBets).reduce((s, b) => s + b, 0) + metadata.ante
    );
    lastClickRef.current = null;
  }, [playerCount, defaultPlateNames, metadata.ante]);

  // Leave postflop: close the session and reset the table to a clean root.
  const exitPostflop = useCallback(() => {
    pendingCancelRef.current = true;
    setPostflopPending(null);
    setPreflopReplay(null);
    pf.close();
    setCurrentBoard([]);
    resetPreflopToRoot();
  }, [pf, resetPreflopToRoot]);

  /**
   * Walk the preflop tree from the root until `actions` have been taken,
   * leaving the seat after them to act. The walk runs one action per render
   * (see the replay effect) because each node's plate is fetched as a side
   * effect of the action before it, so it lands on exactly the state a user
   * clicking through would reach.
   *
   * `sourceFolder` guards against replaying a line into a different sim: the
   * caller's line belongs to it, so a mismatch stops at the root instead.
   */
  const replayPreflopLine = useCallback(
    (actions: string[], sourceFolder?: string | null) => {
      const files = preflopNodeFiles(actions);
      resetPreflopToRoot();
      const usable =
        !!files && actions.length > 0 && (sourceFolder ?? folder) === folder;
      setPreflopReplay(
        usable ? { folder, actions, files: files!, step: 0 } : null
      );
    },
    [folder, resetPreflopToRoot]
  );

  /** Rewind the preflop line to just after its first `actionCount` actions,
   *  which puts the seat that acted next back on the spot. */
  const rewindPreflopTo = useCallback(
    (actionCount: number) => {
      replayPreflopLine(preflopLine.slice(1, actionCount + 1));
    },
    [preflopLine, replayPreflopLine]
  );

  /**
   * Leave the board and land back in the preflop tree at preflop node `index`.
   * Clicking the action the line took returns to that decision (the seat is up
   * to act again); any other option is taken instead, branching the line.
   */
  const jumpToPreflopNode = useCallback(
    (index: number, action: string) => {
      const view = pf.view;
      if (!view) return;
      const rawLine = view.manifest.preflop.line ?? [];
      const lineActions = rawLine[0] === "Root" ? rawLine.slice(1) : rawLine;
      if (index < 0 || index >= lineActions.length) return;

      const actions =
        action === lineActions[index]
          ? lineActions.slice(0, index)
          : [...lineActions.slice(0, index), action];

      pendingCancelRef.current = true;
      setPostflopPending(null);
      pf.close();
      setCurrentBoard([]);
      replayPreflopLine(actions, view.manifest.preflop.folder);
    },
    // pf.view / pf.close are the only members used; pf itself is a fresh
    // object every render, which would defeat this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pf.view, pf.close, replayPreflopLine]
  );

  /* Drive a pending preflop replay: apply the next action as soon as its node
   * plate is available. Taking an action queues the fetch for the node after
   * it, so the walk advances a step at a time as the data lands. */
  useEffect(() => {
    if (!preflopReplay) return;
    if (preflopReplay.folder !== folder) return; // a folder switch is settling
    if (preflopReplay.step >= preflopReplay.actions.length) {
      setPreflopReplay(null);
      return;
    }
    // The line must hold exactly the actions replayed so far; anything else
    // means a click landed mid-walk, so drop the replay rather than apply the
    // rest of it to a line that has moved on.
    if (preflopLine.length - 1 !== preflopReplay.step) {
      setPreflopReplay(null);
      return;
    }
    const file = preflopReplay.files[preflopReplay.step];
    // A node the sim does not contain: stop where the walk got to rather than
    // waiting on a plate that will never arrive.
    if (availableJsonFiles.length > 0 && !availableJsonFiles.includes(file)) {
      setPreflopReplay(null);
      return;
    }
    if (!loadedPlates.includes(file) || !plateData[file]) return;
    handleActionClick(preflopReplay.actions[preflopReplay.step], file);
    setPreflopReplay((prev) => (prev ? { ...prev, step: prev.step + 1 } : prev));
  }, [
    preflopReplay,
    folder,
    preflopLine,
    availableJsonFiles,
    loadedPlates,
    plateData,
    handleActionClick,
  ]);

  /* Clicking the empty part of a seat's card in the Line asks to skip ahead to
   * that seat: every seat still to act in front of it gets out of the way -
   * fold if it may, else check, else call - one action per render, so the
   * clicked seat ends up being the one to act with its range on screen. The
   * step budget keeps a node that cannot pass from stalling the walk. */
  const skipToSeat = useCallback((seat: string) => {
    setSkipTarget({ seat, steps: 0 });
  }, []);

  useEffect(() => {
    if (!skipTarget || preflopReplay) return;
    if (skipTarget.seat === activePlayer || skipTarget.steps > actingOrder.length) {
      setSkipTarget(null);
      return;
    }
    const file = plateMapping[activePlayer];
    if (!file) {
      setSkipTarget(null);
      return;
    }
    if (!loadedPlates.includes(file) || !plateData[file]) return; // await the plate
    const action = passiveAction(plateActions(plateData[file]));
    if (!action) {
      setSkipTarget(null); // this seat has no way to pass the action on
      return;
    }
    handleActionClick(action, file);
    setSkipTarget((prev) => (prev ? { ...prev, steps: prev.steps + 1 } : prev));
  }, [
    skipTarget,
    preflopReplay,
    activePlayer,
    actingOrder.length,
    plateMapping,
    loadedPlates,
    plateData,
    handleActionClick,
  ]);

  // Open a previously solved board from the library (tier-gated like folders).
  const openSolvedBoard = useCallback(
    async (entry: PostflopIndexEntry) => {
      setShowLibrary(false);

      if (!uid) {
        setPendingFolder(entry.stacks);
        setPendingTier(requiredTierForFolder(entry.stacks));
        setShowLoginOverlay(true);
        return;
      }
      const meta = folderMetaMap[entry.stacks] ?? undefined;
      const need = requiredTierForFolder(entry.stacks, meta as FolderMetaLike | undefined);
      if (!tierLoading && !isTierSufficient(tier ?? "free", need)) {
        setPendingFolder(entry.stacks);
        setPendingTier(need);
        setShowProModal(true);
        return;
      }

      // Hand-history solves live under a synthetic {stacks} name that is NOT
      // a preflop sim folder - opening it would 404 the sim file fetches
      // ("Error fetching files"). The postflop session is self-contained, so
      // only switch folders when the entry belongs to a real sim.
      if (entry.stacks !== folderRef.current && folders.includes(entry.stacks)) {
        actuallyOpenFolder(entry.stacks);
      }

      const manifest = await fetchBoardManifest(entry.stacks, entry.node_name, entry.board);
      if (!manifest) {
        console.warn("Manifest not found for library entry:", entry);
        return;
      }
      setCurrentBoard(boardToCards(entry.board));
      await pf.open(manifest);
    },
    [uid, folderMetaMap, folders, tier, tierLoading, actuallyOpenFolder, pf]
  );

  /* Deep link: /solutions?open=<stacks|node|board> (minted by solutionOpenUrl,
   * used by the hand-history and bankroll "view solution" buttons) opens that
   * solved board once the index and tier have both settled - waiting on
   * tierLoading keeps openSolvedBoard's tier gate deterministic. The ref
   * guards StrictMode's double effect run; it needs no reset because Solver
   * unmounts on route change. */
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const handledOpenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!POSTFLOP_ENABLED || !openParam) return;
    if (handledOpenRef.current === openParam) return;
    if (pfIndex.loading || tierLoading) return;
    if (pfIndex.signInRequired) {
      // Keep ?open= : sign-in refetches the index and this effect re-runs,
      // so the link resumes instead of being lost at the login prompt.
      setShowLoginOverlay(true);
      return;
    }
    handledOpenRef.current = openParam;
    // replace, not push: Back should return to the referring page, and the
    // consumed param must not re-trigger on history navigation.
    setSearchParams(
      (params) => {
        params.delete("open");
        return params;
      },
      { replace: true }
    );
    const entry = pfIndex.entries.find((e) => solutionKey(e) === openParam);
    if (!entry) {
      // Deleted, hidden, or unknown board: land in the library so the user
      // sees what does exist instead of a silently dead link.
      setShowLibrary(true);
      return;
    }
    void openSolvedBoard(entry);
  }, [
    openParam,
    pfIndex.loading,
    pfIndex.signInRequired,
    pfIndex.entries,
    tierLoading,
    openSolvedBoard,
    setSearchParams,
  ]);

  // Remove boards from this viewer's library. A board that is open right now
  // would otherwise stay on screen after vanishing from the list, so the
  // session is closed first.
  const removeSolvedBoards = useCallback(
    async (targets: PostflopIndexEntry[]) => {
      const open = pf.view?.manifest;
      const stillOpen =
        open &&
        targets.some(
          (t) =>
            t.stacks === open.stacks &&
            t.node_name === open.node_name &&
            t.board === open.board
        );
      if (stillOpen) exitPostflop();
      await hideSolutions(targets);
    },
    [pf.view?.manifest, exitPostflop, hideSolutions]
  );

  useKeyboardShortcuts({
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
    folders,
    currentFolder: folder,
    onFolderSelect: handleFolderSelect,
  });

  const [randomFillEnabled, setRandomFillEnabled] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("singleRangeView", singleRangeView ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [singleRangeView]);

  useEffect(() => {
    saveMatrixHeightMode(matrixHeightMode);
  }, [matrixHeightMode]);

  useEffect(() => {
    saveMatrixDisplayMode(matrixDisplayMode);
  }, [matrixDisplayMode]);

  /* This page budgets its layouts to fit the viewport, so the touch
   * rubber-band only reveals backdrop. */
  useNoOverscroll();

  // Postflop modal side-effects
  useEffect(() => {
    if (!POSTFLOP_ENABLED) return;
    if (pendingFlopUpload && alivePositions.length === 2) {
      setShowFlopModal(true);
    }
  }, [pendingFlopUpload, alivePositions.length]);

  const closeFlopModal = () => {
    setShowFlopModal(false);
    setPendingFlopUpload(null);
  };

  /** Everything the tree-building modal needs to open, prefilled from the
   *  pending preflop-call upload. OOP/IP labels follow POSTFLOP_ORDER, the
   *  same ordering the watcher uses to assign Range0/Range1 to seats. */
  const treeInit = useMemo<TreeBuildingInit | null>(() => {
    if (!pendingFlopUpload || alivePositions.length !== 2) return null;
    const order = POSTFLOP_ORDER as readonly string[];
    const sorted = [...alivePositions].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return {
      params: pendingFlopUpload.params,
      flopCards: [],
      oopLabel: `${sorted[0]} (OOP)`,
      ipLabel: `${sorted[1]} (IP)`,
    };
  }, [pendingFlopUpload, alivePositions]);

  const confirmFlopAndUpload = async ({
    params,
    flopCards,
  }: {
    params: TreeParams;
    flopCards: string[];
  }) => {
    if (!pendingFlopUpload || flopCards.length !== 3) return;
    if (alivePositions.length !== 2) {
      console.warn(
        `confirmFlopAndUpload called with ${alivePositions.length} alive players; expected 2. Aborting.`,
        alivePositions
      );
      return;
    }

    setCurrentBoard([...flopCards]);

    const boardName = flopCards.join("");

    const {
      folder: pfFolder,
      actingPosition,
      preflopLine: pfLine,
      isICMSim: pfICM,
    } = pendingFlopUpload;

    const adjustedText = buildTreeConfigText(params, flopCards);

    try {
      const result = await uploadGameTree({
        folder: pfFolder,
        line: pfLine,
        actingPos: actingPosition ?? "",
        isICM: pfICM,
        text: adjustedText,
        alivePositions,
      });

      console.log("✅ Game tree uploaded:", result);

      const gametreePath = result?.path;
      if (!gametreePath) {
        console.warn("uploadGameTree response did not include a 'path' field; cannot derive piosolutions path.");
        return;
      }

      const { stacks, nodeName } = parseGametreePathForSolution(gametreePath);
      if (!stacks || !nodeName) {
        console.warn("Could not derive stacks/node from gametree path:", gametreePath);
        return;
      }

      const jobId = result.jobId;
      if (!jobId) {
        console.warn("uploadGameTree response did not include a jobId; cannot track the solve.");
        return;
      }

      // Track the solve job (~2s cadence): stage + queue position on the
      // pending card, and open the board on the earliest manifest - the
      // watcher publishes the flop before the turn sweep, so that is usually
      // well before the job reports Done.
      pendingCancelRef.current = false;
      setPostflopPending({ board: [...flopCards], startedAt: Date.now() });
      void (async () => {
        let opened = false;
        let opening = false;

        const tryOpen = async (): Promise<boolean> => {
          const manifest = await fetchBoardManifest(stacks, nodeName, boardName);
          if (!manifest || opened) return opened;
          if (pendingCancelRef.current) return true; // user left; stop quietly
          opened = true;
          setPostflopPending(null);
          await pf.open(manifest);
          void pfIndex.refresh();
          return true;
        };

        // A deduped submission may point at a solve that already published.
        if (result.deduped && (await tryOpen())) return;

        const job = await pollSolveJob(jobId, {
          shouldStop: () => pendingCancelRef.current || opened,
          onUpdate: (dto) => {
            setPostflopPending((prev) =>
              prev
                ? {
                    ...prev,
                    status: dto.status,
                    queuePosition: dto.queuePosition,
                    error: dto.error,
                  }
                : prev
            );
            // Flop-first publish: try the manifest as soon as extraction starts.
            if (
              !opened &&
              !opening &&
              (dto.status === "Extracting" || dto.status === "Uploading" || dto.status === "Done")
            ) {
              opening = true;
              void tryOpen()
                .catch((err) => console.warn("Failed to open board manifest:", err))
                .finally(() => {
                  opening = false;
                });
            }
          },
        });
        if (opened || pendingCancelRef.current) return;

        if (job?.status === "Done") {
          // Manifest should exist by now; retry briefly for blob consistency.
          for (let i = 0; i < 3; i++) {
            if (await tryOpen()) return;
            await new Promise((r) => setTimeout(r, 2000));
          }
          setPostflopPending((prev) =>
            prev
              ? {
                  ...prev,
                  status: "Failed",
                  error: "Solve finished but the solution has not appeared yet - check the Solution Library shortly.",
                }
              : prev
          );
        } else if (job?.status === "Failed") {
          setPostflopPending((prev) =>
            prev ? { ...prev, status: "Failed", error: job.error ?? "Solve failed" } : prev
          );
        } else {
          // Poll window exhausted with no verdict.
          setPostflopPending(null);
        }
      })();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.warn("⚠️ Failed to upload game tree:", err?.message ?? err);
      if (String(err?.message ?? "").includes("signed in")) {
        setShowLoginOverlay(true);
      }
    } finally {
      closeFlopModal();
    }
  };

  // Boards already solved for the exact line being requested (skip re-solving)
  const solvedForPendingLine = useMemo(
    () =>
      pendingFlopUpload
        ? pfIndex.entriesForLine(pendingFlopUpload.folder, pendingFlopUpload.preflopLine)
        : [],
    [pendingFlopUpload, pfIndex]
  );

  /* Per-combo detail belongs to the seat that acts at the current postflop
   * node, so it only applies while that seat's range is the one on screen -
   * viewing the opponent's plate falls back to hand-class averages. */
  const activeComboDetail =
    pf.view && activePlayer === pf.view.actorSeat ? pf.view.actorCombos : null;

  /* Hand-history solves know what each player actually held, so the study view
   * opens on that hand instead of an empty breakdown: the class for the matrix
   * cell, and the exact combo so the breakdown can point at KsKd rather than
   * all six of KK. Keyed by seat, because OOP and IP held different hands and
   * a single pin would follow the user across the range toggle.
   *
   * Only seats with two known cards get an entry - a villain who never showed
   * has none, and the fixture case of an empty `cards` array is real. */
  const autoPinBySeat = useMemo<Record<string, { hand: string; combo: string }>>(() => {
    const meta = pf.view?.seatMeta;
    if (!meta?.length) return {};
    const out: Record<string, { hand: string; combo: string }> = {};
    for (const seat of meta) {
      const cards = (seat.cards ?? []).filter(Boolean);
      if (cards.length !== 2) continue;
      out[seat.pos] = {
        hand: handClassOf(cards[0], cards[1]),
        combo: comboKey(cards[0], cards[1]),
      };
    }
    return out;
  }, [pf.view?.seatMeta]);

  /* Chips/bb display for money-denominated solves, defaulting to the hand's
   * own chips. A sim has no chip scale, so it gets no MoneyDisplay at all and
   * every label falls back to its plain "bb". The bb option needs the hand's
   * big blind, which only a recorded hand carries. */
  const [pfMoneyMode, setPfMoneyMode] = useState<"money" | "bb">("money");
  const pfManifest = pf.view?.manifest;
  useEffect(() => {
    setPfMoneyMode("money");
  }, [pfManifest]);
  const pfHandBB = pf.view?.handBB ?? null;
  const pfMoneyDenominated = pf.view?.moneyDenominated ?? false;
  const pfMoney = useMemo<MoneyDisplay | undefined>(
    () =>
      pfMoneyDenominated
        ? {
            mode: pfHandBB && pfHandBB > 0 ? pfMoneyMode : "money",
            bbSize: pfHandBB ?? 0,
            onToggle: () => setPfMoneyMode((m) => (m === "money" ? "bb" : "money")),
          }
        : undefined,
    [pfMoneyDenominated, pfHandBB, pfMoneyMode]
  );

  /* Hand-history solves carry the full table (seat_meta): render every player
   * from the hand - real names, stacks, folded state, and known hole cards -
   * instead of the sim-derived seats. */
  const hhTableSeats = useMemo<PokerTableSeat[] | undefined>(() => {
    const view = pf.view;
    if (!view?.seatMeta?.length) return undefined;
    const scale = view.chipScale;
    return view.seatMeta.map((s) => {
      const live = s.pos === view.oopSeat || s.pos === view.ipSeat;
      const seatMoney = s.stack_chips != null ? s.stack_chips / scale : null;
      const behind = live ? view.liveStacksMoney[s.pos] ?? seatMoney : seatMoney;
      const bet = live ? playerBets[s.pos] ?? 0 : 0;
      return {
        key: s.pos,
        label: s.name && s.name !== s.pos ? s.name : s.pos,
        stackText: behind != null ? fmtMoney(behind, pfMoney) : undefined,
        committedAmount: bet > 0 ? bet : undefined,
        committedText: bet > 0 ? fmtMoney(bet, pfMoney) : undefined,
        holeCards: s.cards?.length ? s.cards : live ? [null, null] : undefined,
        isButton: s.pos === "BTN",
        isActive: live && s.pos === activePlayer,
        isHero: s.hero,
        folded: s.folded,
      };
    });
  }, [pf.view, pfMoney, playerBets, activePlayer]);

  /* Per-hand-class reach for each postflop plate, keyed the same way the
   * plate-sync effect names the files. Undefined outside a postflop session,
   * which the matrix renders as full-height cells (preflop has no weights). */
  const reachByFile = useMemo<
    Record<string, Map<string, number> | null> | undefined
  >(
    () =>
      pf.view
        ? {
            [`${pf.view.actorSeat}_postflop.json`]: pf.view.actorClassReach,
            [`${pf.view.opponentSeat}_postflop.json`]:
              pf.view.opponentClassReach,
          }
        : undefined,
    [pf.view]
  );

  /* The line strip beside the sim panel in StudyTopStrip - the one header
   * every layout shares. It fills its flex cell and stretches to the panel's
   * height. */
  const lineNode = pf.view ? (
    <PostflopLine
      preflopLine={pf.view.manifest.preflop.line}
      preflopNodes={pfPreflop?.nodes ?? null}
      board={pf.view.board}
      potMoney={pf.view.manifest.pot_chips != null ? pf.view.manifest.pot_chips / pf.view.chipScale : null}
      money={pfMoney}
      lineNodes={pf.view.lineNodes}
      notice={pf.view.notice}
      onJump={pf.jumpTo}
      onPickAction={(parentId, display) => void pf.pickActionAt(parentId, display)}
      onPreflopJump={jumpToPreflopNode}
      onExit={exitPostflop}
      handSolve={!!pf.view.seatMeta?.length}
      actorSeat={pf.view.actorSeat}
      actorStackMoney={pf.view.actorStackMoney}
      actions={pf.view.actions}
      onActionClick={(display) => void pf.clickAction(display)}
      actionsDisabled={!!pf.view.pendingStreet}
      fillHeight
    />
  ) : (
    <Line
      line={preflopLine}
      positions={actingOrder}
      activePlayer={activePlayer}
      plateData={plateData}
      plateMapping={plateMapping}
      playerBets={playerBets}
      alivePlayers={alivePlayers}
      onActionClick={handleActionClick}
      onSkipToSeat={skipToSeat}
      onRewindTo={rewindPreflopTo}
      fillHeight
    />
  );

  const libraryButton = POSTFLOP_ENABLED ? (
    <SolutionLibraryButton
      count={pfIndex.entries.length}
      onClick={() => setShowLibrary(true)}
    />
  ) : null;

  return (
    <>
      <Steps enabled={tourRun} steps={tourSteps} initialStep={0} onExit={() => setTourRun(false)} />

      {/* TREE BUILDING MODAL */}
      {POSTFLOP_ENABLED && showFlopModal && treeInit && (
        <TreeBuildingModal
          init={treeInit}
          solvedForLine={solvedForPendingLine}
          busy={false}
          onClose={closeFlopModal}
          onConfirm={(result) => void confirmFlopAndUpload(result)}
          onOpenSolvedBoard={(entry) => {
            closeFlopModal();
            void openSolvedBoard(entry);
          }}
        />
      )}

      {/* SOLUTION LIBRARY MODAL */}
      {POSTFLOP_ENABLED && showLibrary && (
        <PostflopLibrary
          entries={pfIndex.entries}
          loading={pfIndex.loading}
          signInRequired={pfIndex.signInRequired}
          onSignIn={() => {
            setShowLibrary(false);
            setShowLoginOverlay(true);
          }}
          onOpen={(entry) => void openSolvedBoard(entry)}
          onClose={() => setShowLibrary(false)}
          onRemove={removeSolvedBoards}
          onRestore={pfIndex.unhide}
          handTextById={handTexts.byId}
        />
      )}

      {/* TURN / RIVER CARD PICKER */}
      {pf.view?.picker && (
        <PostflopCardPicker
          picker={pf.view.picker}
          usedCards={pf.view.usedCards}
          extractedCards={pf.view.extractedCards}
          pendingStreet={pf.view.pendingStreet}
          onPick={(card) => void pf.pickCard(card)}
          onClose={pf.closePicker}
          onCancelPending={pf.cancelPending}
        />
      )}

      <div className="h-auto flex flex-col">
        <div className="pt-1 p-1 flex-grow">
          {(folderError || filesError) && <div className="text-red-500">{folderError || filesError}</div>}

          {/* One top strip for every layout, desktop and mobile alike: the
              compact sim panel with the line strip stretched beside it. */}
          <StudyTopStrip
            folders={folders}
            currentFolder={folder}
            onFolderSelect={handleFolderSelect}
            metaByFolder={folderMetaMap}
            userTier={tier ?? "free"}
            simName={metadata.name}
            playerCount={playerCount}
            avgStack={avgStack}
            ante={metadata.ante}
            icm={metadata.icm}
            line={lineNode}
            libraryButton={libraryButton}
            lineWrapperRef={lineWrapperRef}
            singleRangeView={singleRangeView}
            onToggleSingleRange={() => setSingleRangeView((v) => !v)}
          />

          {/* The single-range layouts render the cell-height pill in their own
              control rows above the matrix; the multi-range layouts have no
              such row, so it lives here instead. (The single-range toggle is
              not layout-dependent - it rides in the sim panel above.) */}
          {!singleRangeView && (
            <div className="px-2 sm:px-4 mt-2">
              <div className="mx-auto flex w-full max-w-[1800px] items-center justify-end gap-1.5">
                <MatrixHeightModePill
                  heightMode={matrixHeightMode}
                  onChange={setMatrixHeightMode}
                  compact
                />
              </div>
            </div>
          )}

          {/* Pending solve banner */}
          {postflopPending && (
            <PendingSolveCard
              board={postflopPending.board}
              startedAt={postflopPending.startedAt}
              status={postflopPending.status}
              queuePosition={postflopPending.queuePosition}
              error={postflopPending.error}
              onDismiss={() => {
                pendingCancelRef.current = true;
                setPostflopPending(null);
              }}
            />
          )}

          {/* Current flop display (outside a session, e.g. legacy state) */}
          {!pf.view && !postflopPending && !boardOnTable && currentBoard.length > 0 && (
            <div className="flex justify-center mb-2 px-2">
              <div className="inline-flex items-center gap-2 rounded-md bg-slate-900/80 border border-emerald-500/40 px-3 py-1.5 shadow-sm">
                <span className="text-[11px] font-semibold tracking-wide text-emerald-300">
                  Board:
                </span>
                {currentBoard.map((code) => (
                  <PlayingCard
                    key={code}
                    code={code}
                    width="clamp(28px, 6vw, 44px)"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Active view (one of the four layouts - see useSolverLayout) */}
          <div className="relative z-0">
            {mode === "single-desktop" ? (
              <SingleRangeDesktopView
                files={displayPlates}
                positions={positionOrder}
                plateData={plateData}
                loading={loading}
                alivePlayers={alivePlayers}
                playerBets={playerBets}
                potCommitted={potCommitted}
                activePlayer={activePlayer}
                pot={potSize}
                actualPot={actualPot}
                isICMSim={isICMSim}
                randomFillEnabled={randomFillEnabled}
                heightMode={matrixHeightMode}
                onHeightModeChange={setMatrixHeightMode}
                displayMode={matrixDisplayMode}
                onDisplayModeChange={setMatrixDisplayMode}
                reachByFile={reachByFile}
                onActionClick={handleActionClick}
                windowWidth={windowWidth}
                windowHeight={windowHeight}
                board={pf.view ? pf.view.board : currentBoard}
                comboDetail={activeComboDetail}
                nodeStats={pf.view?.nodeStats ?? null}
                chipScale={pf.view?.chipScale}
                actorSeat={pf.view?.actorSeat}
                seatNames={pf.view?.seatNames}
                tableSeatsOverride={hhTableSeats}
                money={pfMoney}
                autoPinBySeat={autoPinBySeat}
              />
            ) : mode === "single-mobile" ? (
              <SingleRangeMobileView
                files={displayPlates}
                positions={positionOrder}
                plateData={plateData}
                loading={loading}
                alivePlayers={alivePlayers}
                playerBets={playerBets}
                potCommitted={potCommitted}
                activePlayer={activePlayer}
                pot={potSize}
                actualPot={actualPot}
                isICMSim={isICMSim}
                randomFillEnabled={randomFillEnabled}
                heightMode={matrixHeightMode}
                onHeightModeChange={setMatrixHeightMode}
                displayMode={matrixDisplayMode}
                onDisplayModeChange={setMatrixDisplayMode}
                reachByFile={reachByFile}
                onActionClick={handleActionClick}
                windowWidth={windowWidth}
                windowHeight={windowHeight}
                board={pf.view ? pf.view.board : currentBoard}
                comboDetail={activeComboDetail}
                nodeStats={pf.view?.nodeStats ?? null}
                chipScale={pf.view?.chipScale}
                actorSeat={pf.view?.actorSeat}
                seatNames={pf.view?.seatNames}
                tableSeatsOverride={hhTableSeats}
                money={pfMoney}
                autoPinBySeat={autoPinBySeat}
              />
            ) : mode === "multi-desktop" ? (
              <MultiRangeDesktopView
                files={displayPlates}
                positions={positionOrder}
                plateData={plateData}
                loading={loading}
                alivePlayers={alivePlayers}
                playerBets={playerBets}
                potCommitted={potCommitted}
                activePlayer={activePlayer}
                pot={potSize}
                actualPot={actualPot}
                isICMSim={isICMSim}
                randomFillEnabled={randomFillEnabled}
                heightMode={matrixHeightMode}
                reachByFile={reachByFile}
                onActionClick={handleActionClick}
                windowWidth={windowWidth}
                windowHeight={windowHeight}
                money={pfMoney}
              />
            ) : (
              <MultiRangeMobileView
                files={displayPlates}
                positions={positionOrder}
                plateData={plateData}
                loading={loading}
                alivePlayers={alivePlayers}
                playerBets={playerBets}
                potCommitted={potCommitted}
                activePlayer={activePlayer}
                pot={potSize}
                actualPot={actualPot}
                isICMSim={isICMSim}
                randomFillEnabled={randomFillEnabled}
                heightMode={matrixHeightMode}
                reachByFile={reachByFile}
                onActionClick={handleActionClick}
                windowWidth={windowWidth}
                windowHeight={windowHeight}
                money={pfMoney}
              />
            )}
          </div>
        </div>

      </div>

      <LoginSignupModal
        open={showLoginOverlay}
        onClose={() => {
          setShowLoginOverlay(false);
        }}
      />
      {showProModal && (
        <ProUpsell
          open={showProModal && !tierLoading}
          onClose={() => {
            setShowProModal(false);
            setUpsellBusy(false);
          }}
          onConfirm={async () => {
            if (upsellBusy) return;
            await beginUpgrade();
          }}
          busy={upsellBusy}
        />
      )}
    </>
  );
};

export default Solver;
