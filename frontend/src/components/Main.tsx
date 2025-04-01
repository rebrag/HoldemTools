import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToPrefixMap, actionToPrefixMap2 } from "../constants";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";
import axios from "axios";
import { JsonData } from "../utils/utils";
import InstructionBox from "./InstructionBox";

interface LocationState {
  folder: string;
  plateData: Record<string, JsonData>;
  loadedPlates?: string[];
  plateMapping?: Record<string, string>;
  refresh?: number;
}

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth, windowHeight } = useWindowDimensions();
  const navigate = useNavigate();
  const location = useLocation();
  const initialState = (location.state as LocationState) || { folder: "", plateData: {} };
  const [folder, setFolder] = useState<string>(initialState.folder);
  const [plateData, setPlateData] = useState<Record<string, JsonData>>(initialState.plateData);
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>(initialState.plateMapping || {});
  const [lastRange, setLastRange] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const initialLoadedPlates = initialState.loadedPlates;

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

  const [loadedPlates, setLoadedPlates] = useState<string[]>(initialLoadedPlates || defaultPlateNames);

  const folderRef = useRef(folder);
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, folder);

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return [ "SB", "BB", "UTG", "UTG1", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 6) return ["SB", "BB", "LJ", "HJ", "CO", "BTN"];
    if (playerCount === 2) return ["BB","BTN"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

  const displayPlates = useMemo(
    () => positionOrder.map((pos) => plateMapping[pos] || ""),
    [plateMapping, positionOrder]
  );

  useLayoutEffect(() => {
    setLoadedPlates(defaultPlateNames);
    setPlateMapping({});
    setPlateData({});
  }, [folder, defaultPlateNames]);

  useEffect(() => {
    console.log(Object.keys(plateData).length, "location.state:", location.state);
    setRandomFillEnabled(false)
    if (location.state) {
      const {
        folder: newFolder,
        plateData: newPlateData,
        loadedPlates: newLoadedPlates,
        plateMapping: newPlateMapping,
      } = location.state as LocationState;
      if (newFolder) setFolder(newFolder);
      if (newPlateData !== undefined) setPlateData(newPlateData);
      if (newLoadedPlates !== undefined) setLoadedPlates(newLoadedPlates);
      if (newPlateMapping !== undefined) setPlateMapping(newPlateMapping);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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

  useEffect(() => {
    const platesToFetch = loadedPlates.filter((plate) => !(plate in plateData));
    if (platesToFetch.length === 0) {
      setLoading(false);
      return;
    }
    
    let didTimeout = false;
    // Start a timer for 300ms. If the fetch takes longer than 400ms, we set loading to true.
    const timer = setTimeout(() => {
      didTimeout = true;
      setLoading(true);
    }, 400);
  
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
        }
      })
      .finally(() => {
        clearTimeout(timer);
        // Only clear the loading state if it was turned on.
        if (didTimeout) {
          //console.log("fetching finished");
          setLoading(false);
        }
      });
    
    return () => source.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedPlates, folder]);
  
  const lastNavigatedState = useRef<LocationState | null>(null);
  useEffect(() => {
    const newState: LocationState = { folder, plateData, loadedPlates, plateMapping };
    if (
      Object.keys(plateData).length > 0 &&
      JSON.stringify(lastNavigatedState.current) !== JSON.stringify(newState)
    ) {
      lastNavigatedState.current = newState;
      navigate(".", { state: newState, replace: true });
    }
  }, [plateData, plateMapping, loadedPlates, folder, navigate]);

  const validStateHistory = useRef<LocationState[]>([]);
  useEffect(() => {
    if (
      location.state &&
      (location.state as LocationState).plateData &&
      Object.keys((location.state as LocationState).plateData).length > 0
    ) {
      validStateHistory.current.push(location.state as LocationState);
    }
  }, [location.state]);

  const handleFolderSelect = useCallback(
    (selectedFolder: string) => {
      const newLoadedPlates = defaultPlateNames;
      setLoadedPlates(newLoadedPlates);
      setPlateData({});
      setPlateMapping({});
      navigate(".", {
        state: {
          folder: selectedFolder,
          plateData: {},
          loadedPlates: newLoadedPlates,
          plateMapping: {},
          refresh: Date.now(),
        },
      });
      setRandomFillEnabled(false);
    },
    [defaultPlateNames, navigate]
  );

  // const prefixToActionMap = Object.fromEntries(
  //   Object.entries(actionToPrefixMap).map(([action, prefix]) => [prefix, action])
  // );
  
  const convertRangeText = (data: JsonData | undefined, action: string): string => {
    if (!data) return "";
    // Look up the proper key in your JSON data using the inverse mapping.
    // If the mapping isn't available for the provided action, default to the action itself.
    const dataKey = actionToPrefixMap2[action] || action;
    //console.log("dataKey:", dataKey)
    if (!data[dataKey]) return "";
  
    return Object.entries(data[dataKey])
      .map(([hand, values]) => `${hand}:${values[0]}`)
      .join(",");
  };
  

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      //console.log("fileName:", fileName,"action:", action)
      if (action === "Call") {
        // Suppose your plateData for BB has the width and hand information
        const callData = plateData[fileName];
        const range0 = convertRangeText(callData, action);
        const range1 = lastRange || ""
  
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
            console.log("Text copied to clipboard!");
          })
          .catch((err) => {
            console.error("Failed to copy text: ", err);
          });
      }

      // For actions other than "Call" or "ALLIN", update the lastRange.
      if (action !== "Call" && action !== "ALLIN") {
        const raiseData = plateData[fileName];
        const currentRange = convertRangeText(raiseData, action);
        if (currentRange) {
          setLastRange(currentRange);
        }
      }
  
      // Existing logic for other actions...
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      const newLoadedPlates = appendPlateNames(loadedPlates, clickedIndex, newValue, availableJsonFiles);
  
      if (
        newLoadedPlates.length === loadedPlates.length &&
        newLoadedPlates.every((val, idx) => val === loadedPlates[idx])
      ) {
        return;
      }
  
      setLoadedPlates(newLoadedPlates);
      setRandomFillEnabled(false)
      navigate(".", { state: { folder, plateData, loadedPlates: newLoadedPlates, plateMapping } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedPlates, availableJsonFiles, folder, plateData, plateMapping, navigate]
  );
  

  const appendPlateNames = useCallback(
    (currentFiles: string[], clickedIndex: number, actionNumber: string, availableFiles: string[]): string[] => {
      const clickedFile = currentFiles[clickedIndex];
      if (!clickedFile) return currentFiles;
      const prefix = clickedFile.replace(".json", "");
      const baseName = prefix === "root" ? actionNumber : `${prefix}.${actionNumber}`;
      const newFiles: string[] = [];
      const baseFileName = `${baseName}.json`;
      availableFiles.forEach((file) => {
        if (file === baseFileName && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      //console.log(prefix, actionNumber)
      const regex = new RegExp(`^${baseName}(?:\\.0)+\\.json$`);
      availableFiles.forEach((file) => {
        if (regex.test(file) && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      return [...currentFiles, ...newFiles];
    },
    []
  );



  useKeyboardShortcuts({
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });

  useEffect(() => {
    //console.log("Plate States Updated:", { loadedPlates, plateMapping, plateData });
  }, [loadedPlates, plateMapping, plateData]);

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
        <PlateGrid
          files={displayPlates}
          selectedFolder={folder}
          isSpiralView={isSpiralView}
          randomFillEnabled={randomFillEnabled}
          onActionClick={handleActionClick}
          windowWidth={windowWidth}
          windowHeight={windowHeight} // Passing the windowHeight prop
          plateData={(location.state as LocationState)?.plateData}
          loading={loading} // Pass the loading prop here
        />
        {/* Only show the InstructionBox if there is at least one non-empty plate */}
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
      <footer className="text-center select-none pt-5">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default Main;
