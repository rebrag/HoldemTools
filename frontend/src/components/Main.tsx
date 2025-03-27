import { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToPrefixMap } from "../constants";
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
  const initialLoadedPlates = initialState.loadedPlates;

  // Loading state for axios fetches
  const [loading, setLoading] = useState<boolean>(false);

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
  const fetchedPlatesRef = useRef<Set<string>>(new Set());

  const folderRef = useRef(folder);
  useEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, folder);

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    if (playerCount === 6) return ["LJ", "HJ", "CO", "BTN", "SB", "BB"];
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
    fetchedPlatesRef.current.clear();
  }, [folder, defaultPlateNames]);

  useEffect(() => {
    console.log(Object.keys(plateData).length, "location.state:", location.state);
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
    // Start a timer for 300ms. If the fetch takes longer than 300ms, we set loading to true.
    const timer = setTimeout(() => {
      didTimeout = true;
      setLoading(true);
    }, 300);
  
    const source = axios.CancelToken.source();
    console.log("axios plates (fetching):", platesToFetch);
    
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
          console.log("fetching finished");
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
    },
    [defaultPlateNames, navigate]
  );

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const newValue = actionToPrefixMap[action]; // || action
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      const newLoadedPlates = appendPlateNames(loadedPlates, clickedIndex, newValue, availableJsonFiles);

      if (
        newLoadedPlates.length === loadedPlates.length &&
        newLoadedPlates.every((val, idx) => val === loadedPlates[idx])
      ) {
        return;
      }

      setLoadedPlates(newLoadedPlates);
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

  const handleBack = useCallback(() => {
    let previousState: LocationState | null = null;
    while (validStateHistory.current.length) {
      const candidate = validStateHistory.current.pop();
      if (candidate && candidate.plateData && Object.keys(candidate.plateData).length > 0) {
        previousState = candidate;
        break;
      }
    }
    if (previousState) {
      navigate(".", { state: previousState });
    } else {
      navigate(-1);
    }
  }, [navigate]);

  useKeyboardShortcuts({
    onBackspace: handleBack,
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });

  useEffect(() => {
    console.log("Plate States Updated:", { loadedPlates, plateMapping, plateData });
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
