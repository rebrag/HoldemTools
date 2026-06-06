// src/lib/handleActionClick.ts
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { getActionNumber, numberToActionMap } from "../utils/constants";
import type { JsonData } from "../utils/utils";

export interface PendingFlopUpload {
  folder: string;
  actingPosition: string;
  preflopLine: string[];
  isICMSim: boolean;
  linesBeforeBoard: string[];
  linesAfterBoard: string[];
}

export interface HandleActionClickContext {
  API_BASE_URL: string;
  folder: string;
  uid: string | null;
  isICMSim: boolean;
  metadata: { name: string; ante: number; icm: number[] };
  positionOrder: string[];
  playerCount: number;
  plateData: Record<string, JsonData>;
  plateMapping: Record<string, string>;
  playerBets: Record<string, number>;
  potSize: number;
  preflopLine: string[];
  lastRange: string;
  lastRangePos: string;
  loadedPlates: string[];
  availableJsonFiles: string[];
  setAlivePlayers: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActivePlayer: Dispatch<SetStateAction<string>>;
  setLoadedPlates: Dispatch<SetStateAction<string[]>>;
  setPlayerBets: Dispatch<SetStateAction<Record<string, number>>>;
  setPotSize: Dispatch<SetStateAction<number>>;
  setPreflopLine: Dispatch<SetStateAction<string[]>>;
  setRandomFillEnabled: Dispatch<SetStateAction<boolean>>;
  setLastRange: Dispatch<SetStateAction<string>>;
  setLastRangePos: Dispatch<SetStateAction<string>>;
  setPlateMapping: Dispatch<SetStateAction<Record<string, string>>>;
  lastClickRef: MutableRefObject<{ plate: string; action: string } | null>;
  setPendingFlopUpload: Dispatch<SetStateAction<PendingFlopUpload | null>>;
}

const convertRangeText = (data: JsonData | undefined, action: string): string => {
  if (!data) return "";
  const key = getActionNumber(action) ?? action;
  const alt = action;
  const bucket = data[key] || data[alt];
  if (!bucket) return "";
  return Object.entries(bucket)
    .filter(([, vals]) => (vals as number[])[0] > 0)
    .map(([hand, vals]) => `${hand}:${(vals as number[])[0]}`)
    .join(",");
};

const appendPlateNames = (
  currentFiles: string[],
  clickedIndex: number,
  actionNumber: string,
  availableFiles: string[],
  plateData: Record<string, JsonData>,
  setPlateMapping: Dispatch<SetStateAction<Record<string, string>>>
): string[] => {
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
    const pos = plateData[file]?.Position;
    if (pos) {
      setPlateMapping((prev) => ({ ...prev, [pos]: file }));
    }
  });

  return [...currentFiles, ...newFiles];
};

export function handleActionClickImpl(
  ctx: HandleActionClickContext,
  action: string,
  fileName: string
) {
  const {
    folder,
    isICMSim,
    metadata,
    positionOrder,
    playerCount,
    plateData,
    plateMapping,
    playerBets,
    potSize,
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
  } = ctx;

  const plateName = loadedPlates.find((name) => name === fileName);
  if (!plateName) return;

  if (
    lastClickRef.current &&
    lastClickRef.current.plate === fileName &&
    lastClickRef.current.action === action
  ) {
    return;
  }

  const parts = fileName.replace(".json", "").split(".");
  const fullLine = [
    "Root",
    ...parts.filter((p) => p !== "root").map((p) => numberToActionMap[p]),
    action,
  ];

  const toLiteralLines = (vals: (string | number)[]) =>
    vals.map((v) => String(v).trim()).join("\\n");

  const actionNumber = getActionNumber(action) ?? "";
  const clickedIndex = loadedPlates.findIndex((name) => name === plateName);

  const newLoadedPlates = appendPlateNames(
    loadedPlates,
    clickedIndex,
    actionNumber,
    availableJsonFiles,
    plateData,
    setPlateMapping
  );
  setLoadedPlates((prev) => [...new Set([...prev, ...newLoadedPlates])]);

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
  const currentBet = actingPosition ? playerBets[actingPosition] || 0 : 0;
  const stackSize = plateData[fileName]?.bb || 0;

  if (action === "Fold" && actingPosition) {
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
  if (actingPosition) {
    setPlayerBets((prev) => ({ ...prev, [actingPosition]: newBetAmount }));
  }

  if (action === "Call") {
    const callData = plateData[fileName];
    const callingPos = callData?.Position;

    const [range0, range1] =
      positionOrder.indexOf(callingPos ?? "") < positionOrder.indexOf(lastRangePos)
        ? [convertRangeText(callData, action), lastRange]
        : [lastRange, convertRangeText(callData, action)];

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
    if (!firstPos) firstPos = secondPos ?? "";
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


    const callerLaterThanRaiser =
      !!callingPos &&
      !!lastRangePos &&
      positionOrder.includes(callingPos) &&
      positionOrder.includes(lastRangePos) &&
      positionOrder.indexOf(callingPos) > positionOrder.indexOf(lastRangePos);

    const linesBeforeBoard: string[] = [
      "#Type#NoLimit",
      `#Range0#${range0}`,
      `#Range1#${range1}`,
      "#ICM.ICMFormat#Pio ICM structure",
      isICMSim ? "#ICM.Enabled#True" : undefined,
      `#ICM.Payouts#${payoutsLiteral}`,
      `#ICM.Stacks#${stacksLiteral}`,
    ].filter(Boolean) as string[];

    const linesAfterBoard: string[] = [
      `#Pot#${potChips}`,
      `#EffectiveStacks#${effStackChips}`,
      "#AllinThreshold#60",
      "#AddAllinOnlyIfLessThanThisTimesThePot#250",
      "#MergeSimilarBets#True",
      "#MergeSimilarBetsThreshold#12",
      "#CapEnabled#True",
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
    ];

    // insert FlopConfig.BetSize#25 right after CapMode when caller > raiser
    if (callerLaterThanRaiser) {
      const idx = linesAfterBoard.findIndex((l) => l.startsWith("#CapMode#"));
      if (idx !== -1) {
        linesAfterBoard.splice(idx + 1, 0, "#FlopConfig.BetSize#25");
      }
    }

    // hand off to Solver to open the flop picker modal
    setPendingFlopUpload({
      folder,
      actingPosition: actingPosition ?? "",
      preflopLine: fullLine,
      isICMSim,
      linesBeforeBoard,
      linesAfterBoard,
    });
  } else if (action !== "ALLIN") {
    const data = plateData[fileName];
    const currentRange = convertRangeText(data, action);
    if (currentRange && data?.Position) {
      setLastRange(currentRange);
      setLastRangePos(data.Position);
    }
  }

  setPreflopLine(fullLine);

  if (
    newLoadedPlates.length !== loadedPlates.length ||
    !newLoadedPlates.every((v, i) => v === loadedPlates[i])
  ) {
    setLoadedPlates(newLoadedPlates);
  }

  setRandomFillEnabled(false);
  setPlateMapping((prev) => ({ ...prev }));
  lastClickRef.current = { plate: fileName, action };
}
