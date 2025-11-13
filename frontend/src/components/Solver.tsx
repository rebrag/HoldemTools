// src/components/Solver.tsx
import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import type { ChangeEvent } from "react";
import PlateGrid from "./PlateGrid";
import { actionToNumberMap } from "../utils/constants";
import { getInitialMapping } from "../utils/getInitialMapping";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";
import axios from "axios";
import { JsonData } from "../utils/utils";
import Line from "./Line";
import { Steps } from "intro.js-react";
import "intro.js/introjs.css";
import { User } from "firebase/auth";
import LoginSignupModal from "./LoginSignupModal";
import RandomizeButton from "./RandomizeButton";
import FolderSelector from "./FolderSelector";
import ProUpsell from "./ProUpsell";
import {
  requiredTierForFolder,
  getPriceIdForTier,
  TIER_LABEL,
  type Tier,
  isTierSufficient,
  type FolderMetaLike,
} from "../lib/stripeTiers";
import { startSubscriptionCheckout } from "../lib/checkout";
import { uploadGameTree } from "../lib/uploadGameTree";
import { useCurrentTier } from "../context/TierContext";
import CardPicker from "./CardPicker";
import PlayingCard from "./PlayingCard";
import { handleActionClickImpl, type PendingFlopUpload } from "../lib/handleActionClick";

/* ────────────────────────────────────────────────────────────── */
/*  Card constants + flop input parsing                          */
/* ────────────────────────────────────────────────────────────── */

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = ["h", "d", "c", "s"] as const;
const ALL_CARDS: string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

function parseFlopInputString(raw: string): { cards: string[]; error: string | null } {
  // Strip spaces, commas and other separators, keep only letters/numbers
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, "").trim();

  if (!stripped) return { cards: [], error: null };

  const upper = stripped.toUpperCase();

  // Each card is 2 chars: rank + suit, max 3 cards => 6 chars
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
  { element: '[data-intro-target="color-key-btn"]', intro: "Click on an action to see how other players should react.", position: "bottom" },
];

type SolverProps = { user: User | null };

