// src/components/Solver.tsx
import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import type { ChangeEvent } from "react";
import PlateGrid from "./PlateGrid";
import { actionToNumberMap } from "@/lib/solver/constants";
import { getInitialMapping } from "@/lib/solver/getInitialMapping";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import useSolverLayout from "./useSolverLayout";
import useFolders from "@/hooks/useFolders";
import useFiles from "@/hooks/useFiles";
import axios from "axios";
import { JsonData } from "@/lib/solver/utils";
import Line from "./Line";
import { Steps } from "intro.js-react";
import "intro.js/introjs.css";
import { User } from "firebase/auth";
import LoginSignupModal from "@/components/LoginSignupModal";
import StudyTopStrip from "./header/StudyTopStrip";
import ClassicHeader from "./header/ClassicHeader";
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
import FlopPickerModal from "./FlopPickerModal";
import { handleActionClickImpl, type PendingFlopUpload } from "@/lib/solver/handleActionClick";
import { parseGametreePathForSolution } from "@/lib/solver/postflopClient";
import {
  fetchBoardManifest,
  pollForBoardManifest,
  type PostflopIndexEntry,
} from "@/lib/solver/postflopLibrary";
import { boardToCards, docToJsonData } from "@/lib/solver/postflopNode";
import { usePostflopSession } from "@/hooks/usePostflopSession";
import usePostflopIndex from "@/hooks/usePostflopIndex";
import PostflopLine from "./PostflopLine";
import { usePreflopLineNodes } from "./usePreflopLineNodes";
import PostflopLibrary from "./PostflopLibrary";
import PostflopCardPicker from "./PostflopCardPicker";
import { Library } from "lucide-react";

// Toggle experimental postflop pipeline (upload + polling).
// Off unless VITE_POSTFLOP_ENABLED=true (frontend/.env locally; Vercel env var in prod).
const POSTFLOP_ENABLED = import.meta.env.VITE_POSTFLOP_ENABLED === "true";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = ["h", "d", "c", "s"] as const;
const ALL_CARDS: string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

function parseFlopInputString(raw: string): { cards: string[]; error: string | null } {
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, "").trim();
  if (!stripped) return { cards: [], error: null };

  const upper = stripped.toUpperCase();

  if (upper.length > 6) {
    return {
      cards: [],
      error: 'Please enter at most 3 cards, e.g. "AhKd9c" or "Ah Kd 9c".',
    };
  }

  if (upper.length % 2 !== 0) {
    return {
      cards: [],
      error: 'Finish the card you\'re typing, e.g. "9c".',
    };
  }

  const parsed: string[] = [];

  for (let i = 0; i < upper.length; i += 2) {
    const rank = upper[i];
    const suitChar = upper[i + 1];

    if (!RANKS.includes(rank as (typeof RANKS)[number])) {
      return {
        cards: [],
        error: `Unknown rank "${rank}". Use A,K,Q,J,T,9..2.`,
      };
    }

    const suitLower = suitChar.toLowerCase();
    if (!SUITS.includes(suitLower as (typeof SUITS)[number])) {
      return {
        cards: [],
        error: `Unknown suit "${suitChar}". Use h,d,c,s.`,
      };
    }

    const code = `${rank}${suitLower}`;
    if (parsed.includes(code)) {
      return {
        cards: [],
        error: "Cards must be unique.",
      };
    }

    parsed.push(code);
  }

  return { cards: parsed, error: null };
}

const tourSteps = [
  { element: '[data-intro-target="folder-selector"]', intro: "Choose a pre-flop sim here.", position: "bottom" },
  { element: '[data-intro-target="color-key-btn"]', intro: "Toggle single-range view here.", position: "bottom" },
];

