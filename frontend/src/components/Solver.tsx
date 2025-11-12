// src/components/Solver.tsx
import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import PlateGrid from "./PlateGrid";
import { actionToNumberMap, numberToActionMap, getActionNumber } from "../utils/constants";
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
import { useTier } from "../hooks/useTier";
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

const tourSteps = [
  { element: '[data-intro-target="folder-selector"]', intro: "Choose a pre-flop sim here.", position: "bottom" },
  { element: '[data-intro-target="color-key-btn"]', intro: "Click on an action to see how other players should react.", position: "bottom" },
];

const Solver = ({ user }: { user: User | null }) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth, windowHeight } = useWindowDimensions();
  const uid = user?.uid ?? null;
  const { tier, loading: tierLoading } = useTier(uid);
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
  const actuallyOpenFolder = useCallback((selectedFolder: string) => {
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
  }, [defaultPlateNames]);

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

      // Not logged in → ask to log in
      if (!uid) {
        setPendingFolder(selectedFolder);
        setPendingTier(requiredTierForFolder(selectedFolder)); // rough guess
        setShowLoginOverlay(true);
        return;
      }

      // Try to load metadata to classify FT/ICM correctly before showing upsell
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

      // Allowed → open
      actuallyOpenFolder(selectedFolder);
    },
    [uid, folder, API_BASE_URL, tier, tierLoading, actuallyOpenFolder]
  );

  // Start checkout
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
      // redirect handled by the extension
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

  const convertRangeText = (data: JsonData | undefined, action: string): string => {
    if (!data) return "";
    const key = getActionNumber(action) ?? action;
    const alt = action;
    const bucket = data[key] || data[alt];
    if (!bucket) return "";
    return Object.entries(bucket)
      .filter(([, vals]) => vals[0] > 0)
      .map(([hand, vals]) => `${hand}:${vals[0]}`)
      .join(",");
  };

  const appendPlateNames = useCallback(
    (currentFiles: string[], clickedIndex: number, actionNumber: string, availableFiles: string[]): string[] => {
      const clickedFile = currentFiles[clickedIndex];
      if (!clickedFile) return currentFiles;
      const prefix = clickedFile.replace(".json", "");
      const baseName = prefix === "root" ? actionNumber : `${prefix}.${actionNumber}`;
      const newFiles: string[] = [];
      const newFilesWider: string[] = [];
      const baseFileName = `${baseName}.json`;
      availableFiles.forEach((file) => {
        if (file === baseFileName && !currentFiles.includes(file)) newFiles.push(file);
      });
      const regex = new RegExp(`^${baseName}(?:\\.0)+\\.json$`);
      availableFiles.forEach((file) => {
        if (regex.test(file) && !currentFiles.includes(file)) newFiles.push(file);
      });
      availableFiles.forEach((file) => {
        if (file === baseFileName) newFilesWider.push(file);
      });
      availableFiles.forEach((file) => {
        if (regex.test(file)) newFilesWider.push(file);
      });
      newFilesWider.forEach((file) => {
        setPlateMapping((prev) => ({ ...prev, [plateData[file]?.Position]: file }));
      });
      return [...currentFiles, ...newFiles];
    },
    [plateData]
  );

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      if (
        lastClickRef.current &&
        lastClickRef.current.plate === fileName &&
        lastClickRef.current.action === action
      ) {
        return;
      }

      // ───────────────── helpers ─────────────────
      const toLiteralLines = (vals: (string | number)[]) =>
        vals.map(v => String(v).trim()).join("\\n");

      // If you track board somewhere, provide it here
      const boardStr: string | undefined = "5d Tc Js";

      // ─────────────── existing flow ───────────────
      const actionNumber = getActionNumber(action) ?? "";
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      const newLoadedPlates = appendPlateNames(
        loadedPlates,
        clickedIndex,
        actionNumber,
        availableJsonFiles
      );
      setLoadedPlates((prev) => [...new Set([...prev, ...newLoadedPlates])]);

      const parts = fileName.replace(".json", "").split(".");
      const aliveList = [...positionOrder];
      let activeIndex = playerCount === 2 ? 0 : 2;

      for (const part of parts) {
        if (part === "root") continue;
        const n = parseInt(part, 10);
        if (n === 0) {
          aliveList.splice(activeIndex, 1);
          if (aliveList.length > 0 && activeIndex >= aliveList.length) {
            activeIndex = 0;
          }
        } else {
          activeIndex = (activeIndex + 1) % aliveList.length;
        }
      }

      const newAliveMap = Object.fromEntries(
        positionOrder.map((pos) => [pos, aliveList.includes(pos)])
      ) as Record<string, boolean>;
      setAlivePlayers(newAliveMap);
      setActivePlayer(aliveList[(activeIndex + 1) % aliveList.length]);

      const actingPosition = plateData[fileName]?.Position;
      const currentBet = playerBets[actingPosition] || 0;
      const stackSize = plateData[fileName]?.bb || 0;

      if (action === "Fold") {
        setAlivePlayers((prev) => ({ ...prev, [actingPosition]: false }));
      }

      let newBetAmount = currentBet;
      if (action === "Min") newBetAmount = 2;
      else if (action === "ALLIN") newBetAmount = stackSize;
      else if (action.startsWith("Raise ")) {
        const val = action.split(" ")[1];
        const maxBet = Math.max(...Object.values(playerBets));
        newBetAmount = val.endsWith("bb")
          ? maxBet + parseFloat(val)
          : maxBet + (parseFloat(val) / 100) * (potSize + maxBet);
      } else if (action === "Call") {
        const amountToCall = Math.max(...Object.values(playerBets));
        newBetAmount = Math.min(amountToCall, stackSize);
      }

      const newPotSize = potSize + Math.max(0, newBetAmount - currentBet);
      setPotSize(newPotSize);
      setPlayerBets((prev) => ({ ...prev, [actingPosition]: newBetAmount }));

      if (action === "Call") {
        const callData = plateData[fileName];
        const callingPos = callData?.Position;

        const [range0, range1] =
          positionOrder.indexOf(callingPos ?? "") < positionOrder.indexOf(lastRangePos)
            ? [convertRangeText(callData, action), lastRange]
            : [lastRange, convertRangeText(callData, action)];

        // Build stacks in chips*100 (\n as literal backslashes)
        const stackMap: Record<string, number> = Object.fromEntries(
          positionOrder.map((pos) => {
            const plate = plateMapping[pos];
            const bb = plateData[plate]?.bb ?? 0;
            const bet = pos === actingPosition ? newBetAmount : playerBets[pos] ?? 0;
            return [pos, Math.round((bb - bet) * 100)];
          })
        );

        let firstPos = lastRangePos;
        let secondPos = actingPosition;
        if (!firstPos) firstPos = secondPos;
        if (
          firstPos &&
          secondPos &&
          positionOrder.indexOf(firstPos) < positionOrder.indexOf(secondPos)
        ) {
          [firstPos, secondPos] = [secondPos, firstPos];
        }

        const stackEntries = new Set([firstPos, secondPos]);
        const otherStacks = positionOrder
          .filter((pos) => !stackEntries.has(pos))
          .map((pos) => stackMap[pos] ?? 0);

        const stacksLiteral = toLiteralLines([
          stackMap[firstPos!],
          stackMap[secondPos!],
          ...otherStacks,
        ]);

        const payoutsLiteral = Array.isArray(metadata.icm)
          ? toLiteralLines(metadata.icm.map((v: number) => Math.round(Number(v) * 10)))
          : "0\\n0\\n0";

        const effStack = Math.min(
          ...positionOrder
            .filter((pos) => newAliveMap[pos])
            .map((pos) => {
              const stack = plateData[plateMapping[pos]]?.bb ?? 0;
              const bet = pos === actingPosition ? newBetAmount : playerBets[pos] ?? 0;
              return stack - bet;
            })
        );
        const effStackChips = Math.round(effStack * 100);
        const potChips = Math.round(newPotSize * 100);

        const capPerStreetLiteral = toLiteralLines([3, 0, 0]);

        const lines: string[] = [
          "#Type#NoLimit",
          `#Range0#${range0}`,
          `#Range1#${range1}`,
          "#ICM.ICMFormat#Pio ICM structure",
          isICMSim ? "#ICM.Enabled#True" : undefined,
          `#ICM.Payouts#${payoutsLiteral}`,
          `#ICM.Stacks#${stacksLiteral}`,
          boardStr ? `#Board#${boardStr}` : undefined,
          `#Pot#${potChips}`,
          `#EffectiveStacks#${effStackChips}`,
          "#AllinThreshold#60",
          "#AddAllinOnlyIfLessThanThisTimesThePot#250",
          "#MergeSimilarBets#True",
          "#MergeSimilarBetsThreshold#12",
          "#CapEnabled#True",
          `#CapPerStreet#${capPerStreetLiteral}`,
          "#CapMode#NoLimit",
          "#FlopConfig.RaiseSize#33",
          "#FlopConfig.AddAllin#True",
          "#TurnConfig.BetSize#50",
          "#TurnConfig.RaiseSize#a",
          "#TurnConfig.AddAllin#True",
          "#RiverConfig.BetSize#30 66",
          "#RiverConfig.RaiseSize#a",
          "#RiverConfig.AddAllin#True",
          "#RiverConfig.DonkBetSize#30",
          "#FlopConfigIP.BetSize#25",
          "#FlopConfigIP.RaiseSize#a",
          "#FlopConfigIP.AddAllin#True",
          "#TurnConfigIP.BetSize#50",
          "#TurnConfigIP.RaiseSize#a",
          "#TurnConfigIP.AddAllin#True",
          "#RiverConfigIP.BetSize#30 66",
          "#RiverConfigIP.RaiseSize#a",
          "#RiverConfigIP.AddAllin#True",
        ].filter(Boolean) as string[];

        const adjustedText = lines.join("\n");

        (async () => {
          try {
            const result = await uploadGameTree(API_BASE_URL, {
              folder,
              line: preflopLine,
              actingPos: actingPosition ?? "",
              isICM: isICMSim,
              text: adjustedText,
              uid,
            });
            console.log("✅ Game tree uploaded:", result?.path ?? "(no path returned)");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            console.warn("⚠️ Failed to upload game tree:", err?.message ?? err);
          }
        })();

      } else if (action !== "ALLIN") {
        const data = plateData[fileName];
        const currentRange = convertRangeText(data, action);
        if (currentRange) {
          setLastRange(currentRange);
          setLastRangePos(data.Position);
        }
      }

      setPreflopLine([
        "Root",
        ...parts.filter((p) => p !== "root").map((p) => numberToActionMap[p]),
        action,
      ]);

      if (
        newLoadedPlates.length !== loadedPlates.length ||
        !newLoadedPlates.every((v, i) => v === loadedPlates[i])
      ) {
        setLoadedPlates(newLoadedPlates);
      }
      setRandomFillEnabled(false);
      setPlateMapping((prev) => ({ ...prev }));
      lastClickRef.current = { plate: fileName, action };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      loadedPlates,
      appendPlateNames,
      availableJsonFiles,
      playerCount,
      playerBets,
      plateData,
      potSize,
      positionOrder,
      lastRangePos,
      lastRange,
      metadata,
      plateMapping,
      isICMSim,
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

  // NEW: persist toggle
  useEffect(() => {
    try {
      localStorage.setItem("singleRangeView", singleRangeView ? "1" : "0");
    } catch { /* empty */ }
  }, [singleRangeView]);

  // NEW: emulate your Up/Down keybinds from buttons
  const triggerPrevSolution = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  }, []);
  const triggerNextSolution = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
  }, []);

  return (
    <>
      <Steps enabled={tourRun} steps={tourSteps} initialStep={0} onExit={() => setTourRun(false)} />

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
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sim badge row with right-aligned Single Range toggle */}
          {metadata?.name && (
            <div className="px-2 sm:px-4 mt-2 mb-1">
              <div className="mx-auto w-full max-w-5xl">
                {/* 3-col grid: [spacer | center badge | right controls] */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  {/* left spacer (keeps badge centered even with right controls) */}
                  <div />

                  {/* center: Sim badge */}
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

                  {/* right: Single Range toggle */}
                  <div className="justify-self-end">
                    <button
                      type="button"
                      onClick={() => setSingleRangeView(v => !v)}
                      aria-pressed={singleRangeView}
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium shadow
                                  ring-1 ring-black/5 transition
                                  ${singleRangeView
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                    : "bg-white/70 text-gray-800 hover:bg-white"}`}
                      title="Show ranges only for the active player"
                    >
                      {/* subtle status dot */}
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
              singleRangeView={singleRangeView} // NEW
            />
          </div>

          {/* NEW: Prev/Next solution buttons below grid (left/right) */}
          <div className="mx-auto w-full max-w-5xl mt-3 mb-2 px-2 sm:px-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={triggerNextSolution}
                className="inline-flex items-center gap-2 rounded-md bg-white/70 hover:bg-white/90 active:bg-white text-gray-800 px-3 py-1.5 text-xs font-medium shadow transition pointer-events-auto"
                aria-label="Previous solution (Arrow Down)"
                title="Previous solution (Arrow Down)"
              >
                <span className="material-icons-outlined text-base leading-none"></span>
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
                <span className="material-icons-outlined text-base leading-none"></span>
              </button>
            </div>
          </div>

          {/* ICM metadata ONLY (kept below PlateGrid) */}
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
                <><strong>ICM:</strong>&nbsp;None</>
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
