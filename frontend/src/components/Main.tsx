import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
//import { useLocation } from "react-router-dom";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToNumberMap, actionToPrefixMap2, numberToActionMap } from "../utils/constants";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";
import axios from "axios";
import { JsonData } from "../utils/utils";
import InstructionBox from "./InstructionBox";
import Line from "./Line";

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth, windowHeight } = useWindowDimensions();
  const [folder, setFolder] = useState<string>("20BTN_20BB");
  const [plateData, setPlateData] = useState<Record<string, JsonData>>({});
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});
  const [lastRange, setLastRange] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [preflopLine, setPreflopLine] = useState<string[]>(["Root"]);
  const playerCount = useMemo(() => (folder ? folder.split("_").length : 1), [folder]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);
  

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, folder);

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return ["SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 6) return ["SB", "BB", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 2) return ["BB", "BTN"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

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
    }, 500);
  
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
    },
    [defaultPlateNames]
  );

  const convertRangeText = (data: JsonData | undefined, action: string): string => {
    if (!data) return "";
    const dataKey = actionToPrefixMap2[action] || action;
    if (!data[dataKey]) return "";
    return Object.entries(data[dataKey])
      .map(([hand, values]) => `${hand}:${values[0]}`)
      .join(",");
  };

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      // console.log(fileName, "handleActionClick: ", action, "numToAction:",numberToActionMap[action], 
      //   "actionToNum:",actionToNumberMap[action])
      if (action === "Call") {
        const callData = plateData[fileName];
        const range0 = convertRangeText(callData, action);
        const range1 = lastRange || "";
        const fullText = `#Type#NoLimit
        #Range0#${range0}
        #Range1#${range1}
        #ICM.ICMFormat#Pio ICM structure
        #ICM.Payouts#16800\\n9200\\n4900\\n2800\\n1450\\n1226\\n1022\\n920\\n817\\n613\\n613\\n613\\n613\\n587\\n562\\n562\\n562\\n562
        #ICM.Stacks#1800\\n1800\\n6000\\n4000\\n3000\\n2600\\n2500\\n2500\\n2300\\n2300\\n2200\\n1800\\n1600\\n1400\\n1200\\n1000\\n800\\n500
        #Pot#550
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
        navigator.clipboard.writeText(fullText)
          .then(() => {
            // console.log("Text copied to clipboard!");
          });
      }
      else if (action !== "Call" && action !== "ALLIN") {
        const raiseData = plateData[fileName];
        const currentRange = convertRangeText(raiseData, action);
        if (currentRange) {
          setLastRange(currentRange);
        }
      }
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const actionNumber = actionToNumberMap[action]; //|| action
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      const newLoadedPlates = appendPlateNames(loadedPlates, clickedIndex, actionNumber, availableJsonFiles);
      
      setPreflopLine(() => {
        const parts = fileName.replace(".json", "").split(".");
        const newLine = ["Root"];
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] !== 'root') {
            newLine.push(numberToActionMap[parts[i]]);
          }
        }
        newLine.push(action);
        //console.log(newLine);
        return newLine;
      });
      

      // Only update state if there is a change.
      if (
        newLoadedPlates.length === loadedPlates.length &&
        newLoadedPlates.every((val, idx) => val === loadedPlates[idx])
      ) {return;}
      setLoadedPlates(newLoadedPlates);
      setRandomFillEnabled(false);
      setPlateMapping((prev) => {
        const filtered: Record<string, string> = {};
        Object.keys(prev).forEach((pos) => {
          //if (loadedPlates.includes(prev[pos])) {
            filtered[pos] = prev[pos];
          //}
        });
        return filtered;
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedPlates, availableJsonFiles, folder, plateData, plateMapping, lastRange]
  );

  const handleLineClick = useCallback(() => {
    //console.log("handleLineClick action:")
    if (playerCount === 8){
    setPlateMapping({"UTG": "root.json", "UTG1": "0.json", "LJ": "0.0.json", "HJ": "0.0.0.json", "CO": "0.0.0.0.json", "BTN": "0.0.0.0.0.json"
      ,"SB": "0.0.0.0.0.0.json", "BB": "0.0.0.0.0.0.1.json"
    })} else if (playerCount === 6) {
      setPlateMapping({"LJ": "root.json", "HJ": "0.json", "CO": "0.0.json", "BTN": "0.0.0.json"
        ,"SB": "0.0.0.0.json", "BB": "0.0.0.0.1.json"
      })}else if (playerCount === 2) {
        setPlateMapping({"BTN": "root.json", "BB": "1.json"})}
    
    setPreflopLine(["Root"]);
    setRandomFillEnabled(false);
  }, [playerCount]);
  
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
        if (file === baseFileName) { // && !currentFiles.includes(file)
          newFilesWider.push(file);
        }
      });
      availableFiles.forEach((file) => {
        if (regex.test(file)) { // && !currentFiles.includes(file)
          newFilesWider.push(file);
        }
      });

      // doing things with the new files from the regex after the clicked file
      newFilesWider.forEach((file) => {
        //const position = plateData[file]?.Position;
        //console.log(`File: ${file}, Position: ${position}`);
        
        plateMapping[plateData[file]?.Position] = file
        setPlateMapping((prev) => ({ ...prev, [plateData[file]?.Position]: file }));
      });
      
      //console.log("newFiles:", newFiles, "newFilesWider:", newFilesWider, "plateMapping", plateMapping); //, "plateMapping", plateMapping
      return [...currentFiles, ...newFiles];
    },
    [plateData, plateMapping]
  );
  
  
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
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
        folders={folders}
        currentFolder={folder}
        onFolderSelect={handleFolderSelect}
        toggleViewMode={() => setIsSpiralView((prev) => !prev)}
        isSpiralView={isSpiralView}
      />
      <div className="pt-13 p-1 flex-grow">
        {(folderError || filesError) && (
          <div className="text-red-500">{folderError || filesError}</div>
        )}
        <Line line={preflopLine} onLineClick={handleLineClick} />
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
        />
        {displayPlates.some((plate) => plate !== "") && (
          <InstructionBox>
            <h2 className="text-lg font-bold mb-2">Instructions</h2>
            <p>
              Click on an action (other than fold) to view the reactions to an action.
              Use the navigation bar above to choose a preflop Sim.
            </p>
          </InstructionBox>
        )}
      </div>
      <div className="text-center select-none pt-5">© Josh Garber 2025</div>
    </Layout>
  );
};

export default Main;
