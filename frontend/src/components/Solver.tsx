import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToNumberMap, actionToPrefixMap2, numberToActionMap} from "../utils/constants"; // 
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";
import axios from "axios";
import { JsonData } from "../utils/utils";
import InstructionBox from "./InstructionBox";
import Line from "./Line";
import { generateSpiralOrder } from "../utils/gridUtils";

const Solver = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth, windowHeight } = useWindowDimensions();
  const [folder, setFolder] = useState<string>("22UTG_22UTG1_22LJ_22HJ_22CO_22BTN_22SB_22BB");
  const [plateData, setPlateData] = useState<Record<string, JsonData>>({});
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});
  const [lastRange, setLastRange] = useState<string>("");
  const [lastRangePos, setLastRangePos] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [preflopLine, setPreflopLine] = useState<string[]>(["Root"]);
  const playerCount = useMemo(() => (folder ? folder.split("_").length : 1), [folder]);
  const [alivePlayers, setAlivePlayers] = useState<Record<string, boolean>>({});
  const [metadata, setMetadata] = useState<{ name: string; ante: number; icm: number[] }>({
    name: "",
    ante: 0,
    icm: [],
  });
  const isICMSim = Array.isArray(metadata.icm) && metadata.icm.length > 0;
  const [potSize, setPotSize] = useState<number>(0);
  const [playerBets, setPlayerBets] = useState<Record<string, number>>({});

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
    if (playerCount === 6) return ["SB", "BB", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 2) return ["BTN", "BB"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

  const isNarrow =
    positionOrder.length === 2
      ? !(windowWidth * 1.3 < windowHeight)
      : windowWidth * 1.3 < windowHeight;
  const gridRows = isNarrow ? Math.ceil(positionOrder.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(positionOrder.length / 2);
  
  // Create a grid array (row-major order) using your canonical order.
  const gridArray = Array(gridRows * gridCols).fill(null);
  positionOrder.forEach((pos, i) => {
    gridArray[i] = pos;
  });
  
  const spiralIndices = generateSpiralOrder(gridRows, gridCols);
  const spiralPositionOrder = spiralIndices
    .map(([r, c]) => {
      const idx = r * gridCols + c;
      return gridArray[idx];
    })
    .filter((pos): pos is string => pos !== null);

  useEffect(() => {
    const initialAlive: Record<string, boolean> = {};
    const positions = playerCount === 8 
      ? ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"]
      : playerCount === 6 
        ? ["SB", "BB", "LJ", "HJ", "CO", "BTN"]
        : playerCount === 2 
          ? ["BB", "BTN"]
          : Object.keys(plateMapping);
    positions.forEach((pos) => {
      initialAlive[pos] = true;
    });
    setAlivePlayers(initialAlive);
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
  }>({
    plateData: {},
    plateMapping: {},
  });
  
  useEffect(() => {
    defaultStateRef.current = {
      plateData: { ...plateData },
      plateMapping: { ...plateMapping },
    };
    console.log(metadata.icm)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, folder);

  const displayPlates = useMemo(
    () => positionOrder.map((pos) => plateMapping[pos] || ""),
    [plateMapping, positionOrder]
  );

  useLayoutEffect(() => {
    setLoadedPlates(defaultPlateNames);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // Keep plateMapping consistent with loadedPlates.
  useEffect(() => {
    setPlateMapping((prev) => {
      const filtered: Record<string, string> = {};
      Object.keys(prev).forEach((pos) => {
        if (loadedPlates.includes(prev[pos])) {
          filtered[pos] = prev[pos];
        }
      });
      return filtered;
    });
  }, [loadedPlates]);

  // Fetch plate data for any missing plates.
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
    }, 700);
  
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
        const validResults = results.filter(
          (r): r is { plate: string; data: JsonData } => r !== null
        );
        if (validResults.length > 0) {
          const newPlateData: Record<string, JsonData> = {};
          const newPlateMapping: Record<string, string> = {};
          validResults.forEach(({ plate, data }) => {
            newPlateData[plate] = data;
            newPlateMapping[data.Position] = plate;
          });
          setPlateData((prev) => ({ ...prev, ...newPlateData }));
          setPlateMapping((prev) => ({ ...prev, ...newPlateMapping }));
        }})
      .finally(() => {
        clearTimeout(timer);
        if (didTimeout) {
          setLoading(false);
        }});
    
    return () => source.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedPlates, folder]);

  const handleFolderSelect = useCallback(
    (selectedFolder: string) => {
      const newLoadedPlates = defaultPlateNames;
      setLoadedPlates(newLoadedPlates);
      setFolder(selectedFolder);
      setPlateData({});
      setPlateMapping({});
      setRandomFillEnabled(false);
      setPreflopLine(["Root"])
      const initialAlive: Record<string, boolean> = {};
      // Use canonical ordering (or spiralPositionOrder if that's what you prefer).
      positionOrder.forEach((pos) => {
        initialAlive[pos] = true;
      });
      setAlivePlayers(initialAlive);
    },
    [defaultPlateNames, positionOrder]
  );

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
        const totalPot = blindPot + ante; // ✅ use total ante directly
        setPotSize(totalPot);
      })
      .catch(() => {
        setMetadata({ name: "", ante: 0, icm: [] });
        setPlayerBets({ SB: 0.5, BB: 1 });
        setPotSize(1.5); // default with no ante
      });
  }, [folder, API_BASE_URL, playerCount]);

  const convertRangeText = (data: JsonData | undefined, action: string): string => {
    if (!data) return "";
    const dataKey = actionToPrefixMap2[action] || action;
    if (!data[dataKey]) return "";
    return Object.entries(data[dataKey])
      .map(([hand, values]) => `${hand}:${values[0]}`)
      .join(",");
  };

  const appendPlateNames = useCallback(
    (
      currentFiles: string[],
      clickedIndex: number,
      actionNumber: string,
      availableFiles: string[]
    ): string[] => {
      const clickedFile = currentFiles[clickedIndex];
      if (!clickedFile) return currentFiles;
      const prefix = clickedFile.replace(".json", "");
      const baseName = prefix === "root" ? actionNumber : `${prefix}.${actionNumber}`;
      const newFiles: string[] = [];
      const newFilesWider: string[] = [];
      const baseFileName = `${baseName}.json`;
      availableFiles.forEach((file) => {
        if (file === baseFileName && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      const regex = new RegExp(`^${baseName}(?:\\.0)+\\.json$`);
      availableFiles.forEach((file) => {
        if (regex.test(file) && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      availableFiles.forEach((file) => {
        if (file === baseFileName) {
          newFilesWider.push(file);
        }
      });
      availableFiles.forEach((file) => {
        if (regex.test(file)) {
          newFilesWider.push(file);
        }
      });
      //doing things with the new files from the regex after the clicked file
      newFilesWider.forEach((file) => {
        setPlateMapping((prev) => ({ ...prev, [plateData[file]?.Position]: file }));
      });
      //console.log("newFiles:", newFiles, "newFilesWider:", newFilesWider, "plateMapping", plateMapping, 'plateData:',plateData); //, "plateMapping", plateMapping
      return [...currentFiles, ...newFiles];
    },
    [plateData]
  );

  

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      let fullText = ""; // ✅ Declare fullText at the top
  
      // Prepare clipboard content if action is "Call"
      if (action === "Call") {
        const callData = plateData[fileName];
        const callingPos = callData?.Position;
        const callingIndex = positionOrder.indexOf(callingPos ?? "");
        const lastRaiserIndex = positionOrder.indexOf(lastRangePos);  
        let range0 = lastRange;
        let range1 = convertRangeText(callData, action);
        if (callingIndex !== -1 && lastRaiserIndex !== -1 && callingIndex < lastRaiserIndex) {
          [range0, range1] = [range1, range0];
        }

        fullText = `#Type#NoLimit
        #Range0#${range0}
        #Range1#${range1}
        #ICM.ICMFormat#Pio ICM structure
        #ICM.Payouts#16800\\n9200\\n4900\\n2800\\n1450\\n1226\\n1022\\n920\\n817\\n613\\n613\\n613\\n613\\n587\\n562\\n562\\n562\\n562
        #ICM.Stacks#1800\\n1800\\n6000\\n4000\\n3000\\n2600\\n2500\\n2500\\n2300\\n2300\\n2200\\n1800\\n1600\\n1400\\n1200\\n1000\\n800\\n500
        #Pot#${(potSize * 100).toFixed(0)}
        #EffectiveStacks#1800
        #AllinThreshold#60
        #AddAllinOnlyIfLessThanThisTimesThePot#250
        #MergeSimilarBets#True
        #MergeSimilarBetsThreshold#12
        #CapEnabled#True
        #CapPerStreet#3\\n3\\n3
        #CapMode#NoLimit
        #FlopConfig.RaiseSize#33
        #FlopConfig.AddAllin#True
        #TurnConfig.BetSize#50
        #TurnConfig.RaiseSize#a
        #TurnConfig.AddAllin#True
        #RiverConfig.BetSize#30 66
        #RiverConfig.RaiseSize#a
        #RiverConfig.AddAllin#True
        #RiverConfig.DonkBetSize#30
        #FlopConfigIP.BetSize#25
        #FlopConfigIP.RaiseSize#a
        #FlopConfigIP.AddAllin#True
        #TurnConfigIP.BetSize#50
        #TurnConfigIP.RaiseSize#a
        #TurnConfigIP.AddAllin#True
        #RiverConfigIP.BetSize#30 66
        #RiverConfigIP.RaiseSize#a
        #RiverConfigIP.AddAllin#True`;
      } else if (action !== "ALLIN") {
        const raiseData = plateData[fileName];
        const currentRange = convertRangeText(raiseData, action);
        if (currentRange) {
          setLastRange(currentRange);
          setLastRangePos(raiseData.Position);
        }
      }
  
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
  
      const actionNumber = actionToNumberMap[action];
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      const newLoadedPlates = appendPlateNames(
        loadedPlates,
        clickedIndex,
        actionNumber,
        availableJsonFiles
      );
      setLoadedPlates((prev) => [...new Set([...prev, ...newLoadedPlates])]);
  
      const parts = fileName.replace(".json", "").split(".");
      const originalPositions = [...spiralPositionOrder];
      const aliveList = [...originalPositions];
      let activeIndex = playerCount === 2 ? 0 : 2;
  
      for (const part of parts) {
        if (part === "root") continue;
        const actionValue = parseInt(part, 10);
        if (actionValue === 0) {
          aliveList.splice(activeIndex, 1);
          if (aliveList.length > 0 && activeIndex >= aliveList.length) {
            activeIndex = 0;
          }
        } else {
          if (aliveList.length > 0) {
            activeIndex = (activeIndex + 1) % aliveList.length;
          }
        }
      }
  
      const updatedAlive: Record<string, boolean> = {};
      spiralPositionOrder.forEach((pos) => {
        updatedAlive[pos] = aliveList.includes(pos);
      });
      setAlivePlayers(updatedAlive);
  
      const actingPosition = aliveList[activeIndex];
      if (!actingPosition) return;
  
      const currentBet = playerBets[actingPosition] || 0;
      const stackSize = plateData[fileName]?.bb || 0;
      let newBetAmount = currentBet;
  
      if (action === "Min") {
        newBetAmount = 2;
      } else if (action === "ALLIN") {
        newBetAmount = stackSize;
      } else if (action.startsWith("Raise ")) {
        const value = action.split(" ")[1];
        if (value.endsWith("bb")) {
          const raiseAmount = parseFloat(value.replace("bb", ""));
          newBetAmount = Math.max(...Object.values(playerBets)) + raiseAmount;
        } else if (value.endsWith("%")) {
          const percent = parseFloat(value.replace("%", ""));
          newBetAmount =
            Math.max(...Object.values(playerBets)) +
            (percent / 100) * (potSize + Math.max(...Object.values(playerBets)));
        }
      } else if (action === "Call") {
        newBetAmount = Math.max(...Object.values(playerBets));
      }
  
      const betDelta = Math.max(0, newBetAmount - currentBet);
      const newPotSize = potSize + betDelta;
  
      setPlayerBets(prev => {
        const highestBet = Math.max(...Object.values(prev));
        const updated: Record<string,number> = {};
        Object.entries(prev).forEach(([pos, bet]) => {
          if (alivePlayers[pos]) {
            updated[pos] = Math.max(bet, highestBet);
          } else {
            updated[pos] = bet;
          }
        });
      
        // 2) Then overwrite the raiser with their final bet
        updated[actingPosition] = newBetAmount;
      
        return updated;
      });
  
      setPotSize(newPotSize);
  
      // ✅ Clipboard copy happens here with updated pot
      if (action === "Call" && fullText) {
        const effectiveStack = Math.min(
          ...spiralPositionOrder
            .filter(pos => alivePlayers[pos])
            .map(pos => {
              const stack = plateData[fileName]?.bb ?? 0;
              const bet = playerBets[pos] ?? 0;
              return stack - bet;
            })
        );
        const adjustedText = fullText
          .replace(/#Pot#\d+/, `#Pot#${(newPotSize * 100).toFixed(0)}`)
          .replace(/#EffectiveStacks#\d+/, `#EffectiveStacks#${Math.round(effectiveStack * 100)}`);
        navigator.clipboard.writeText(adjustedText);
      }
  
      const newLine = ["Root"];
      for (const part of parts) {
        if (part !== "root") {
          newLine.push(numberToActionMap[part]);
        }
      }
      newLine.push(action);
      setPreflopLine(newLine);
  
      if (
        newLoadedPlates.length === loadedPlates.length &&
        newLoadedPlates.every((val, idx) => val === loadedPlates[idx])
      ) {
        return;
      }
  
      setLoadedPlates(newLoadedPlates);
      setRandomFillEnabled(false);
      setPlateMapping((prev) => {
        const filtered: Record<string, string> = {};
        Object.keys(prev).forEach((pos) => {
          filtered[pos] = prev[pos];
        });
        return filtered;
      });
    },
    [loadedPlates, appendPlateNames, availableJsonFiles, spiralPositionOrder, playerCount, playerBets, plateData, potSize, positionOrder, lastRangePos, lastRange, alivePlayers]
  );

  const handleLineClick = useCallback((clickedIndex: number) => {
    const trimmedLine = preflopLine.slice(0, clickedIndex + 1);
    setPreflopLine(trimmedLine);
    //console.log(trimmedLine);
    const initialAlive: Record<string, boolean> = {};
    const positions = playerCount === 8
      ? ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"]
      : playerCount === 6
        ? ["SB", "BB", "LJ", "HJ", "CO", "BTN"]
        : playerCount === 2
          ? ["BB", "BTN"]
          : Object.keys(plateMapping);
    positions.forEach((pos) => {
      initialAlive[pos] = true;
    });
  
    if (clickedIndex === 0 || clickedIndex === 1 || trimmedLine[clickedIndex] === "Fold") {
      setAlivePlayers(initialAlive);
      const resetBets: Record<string, number> = {};
      if (playerCount === 2) {
        resetBets["BTN"] = 0.5;
        resetBets["BB"] = 1;
      } else {
        resetBets["SB"] = 0.5;
        resetBets["BB"] = 1;
      }

      // Add ante once (not per player)
      const ante = metadata.ante;
      const pot = Object.values(resetBets).reduce((sum, b) => sum + b, 0) + ante;

      setPlayerBets(resetBets);
      setPotSize(pot);
      if (playerCount === 8) {
        setPlateMapping({
          "UTG": "root.json", 
          "UTG1": "0.json", 
          "LJ": "0.0.json", 
          "HJ": "0.0.0.json",
          "CO": "0.0.0.0.json", 
          "BTN": "0.0.0.0.0.json", 
          "SB": "0.0.0.0.0.0.json", 
          "BB": "0.0.0.0.0.0.1.json"
        });
      } else if (playerCount === 6) {
        setPlateMapping({
          "LJ": "root.json", 
          "HJ": "0.json", 
          "CO": "0.0.json", 
          "BTN": "0.0.0.json",
          "SB": "0.0.0.0.json", 
          "BB": "0.0.0.0.1.json"
        });
      } else if (playerCount === 2) {
        setPlateMapping({
          "BTN": "root.json", 
          "BB": "1.json"
        });
      }
    } else {
      const fileNamePart = trimmedLine.slice(1, clickedIndex)
        .map((action) => actionToNumberMap[action])
        .join('.');
      const computedFileName = fileNamePart + '.json';
  
      handleActionClick(trimmedLine[clickedIndex], computedFileName);
      
      setPlateMapping((prev) => ({
        ...prev,
        [plateData[computedFileName].Position]: computedFileName,
      }));
    }
  
    setRandomFillEnabled(false);
  }, [preflopLine, playerCount, plateMapping, metadata.ante, handleActionClick, plateData]);
  
  
  useKeyboardShortcuts({
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });
  
  // useEffect(() => {
  //   console.log("players: ", playerCount,
  //     "Plate States Updated:", { loadedPlates, plateMapping, plateData });
  // // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [loadedPlates, plateMapping, plateData]);
  
  const [randomFillEnabled, setRandomFillEnabled] = useState(false);
  const [isSpiralView, setIsSpiralView] = useState(true);
  
  return (
    <Layout>
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled(prev => !prev)}
        folders={folders}
        currentFolder={folder}
        onFolderSelect={handleFolderSelect}
        toggleViewMode={() => setIsSpiralView(prev => !prev)}
        isSpiralView={isSpiralView}
      />
      <div className="pt-13 p-1 flex-grow">
        {(folderError || filesError) && (
          <div className="text-red-500">{folderError || filesError}</div>
        )}
        {displayPlates.some((plate) => plate !== "") && (
          <Line 
            line={preflopLine} 
            onLineClick={(index) => handleLineClick(index)} 
          />
        )}
  
      <PlateGrid
        files={displayPlates}
        positions={positionOrder}
        selectedFolder={folder}
        isSpiralView={isSpiralView}
        randomFillEnabled={randomFillEnabled}
        onActionClick={handleActionClick}
        windowWidth={windowWidth}
        windowHeight={windowHeight}
        plateData={plateData}
        loading={loading}
        alivePlayers={alivePlayers}
        playerBets={playerBets} // ✅ Pass this down
        isICMSim={isICMSim}
      />

        {metadata && (
          <div className="text-sm mt-1 mb-2 text-center text-gray-600">
            {metadata.name && <div><strong>Sim:</strong> {metadata.name}</div>}
            <div><strong>Ante:</strong> {metadata.ante}</div>
            <div><strong>Pot:</strong> {potSize.toFixed(2)} bb</div>
            {Array.isArray(metadata.icm) && metadata.icm.length > 0 ? (
              <div><strong>ICM Structure:</strong> {metadata.icm.join(", ")}</div>
            ) : (
              <div><strong>ICM:</strong> None</div>
            )}
          </div>
        )}

      </div>
      {/* Render InstructionBox outside the PlateGrid container */}
      {displayPlates.some((plate) => plate !== "") && (
        <div style={{ position: "fixed", zIndex: 1000}}>
          <InstructionBox>
            <h2 className="text-lg font-bold mb-2">Instructions</h2>
            <p className="text-sm lg:text-md">
              Use the navigation bar above to choose a preflop Sim.<br />
              Click on an action (other than fold) to view the reactions to an action.<br />
              Click on the 'Line' buttons at the top of the page to either reset the tree or go back to a certain action.
            </p>
          </InstructionBox>
        </div>
      )}
      <div className="text-center select-none pt-5">© Josh Garber 2025</div>
    </Layout>
  );  
};

export default Solver;