/** Pending banner shown while the local solver works on a fresh flop request. */
const PendingSolveCard = ({ board, startedAt }: { board: string[]; startedAt: number }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex justify-center mb-2 px-2">
      <div className="inline-flex items-center gap-2 rounded-md bg-slate-900/80 border border-amber-400/50 px-3 py-1.5 shadow-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[11px] font-semibold tracking-wide text-amber-200">
          Solving flop
        </span>
        {board.map((code) => (
          <PlayingCard key={code} code={code} width="clamp(24px, 5vw, 36px)" />
        ))}
        <span className="text-[11px] tabular-nums text-gray-300">
          {mm}:{ss} elapsed · usually 2-10 min
        </span>
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
  const [loading, setLoading] = useState<boolean>(false);
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
  const [flopCards, setFlopCards] = useState<string[]>([]);
  const [flopInput, setFlopInput] = useState<string>("");
  const [flopInputError, setFlopInputError] = useState<string | null>(null);

  const [currentBoard, setCurrentBoard] = useState<string[]>([]);

  // Postflop session (navigation) + solutions library
  const pf = usePostflopSession();
  const pfIndex = usePostflopIndex(Boolean(uid));
  const [showLibrary, setShowLibrary] = useState(false);
  const [postflopPending, setPostflopPending] = useState<{
    board: string[];
    startedAt: number;
  } | null>(null);
  const pendingCancelRef = useRef(false);

  // Single-range view toggle (persisted)
  const [singleRangeView, setSingleRangeView] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("singleRangeView");
      return raw === null ? true : raw === "1"; // default ON, respect saved "0"
    } catch {
      return true;
    }
  });

  // Sim info popover open state (for click on mobile)
  const [simInfoOpen, setSimInfoOpen] = useState(false);

  // Line ↔ PlateGrid alignment
  const [plateContentEl, setPlateContentEl] = useState<HTMLDivElement | null>(null);
  const lineWrapperRef = useRef<HTMLDivElement | null>(null);
  const [plateContentWidth, setPlateContentWidth] = useState(0);

  const tourBooted = useRef(localStorage.getItem("tourSeen") === "1");
  const lastClickRef = useRef<{ plate: string; action: string } | null>(null);

  const alivePositions = useMemo(
    () =>
      Object.entries(alivePlayers)
        .filter(([, alive]) => alive)
        .map(([pos]) => pos),
    [alivePlayers]
  );
  const canConfirmFlop = flopCards.length === 3 && alivePositions.length === 2;

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
  // Desktop single-range "study" layout: compact SimSelect box + Line strip
  // on top, matrix beside a table/summary/breakdown column below.
  const desktopStudy = mode === "single-desktop";

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
      const newPlayerCount = selectedFolder.split("_").length;
      const freshPlates = defaultPlateNames;
      const freshMapping = getInitialMapping(newPlayerCount);
      setLoadedPlates(freshPlates);
      setPlateMapping(freshMapping);
      setPlateData({});
      setFolder(selectedFolder);
      setPreflopLine(["Root"]);
      setRandomFillEnabled(false);
      const initialAlive: Record<string, boolean> = {};
      Object.keys(freshMapping).forEach((pos) => (initialAlive[pos] = true));
      setAlivePlayers(initialAlive);
      const bbIdx = Object.keys(freshMapping).indexOf("BB");
      const nextIdx = (bbIdx + 1) % Object.keys(freshMapping).length;
      setActivePlayer(Object.keys(freshMapping)[nextIdx]);
      setSimInfoOpen(false);
    },
    [defaultPlateNames]
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

  useLayoutEffect(() => {
    const compute = () => {
      const plateEl = plateContentEl;
      if (!plateEl) { setPlateContentWidth(0); return; }
      setPlateContentWidth(plateEl.getBoundingClientRect().width);
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (plateContentEl) ro.observe(plateContentEl);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [plateContentEl]);

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
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      setLoading(true);
    }, 0);
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
        clearTimeout(timer);
        if (didTimeout) setLoading(false);
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
        setSimInfoOpen(false);
      })
      .catch(() => {
        setMetadata({ name: "", ante: 0, icm: [] });
        setPlayerBets({ SB: 0.5, BB: 1 });
        setPotSize(1.5);
        setSimInfoOpen(false);
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

  // Sync the postflop session into the plate state: the acting seat's plate
  // shows the current node; the other seat shows their latest decision (or
  // the check-response preview at the root). Postflop plates use
  // "{seat}_postflop.json" names, which the preflop fetch effect ignores.
  useEffect(() => {
    const view = pf.view;
    if (!view) return;

    const bbFor = (seat: string) => view.manifest.stacks_map?.[seat] ?? 0;
    const roleOf = (seat: string): "oop" | "ip" => (seat === view.oopSeat ? "oop" : "ip");

    const updates: Record<string, JsonData> = {};
    const mapping: Record<string, string> = {};
    if (view.actorDoc) {
      const file = `${view.actorSeat}_postflop.json`;
      updates[file] = docToJsonData(view.actorDoc, roleOf(view.actorSeat), view.actorSeat, bbFor(view.actorSeat), view.manifest.effective_stack_chips);
      mapping[view.actorSeat] = file;
    }
    if (view.opponentDoc) {
      const file = `${view.opponentSeat}_postflop.json`;
      updates[file] = docToJsonData(view.opponentDoc, roleOf(view.opponentSeat), view.opponentSeat, bbFor(view.opponentSeat), view.manifest.effective_stack_chips);
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

    // Bets/pot from the current node (chips -> bb) keeps the table animating.
    const pot = view.actorDoc?.pot;
    if (Array.isArray(pot) && pot.length >= 3) {
      setPlayerBets({
        [view.oopSeat]: (pot[0] ?? 0) / 100,
        [view.ipSeat]: (pot[1] ?? 0) / 100,
      });
      setPotSize((pot[2] ?? 0) / 100);
    }
    // NOTE: deliberately depends only on pf.view. positionOrder is derived
    // from plateMapping, which this effect writes - including it loops.
  }, [pf.view]);

  // Leave postflop: close the session and reset the table to a clean root.
  const exitPostflop = useCallback(() => {
    pendingCancelRef.current = true;
    setPostflopPending(null);
    pf.close();
    setCurrentBoard([]);
    actuallyOpenFolder(folderRef.current);
    // Same-folder reopen skips the metadata effect, so reset blinds/pot here.
    const resetBets: Record<string, number> =
      playerCount === 2 ? { BTN: 0.5, BB: 1 } : { SB: 0.5, BB: 1 };
    setPlayerBets(resetBets);
    setPotSize(Object.values(resetBets).reduce((s, b) => s + b, 0) + metadata.ante);
  }, [pf, actuallyOpenFolder, playerCount, metadata.ante]);

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

      if (entry.stacks !== folderRef.current) {
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
    [uid, folderMetaMap, tier, tierLoading, actuallyOpenFolder, pf]
  );

  const handleLineClick = useCallback(
    (clickedIndex: number) => {
      const trimmedLine = preflopLine.slice(0, clickedIndex + 1);
      setPreflopLine(trimmedLine);
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

      if (clickedIndex === 0 || clickedIndex === 1 || trimmedLine[clickedIndex] === "Fold") {
        setAlivePlayers(initialAlive);
        lastClickRef.current = null;
        const bbIdx = positions.indexOf("BB");
        const defaultIdx = (bbIdx + 1) % positions.length;
        setActivePlayer(positions[defaultIdx]);
        const resetBets: Record<string, number> = {};
        if (playerCount === 2) {
          resetBets["BTN"] = 0.5;
          resetBets["BB"] = 1;
        } else {
          resetBets["SB"] = 0.5;
          resetBets["BB"] = 1;
        }
        const ante = metadata.ante;
        const pot = Object.values(resetBets).reduce((sum, b) => sum + b, 0) + ante;

        setPlayerBets(resetBets);
        setPotSize(pot);
        if (playerCount === 8) {
          setPlateMapping({
            UTG: "root.json",
            UTG1: "0.json",
            LJ: "0.0.json",
            HJ: "0.0.0.json",
            CO: "0.0.0.0.json",
            BTN: "0.0.0.0.0.json",
            SB: "0.0.0.0.0.0.json",
            BB: "0.0.0.0.0.0.1.json",
          });
        } else if (playerCount === 7) {
          setPlateMapping({
            UTG1: "root.json",
            LJ: "0.json",
            HJ: "0.0.json",
            CO: "0.0.0.json",
            BTN: "0.0.0.0.json",
            SB: "0.0.0.0.0.json",
            BB: "0.0.0.0.0.1.json",
          });
        } else if (playerCount === 6) {
          setPlateMapping({
            LJ: "root.json",
            HJ: "0.json",
            CO: "0.0.json",
            BTN: "0.0.0.json",
            SB: "0.0.0.0.json",
            BB: "0.0.0.0.1.json",
          });
        } else if (playerCount === 5) {
          setPlateMapping({
            HJ: "root.json",
            CO: "0.json",
            BTN: "0.0.json",
            SB: "0.0.0.json",
            BB: "0.0.0.1.json",
          });
        } else if (playerCount === 4) {
          setPlateMapping({
            CO: "root.json",
            BTN: "0.json",
            SB: "0.0.json",
            BB: "0.0.1.json",
          });
        } else if (playerCount === 3) {
          setPlateMapping({
            BTN: "root.json",
            SB: "0.json",
            BB: "0.1.json",
          });
        } else if (playerCount === 2) {
          setPlateMapping({
            BTN: "root.json",
            BB: "1.json",
          });
        }
      } else {
        const fileNamePart = trimmedLine
          .slice(1, clickedIndex)
          .map((action) => actionToNumberMap[action])
          .join(".");
        const computedFileName = fileNamePart + ".json";

        handleActionClick(trimmedLine[clickedIndex], computedFileName);

        setPlateMapping((prev) => ({
          ...prev,
          [plateData[computedFileName].Position]: computedFileName,
        }));
      }

      setRandomFillEnabled(false);
    },
    [preflopLine, playerCount, plateMapping, metadata.ante, handleActionClick, plateData]
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

  // Postflop modal side-effects
  useEffect(() => {
    if (!POSTFLOP_ENABLED) return;
    if (pendingFlopUpload && alivePositions.length === 2) {
      setFlopCards([]);
      setFlopInput("");
      setFlopInputError(null);
      setShowFlopModal(true);
    }
  }, [pendingFlopUpload, alivePositions.length]);

  useEffect(() => {
    if (!showFlopModal) return;
    if (flopCards.length === 0) {
      setFlopInput("");
    } else {
      setFlopInput(flopCards.join(" "));
    }
  }, [flopCards, showFlopModal]);

  const closeFlopModal = () => {
    setShowFlopModal(false);
    setPendingFlopUpload(null);
    setFlopCards([]);
    setFlopInput("");
    setFlopInputError(null);
  };

  const onPickFlopCard = (code: string) => {
    setFlopCards((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= 3) return prev;
      return [...prev, code];
    });
  };

  const handleFlopInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFlopInput(value);
    const { cards, error } = parseFlopInputString(value);
    setFlopInputError(error);
    if (!error) setFlopCards(cards);
  };

  const randomizeFlop = useCallback(() => {
    const deck = [...ALL_CARDS];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const next = deck.slice(0, 3);
    setFlopCards(next);
    setFlopInputError(null);
  }, []);

  const confirmFlopAndUpload = async () => {
    if (!pendingFlopUpload || flopCards.length !== 3) return;
    if (alivePositions.length !== 2) {
      console.warn(
        `confirmFlopAndUpload called with ${alivePositions.length} alive players; expected 2. Aborting.`,
        alivePositions
      );
      return;
    }

    setCurrentBoard([...flopCards]);

    const boardStr = flopCards.join(" ");
    const boardName = flopCards.join("");

    const {
      folder: pfFolder,
      actingPosition,
      preflopLine: pfLine,
      isICMSim: pfICM,
      linesBeforeBoard,
      linesAfterBoard,
    } = pendingFlopUpload;

    const allLines = [...linesBeforeBoard, `#Board#${boardStr}`, ...linesAfterBoard];
    const adjustedText = allLines.join("\n");

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

      const gametreePath = result?.path as string | undefined;
      if (!gametreePath) {
        console.warn("uploadGameTree response did not include a 'path' field; cannot derive piosolutions path.");
        return;
      }

      const { stacks, nodeName } = parseGametreePathForSolution(gametreePath);
      if (!stacks || !nodeName) {
        console.warn("Could not derive stacks/node from gametree path:", gametreePath);
        return;
      }

      // Poll for the board manifest (solve takes minutes), then open the session.
      pendingCancelRef.current = false;
      setPostflopPending({ board: [...flopCards], startedAt: Date.now() });
      void (async () => {
        const manifest = await pollForBoardManifest(stacks, nodeName, boardName, {
          shouldStop: () => pendingCancelRef.current,
        });
        setPostflopPending(null);
        if (!manifest) return;
        await pf.open(manifest);
        void pfIndex.refresh();
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

  const usedSetForFlop = useMemo(() => new Set<string>(flopCards), [flopCards]);

  // Boards already solved for the exact line being requested (skip re-solving)
  const solvedForPendingLine = useMemo(
    () =>
      pendingFlopUpload
        ? pfIndex.entriesForLine(pendingFlopUpload.folder, pendingFlopUpload.preflopLine)
        : [],
    [pendingFlopUpload, pfIndex]
  );

  /* Preflop node cards for the postflop Line (GTO Wizard style). The ante
   * only matters for % raise replay accuracy; use it when the session's
   * folder is the one whose metadata is loaded. */
  const pfPreflopNodes = usePreflopLineNodes(
    API_BASE_URL,
    pf.view?.manifest.preflop.folder ?? null,
    pf.view?.manifest.preflop.line ?? null,
    pf.view && pf.view.manifest.preflop.folder === folder ? metadata.ante : 0
  );

  /* Shared between the classic header layout and the desktop study strip. In
   * the study strip the Line fills its flex cell, so no measured matchWidth. */
  const lineNode = pf.view ? (
    <PostflopLine
      preflopLine={pf.view.manifest.preflop.line}
      preflopNodes={pfPreflopNodes}
      board={pf.view.board}
      potBB={pf.view.manifest.pot_chips != null ? pf.view.manifest.pot_chips / 100 : null}
      lineNodes={pf.view.lineNodes}
      notice={pf.view.notice}
      onJump={pf.jumpTo}
      onPickAction={(parentId, display) => void pf.pickActionAt(parentId, display)}
      onExit={exitPostflop}
      actorSeat={pf.view.actorSeat}
      actorStackBB={pf.view.manifest.stacks_map?.[pf.view.actorSeat] ?? null}
      actions={pf.view.actions}
      onActionClick={(display) => void pf.clickAction(display)}
      actionsDisabled={!!pf.view.pendingStreet}
      matchWidth={
        desktopStudy ? undefined : windowWidth >= 1024 ? plateContentWidth : undefined
      }
    />
  ) : (
    <Line
      line={preflopLine}
      onLineClick={handleLineClick}
      positions={actingOrder}
      activePlayer={activePlayer}
      plateData={plateData}
      plateMapping={plateMapping}
      playerBets={playerBets}
      alivePlayers={alivePlayers}
      onActionClick={handleActionClick}
      matchWidth={
        desktopStudy ? undefined : windowWidth >= 1024 ? plateContentWidth : undefined
      }
    />
  );

  const libraryButton = POSTFLOP_ENABLED ? (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => setShowLibrary(true)}
        className="
          relative h-9 sm:h-10 px-2.5 gap-1.5
          inline-flex items-center justify-center
          rounded-xl border border-gray-300 bg-white/95 shadow-md
          hover:bg-gray-100 text-gray-800
          focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60
        "
        aria-label="Solved flops"
        title="Browse solved flops"
      >
        <Library size={16} strokeWidth={2.2} className="text-emerald-600" />
        {pfIndex.entries.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1rem] rounded-full bg-emerald-600 px-1 text-center text-[10px] font-bold leading-4 text-white shadow">
            {pfIndex.entries.length}
          </span>
        )}
      </button>
    </div>
  ) : null;

  return (
    <>
      <Steps enabled={tourRun} steps={tourSteps} initialStep={0} onExit={() => setTourRun(false)} />

      {/* FLOP PICKER MODAL */}
      {POSTFLOP_ENABLED && showFlopModal && pendingFlopUpload && (
        <FlopPickerModal
          flopCards={flopCards}
          flopInput={flopInput}
          flopInputError={flopInputError}
          solvedForPendingLine={solvedForPendingLine}
          usedCards={usedSetForFlop}
          canConfirm={canConfirmFlop}
          onClose={closeFlopModal}
          onPickCard={onPickFlopCard}
          onRemoveCardAt={(idx) =>
            setFlopCards((prev) => prev.filter((_c, i) => i !== idx))
          }
          onInputChange={handleFlopInputChange}
          onRandomize={randomizeFlop}
          onConfirm={() => void confirmFlopAndUpload()}
          onOpenSolvedBoard={(entry) => {
            closeFlopModal();
            void openSolvedBoard(entry);
          }}
        />
      )}

      {/* SOLVED FLOPS LIBRARY MODAL */}
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

          {desktopStudy ? (
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
              singleRangeView={singleRangeView}
              onToggleSingleRange={() => setSingleRangeView((v) => !v)}
              line={lineNode}
              libraryButton={libraryButton}
              lineWrapperRef={lineWrapperRef}
            />
          ) : (
            <ClassicHeader
              folders={folders}
              currentFolder={folder}
              onFolderSelect={handleFolderSelect}
              metaByFolder={folderMetaMap}
              userTier={tier ?? "free"}
              fullWidth
              singleRangeView={singleRangeView}
              onToggleSingleRange={() => setSingleRangeView((v) => !v)}
              simName={metadata.name}
              playerCount={playerCount}
              avgStack={avgStack}
              ante={metadata.ante}
              icm={metadata.icm}
              simInfoOpen={simInfoOpen}
              onToggleSimInfo={() => setSimInfoOpen((o) => !o)}
              line={lineNode}
              libraryButton={libraryButton}
              lineWrapperRef={lineWrapperRef}
            />
          )}

          {/* Pending solve banner */}
          {postflopPending && (
            <PendingSolveCard board={postflopPending.board} startedAt={postflopPending.startedAt} />
          )}

          {/* Current flop display (outside a session, e.g. legacy state) */}
          {!pf.view && !postflopPending && currentBoard.length > 0 && (
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

          {/* Plate grid */}
          <div className="relative z-0">
            <PlateGrid
              files={displayPlates}
              positions={positionOrder}
              selectedFolder={folder}
              randomFillEnabled={randomFillEnabled}
              onActionClick={handleActionClick}
              windowWidth={windowWidth}
              windowHeight={windowHeight}
              plateData={plateData}
              loading={loading}
              alivePlayers={alivePlayers}
              playerBets={playerBets}
              isICMSim={isICMSim}
              ante={metadata.ante}
              pot={potSize}
              activePlayer={activePlayer}
              board={pf.view ? pf.view.board : currentBoard}
              singleRangeView={singleRangeView}
              mode={mode}
              onPlateContentRef={setPlateContentEl}
            />
          </div>
        </div>

      </div>

      {showLoginOverlay && (
        <LoginSignupModal
          onClose={() => {
            setShowLoginOverlay(false);
          }}
        />
      )}
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
