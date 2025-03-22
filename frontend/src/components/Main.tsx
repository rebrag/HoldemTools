import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  const navigate = useNavigate();
  const location = useLocation();
  // Retrieve state passed via navigate; if not present, use default values.
  const initialFolder = location.state?.folder || "";
  const initialLoadedPlates = location.state?.loadedPlates;

  // Compute player count from the selected folder.
  const playerCount = useMemo(
    () => (initialFolder ? initialFolder.split("_").length : 1),
    [initialFolder]
  );

  // Compute default plate names based on player count.
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

  // Use initialLoadedPlates from history if available; otherwise, use the defaults.
  const [loadedPlates, setLoadedPlates] = useState<string[]>(initialLoadedPlates || defaultPlateNames);
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});
  const [plateData, setPlateData] = useState<Record<string, JsonData>>({});
  const fetchedPlatesRef = useRef<Set<string>>(new Set());

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, initialFolder);

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    if (playerCount === 6) return ["LJ", "HJ", "CO", "BTN", "SB", "BB"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

  const displayPlates = useMemo(
    () => positionOrder.map((pos) => plateMapping[pos] || ""),
    [plateMapping, positionOrder]
  );

  const resetPlateState = useCallback(() => {
    setLoadedPlates(defaultPlateNames);
    setPlateMapping({});
    setPlateData({});
    fetchedPlatesRef.current.clear();
  }, [defaultPlateNames]);

  // When location.state changes (e.g. via back navigation), update internal state.
  useEffect(() => {
    if (location.state) {
      if (location.state.loadedPlates) {
        setLoadedPlates(location.state.loadedPlates);
      } else {
        resetPlateState();
      }
    }
  }, [location.state, resetPlateState]);

  // When loadedPlates changes, filter plateMapping so that only plates in loadedPlates remain.
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

  // Helper function for appending plate names.
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

  // Reset the plate state when the folder changes.
  useEffect(() => {
    resetPlateState();
  }, [initialFolder, resetPlateState]);

  // Fetch plate data from the API (without using fetchedPlatesRef)
useEffect(() => {
  const source = axios.CancelToken.source();

  Promise.all(
    loadedPlates.map((plate) =>
      axios
        .get(`${API_BASE_URL}/api/Files/${initialFolder}/${plate}`, { cancelToken: source.token })
        .then((res) => ({ plate, data: res.data }))
        .catch(() => null)
    )
  ).then((results) => {
    const validResults = results.filter((r): r is { plate: string; data: JsonData } => r !== null);
    if (!validResults.length) return;

    const newPlateData: Record<string, JsonData> = {};
    const newPlateMapping: Record<string, string> = {};

    validResults.forEach(({ plate, data }) => {
      newPlateData[plate] = data;
      newPlateMapping[data.Position] = plate;
    });

    setPlateData((prev) => ({ ...prev, ...newPlateData }));
    setPlateMapping((prev) => ({ ...prev, ...newPlateMapping }));
  });

  return () => source.cancel();
}, [loadedPlates, initialFolder, API_BASE_URL]);


  // When a folder is selected, push a new navigation state with the default plate names.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      navigate(".", { state: { folder, loadedPlates: defaultPlateNames } });
    },
    [navigate, defaultPlateNames]
  );

  // When an action is clicked, update the loadedPlates and push the new state.
  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);

      const newLoadedPlates = appendPlateNames(loadedPlates, clickedIndex, newValue, availableJsonFiles);
      setLoadedPlates(newLoadedPlates);

      // Build a root value that includes the newValue appended after the original file name (without ".json").
      const rootValue = `${plateName.replace(".json", "")}.${newValue}`;
      navigate(".", { state: { folder: initialFolder, root: rootValue, loadedPlates: newLoadedPlates } });
    },
    [loadedPlates, navigate, initialFolder, appendPlateNames, availableJsonFiles]
  );

  // For backspace or back navigation, simply call navigate(-1) so that the previous navigation state is restored.
  useKeyboardShortcuts({
    onBackspace: () => {
      navigate(-1);
    },
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });

  // Console logging for plate states
  // useEffect(() => {
  //   console.log("Plate States Updated:", {
  //     loadedPlates,
  //     plateMapping,
  //   });
  // }, [loadedPlates, plateMapping, plateData]);

  // Local state for toggling random fill and view mode.
  const [randomFillEnabled, setRandomFillEnabled] = useState(false);
  const [isSpiralView, setIsSpiralView] = useState(true);

  return (
    <Layout>
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
        folders={folders}
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
          selectedFolder={initialFolder}
          isSpiralView={isSpiralView}
          randomFillEnabled={randomFillEnabled}
          onActionClick={handleActionClick}
          windowWidth={windowWidth}
          plateData={plateData}
        />
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default Main;