const Solver = ({ user }: SolverProps) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth, windowHeight } = useWindowDimensions();
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

  // NEW: pending flop upload + flop modal state
  const [pendingFlopUpload, setPendingFlopUpload] = useState<PendingFlopUpload | null>(null);
  const [showFlopModal, setShowFlopModal] = useState(false);
  const [flopCards, setFlopCards] = useState<string[]>([]); // exact user-picked order
  const [flopInput, setFlopInput] = useState<string>(""); // NEW: text input for flop
  const [flopInputError, setFlopInputError] = useState<string | null>(null); // NEW: error text

  // NEW: singleRangeView toggle (persist)
  const [singleRangeView, setSingleRangeView] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("singleRangeView");
      return raw === "1";
    } catch {
      return false;
    }
  });

  const tourBooted = useRef(localStorage.getItem("tourSeen") === "1");
  const lastClickRef = useRef<{ plate: string; action: string } | null>(null);

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

  const isNarrow =
    positionOrder.length === 2 ? !(windowWidth * 1.3 < windowHeight) : windowWidth * 1.3 < windowHeight;
  const gridRows = isNarrow ? Math.ceil(positionOrder.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(positionOrder.length / 2);
  const gridArray = Array(gridRows * gridCols).fill(null);
  positionOrder.forEach((pos, i) => {
    gridArray[i] = pos;
  });

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

  // Open folder util
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
        setPendingTier(requiredTierForFolder(selectedFolder)); // rough guess
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
        // no metadata — we'll fall back to filename rules in requiredTierForFolder
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
    ]
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

  const triggerPrevSolution = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  }, []);
  const triggerNextSolution = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
  }, []);

  // --- flop modal side-effects ---
  useEffect(() => {
    if (pendingFlopUpload) {
      setFlopCards([]);
      setFlopInput("");
      setFlopInputError(null);
      setShowFlopModal(true);
    }
  }, [pendingFlopUpload]);

  // keep text input in sync with flopCards when they change via clicks/random
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
      if (prev.includes(code)) {
        return prev.filter((c) => c !== code);
      }
      if (prev.length >= 3) return prev; // ignore extra
      return [...prev, code];
    });
  };

  const handleFlopInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFlopInput(value);

    const { cards, error } = parseFlopInputString(value);
    setFlopInputError(error);
    if (!error) {
      setFlopCards(cards);
    }
  };

  const randomizeFlop = useCallback(() => {
    const deck = [...ALL_CARDS];
    // simple Fisher–Yates shuffle
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
    const boardStr = flopCards.join(" ");
    const { folder: pfFolder, actingPosition, preflopLine: pfLine, isICMSim: pfICM, linesBeforeBoard, linesAfterBoard } =
      pendingFlopUpload;

    const allLines = [
      ...linesBeforeBoard,
      `#Board#${boardStr}`,
      ...linesAfterBoard,
    ];

    const adjustedText = allLines.join("\n");

    try {
      const result = await uploadGameTree(API_BASE_URL, {
        folder: pfFolder,
        line: pfLine,
        actingPos: actingPosition ?? "",
        isICM: pfICM,
        text: adjustedText,
        uid,
      });
      console.log("✅ Game tree uploaded:", result?.path ?? "(no path returned)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.warn("⚠️ Failed to upload game tree:", err?.message ?? err);
    } finally {
      closeFlopModal();
    }
  };

  const usedSetForFlop = useMemo(() => new Set<string>(flopCards), [flopCards]);

  return (
    <>
      <Steps enabled={tourRun} steps={tourSteps} initialStep={0} onExit={() => setTourRun(false)} />

      {/* FLOP PICKER MODAL */}
      {showFlopModal && pendingFlopUpload && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
          onMouseDown={closeFlopModal}
        >
          <div
            className="relative w-full max-w-md mx-3 rounded-2xl bg-slate-900/95 border border-emerald-500/40 shadow-2xl p-4 text-gray-100"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* close button */}
            <button
              type="button"
              onClick={closeFlopModal}
              className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white border border-white/10 shadow-sm"
              aria-label="Close"
            >
              ×
            </button>

            <h2 className="text-base font-semibold mb-1">Choose flop cards</h2>
            <p className="text-xs text-gray-300 mb-3">
              Pick exactly three cards for the flop. This board will be sent with the game tree to be saved for later.
            </p>

            {/* flop display: 3 slots + randomize button */}
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="flex items-center justify-center gap-2">
                {Array.from({ length: 3 }).map((_, idx) => {
                  const code = flopCards[idx];
                  if (code) {
                    return (
                      <button
                        key={`flop-${idx}-${code}`}
                        type="button"
                        onClick={() =>
                          setFlopCards((prev) => prev.filter((_c, i) => i !== idx))
                        }
                        className="rounded-xl focus:outline-none"
                        title={`Remove ${code}`}
                      >
                        <PlayingCard code={code} width="clamp(40px, 8vw, 64px)" />
                      </button>
                    );
                  }
                  const isNext = idx === flopCards.length;
                  return (
                    <div
                      key={`flop-slot-${idx}`}
                      className={`relative inline-flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed bg-white/10
                      ${isNext ? "border-emerald-400 ring-2 ring-emerald-400/70 animate-pulse" : "border-gray-500"}`}
                      style={{ width: "clamp(40px, 8vw, 64px)" }}
                      title={isNext ? "Next flop card will go here" : "Empty flop slot"}
                    >
                      <span className={`text-sm ${isNext ? "text-emerald-300" : "text-gray-300"}`}>+</span>
                      {isNext && (
                        <span className="absolute -top-1 -right-1 text-[9px] bg-emerald-600 text-white rounded px-1 shadow">
                          NEXT
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={randomizeFlop}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 shadow"
                title="Generate a random flop"
              >
                <span>Random flop</span>
                <span aria-hidden="true">🎲</span>
              </button>
            </div>

            {/* typed flop input */}
            <div className="mb-3 px-1">
              <div className="flex items-baseline justify-between mb-1 gap-2">
                <label className="text-[11px] font-medium text-gray-200">
                  Or type flop (e.g. &quot;Ah Kd 9c&quot;):
                </label>
                {flopInputError && (
                  <p className="text-[10px] text-red-400 text-right">
                    {flopInputError}
                  </p>
                )}
              </div>

              <input
                type="text"
                value={flopInput}
                onChange={handleFlopInputChange}
                placeholder="Ah Kd 9c"
                className="w-full rounded-md bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/80"
              />
            </div>

            {/* Card picker */}
            <div className="mt-2 max-h=[320px] overflow-y-auto pb-1">
              <CardPicker
                used={usedSetForFlop}
                onPick={onPickFlopCard}
                size="sm"
                fitToWidth
                cardWidth="100%"          // not strictly required now, but fine
                gapPx={4}
                className="w-full inline-grid mx-auto rounded-xl border border-gray-300 bg-slate-700/80 p-2"
              />
            </div>

            {/* actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeFlopModal}
                className="rounded-lg px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-gray-200 border border-white/10 shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmFlopAndUpload}
                disabled={flopCards.length !== 3}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow
                  ${
                    flopCards.length === 3
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-emerald-600/50 text-white/70 cursor-not-allowed"
                  }`}
              >
                <span>Confirm flop</span>
                <span aria-hidden="true">✓</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-auto flex flex-col">
        <div className="pt-1 p-1 flex-grow">
          {(folderError || filesError) && <div className="text-red-500">{folderError || filesError}</div>}

          {/* Folder selector row */}
          <div className="px-2 sm:px-4 mt-1">
            <div className="mx-auto w-full max-w-5xl">
              <div className="relative z-50">
                <div data-intro-target="folder-selector" className="w-auto">
                  <FolderSelector
                    folders={folders}
                    currentFolder={folder}
                    onFolderSelect={handleFolderSelect}
                    metaByFolder={folderMetaMap}
                    userTier={tier ?? "free"}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sim badge row with right-aligned Single Range toggle */}
          {metadata?.name && (
            <div className="px-2 sm:px-4 mt-2 mb-1">
              <div className="mx-auto w-full max-w-5xl">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div />
                  <div className="justify-self-center">
                    <span
                      className="inline-flex items-center gap-2 rounded-md bg-white/70 backdrop-blur px-3 py-1 text-xs font-medium text-gray-800 shadow ring-1 ring-black/5"
                      aria-label="Active Simulation Name"
                      title="Active Simulation"
                    >
                      <strong className="tracking-wide">Sim:</strong>
                      <span className="truncate max-w-[58vw] sm:max-w-[42vw]">{metadata.name}</span>
                    </span>
                  </div>
                  <div className="justify-self-end">
                    <button
                      type="button"
                      onClick={() => setSingleRangeView((v) => !v)}
                      aria-pressed={singleRangeView}
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium shadow
                                  ring-1 ring-black/5 transition
                                  ${singleRangeView
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                    : "bg-white/70 text-gray-800 hover:bg-white"}`}
                      title="Show ranges only for the active player"
                    >
                      <span className={`h-2 w-2 rounded-full ${singleRangeView ? "bg-white" : "bg-emerald-500/70"}`} />
                      {singleRangeView ? "Single Range: On" : "Single Range: Off"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Line + right controls */}
          <div className="relative flex items-center mt-1 mb-2">
            <Line line={preflopLine} onLineClick={handleLineClick} />
            <div className="absolute right-0 mr-2 z-20 flex items-center gap-2">
              <div className="scale-90">
                <RandomizeButton
                  randomFillEnabled={randomFillEnabled}
                  setRandomFillEnabled={() => setRandomFillEnabled((prev) => !prev)}
                />
              </div>
            </div>
          </div>

          {/* PlateGrid */}
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
              singleRangeView={singleRangeView}
            />
          </div>

          {/* Prev/Next solution buttons */}
          <div className="mx-auto w-full max-w-5xl mt-3 mb-2 px-2 sm:px-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={triggerNextSolution}
                className="inline-flex items-center gap-2 rounded-md bg-white/70 hover:bg-white/90 active:bg-white text-gray-800 px-3 py-1.5 text-xs font-medium shadow transition pointer-events-auto"
                aria-label="Previous solution (Arrow Down)"
                title="Previous solution (Arrow Down)"
              >
                Previous solution
              </button>

              <button
                type="button"
                onClick={triggerPrevSolution}
                className="inline-flex items-center gap-2 rounded-md bg-white/70 hover:bg-white/90 active:bg-white text-gray-800 px-3 py-1.5 text-xs font-medium shadow transition pointer-events-auto"
                aria-label="Next solution (Arrow Up)"
                title="Next solution (Arrow Up)"
              >
                Next solution
              </button>
            </div>
          </div>

          {/* ICM metadata */}
          <div className="flex justify-center mt-1 mb-2 pointer-events-none select-none">
            <div className="bg-white/60 backdrop-blur-sm rounded-md px-2 py-1 text-xs shadow text-center text-gray-800">
              {Array.isArray(metadata.icm) && metadata.icm.length > 0 ? (
                <>
                  <strong>ICM&nbsp;Structure:</strong>
                  <br />
                  {metadata.icm.map((value, idx) => {
                    const rank = idx + 1;
                    const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
                    return (
                      <div key={idx}>
                        {rank}
                        <sup>{suffix}</sup>: ${value.toLocaleString()}
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <strong>ICM:</strong>&nbsp;None
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-center select-none pt-5 text-white/70">© HoldemTools 2025</div>
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
