import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
  const { folders, selectedFolder, setSelectedFolder, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [clickedRoot, setClickedRoot] = useState("");
  const [randomFillEnabled, setRandomFillEnabled] = useState(false);
  const [isSpiralView, setIsSpiralView] = useState(true);

  const playerCount = useMemo(() => selectedFolder ? selectedFolder.split("_").length : 1, [selectedFolder]);

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
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});
  const [plateData, setPlateData] = useState<Record<string, JsonData>>({});
  const fetchedPlatesRef = useRef<Set<string>>(new Set());

  const positionOrder = useMemo(() => {
    if (playerCount === 8) return ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    if (playerCount === 6) return ["LJ", "HJ", "CO", "BTN", "SB", "BB"];
    return Object.keys(plateMapping);
  }, [playerCount, plateMapping]);

  const [displayPlates, setDisplayPlates] = useState<string[]>([]);
  useEffect(() => {
    setDisplayPlates(positionOrder.map(pos => plateMapping[pos] || ""));
  }, [plateMapping, positionOrder]);

  

  // Centralized reset function for plate state.
  const resetPlateState = useCallback(() => {
    setLoadedPlates(defaultPlateNames);
    setPlateMapping({});
    setPlateData({});
    fetchedPlatesRef.current = new Set();
  }, [defaultPlateNames]);

  // Debug logs.
  useEffect(() => {
    console.log("loadedPlates:", loadedPlates);
    console.log("displayPlates:", displayPlates);
  }, [loadedPlates, displayPlates]);

  // Reset states when defaultPlateNames changes.
  useEffect(() => {
    resetPlateState();
  }, [defaultPlateNames, resetPlateState]);

  // Fetch plate data.
  useEffect(() => {
    if (selectedFolder && loadedPlates.length) {
      // Filter plates that haven't been fetched yet.
      const platesToFetch = loadedPlates.filter(
        (plate) => !fetchedPlatesRef.current.has(plate)
      );
  
      // Create an array of promises for each plate fetch.
      Promise.all(
        platesToFetch.map((plate) =>
          axios
            .get(`${API_BASE_URL}/api/Files/${selectedFolder}/${plate}`)
            .then((response) => ({ plate, data: response.data }))
            .catch((error) => {
              console.error(`Error fetching ${plate}:`, error);
              return null;
            })
        )
      ).then((results) => {
        // Filter out any failed requests.
        const validResults = results.filter((result) => result !== null);
        const newPlateData: Record<string, JsonData> = {};
        const newPlateMapping: Record<string, string> = {};
  
        validResults.forEach(({ plate, data }) => {
          newPlateData[plate] = data;
          newPlateMapping[data.Position] = plate;
          fetchedPlatesRef.current.add(plate);
        });
  
        // Update the state in one go.
        setPlateData((prev) => ({ ...prev, ...newPlateData }));
        setPlateMapping((prev) => ({ ...prev, ...newPlateMapping }));
      });
    }
  }, [loadedPlates, selectedFolder, API_BASE_URL]);
  

  const appendPlateNames = useCallback((currentFiles: string[], clickedIndex: number, actionNumber: string, availableFiles: string[]): string[] => {
    const clickedFile = currentFiles[clickedIndex];
    if (!clickedFile) return currentFiles;

    const prefix = clickedFile.replace(".json", "");
    const baseName = prefix === "root" ? actionNumber : `${prefix}.${actionNumber}`;
    const newFiles: string[] = [];
    const baseFileName = `${baseName}.json`;

    availableFiles.forEach(file => {
      if (file === baseFileName && !currentFiles.includes(file)) newFiles.push(file);
    });
    const regex = new RegExp(`^${baseName}(?:\\.0)+\\.json$`);
    availableFiles.forEach(file => {
      if (regex.test(file) && !currentFiles.includes(file)) newFiles.push(file);
    });
    return [...currentFiles, ...newFiles];
  }, []);

  const handleActionClick = useCallback((action: string, fileName: string) => {
    const plateName = loadedPlates.find(name => name === fileName);
    if (!plateName) return;
    const newValue = actionToPrefixMap[action] || action;
    const clickedIndex = loadedPlates.findIndex(name => name === plateName);
    if (clickedIndex === -1) return;

    // Update plates and simulate navigation.
    setLoadedPlates(appendPlateNames(loadedPlates, clickedIndex, newValue, availableJsonFiles));
    setClickedRoot(plateName.replace(".json", ""));
    
    // Push a new state so the browser back button becomes active.
    window.history.pushState(null, "", window.location.href);
  }, [loadedPlates, appendPlateNames, availableJsonFiles]);

  const handleFolderSelect = useCallback((folder: string) => {
    if (folder === selectedFolder) {
      setSelectedFolder("");
      setTimeout(() => {
        setSelectedFolder(folder);
        setClickedRoot("");
        resetPlateState();
      }, 0);
    } else {
      setSelectedFolder(folder);
      setClickedRoot("");
      resetPlateState();
    }
  }, [selectedFolder, setSelectedFolder, resetPlateState]);

  // Keyboard shortcuts.
  useKeyboardShortcuts({
    onBackspace: () => {
      if (clickedRoot) {
        setClickedRoot("");
        resetPlateState();
      }
    },
    onToggleRandom: () => setRandomFillEnabled(prev => !prev)
  });

  // Listen for browser back button (popstate event) and trigger backspace functionality.
  useEffect(() => {
    const handlePopState = () => {
      if (clickedRoot) {
        setClickedRoot("");
        resetPlateState();
      }
      // Optionally, push state again if you don't want to leave the page:
      window.history.pushState(null, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    // Push an initial state so the back button is available.
    window.history.pushState(null, "", window.location.href);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [clickedRoot, resetPlateState]);

  const toggleViewMode = useCallback(() => setIsSpiralView(prev => !prev), []);

  return (
    <Layout>
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled(prev => !prev)}
        folders={folders}
        onFolderSelect={handleFolderSelect}
        toggleViewMode={toggleViewMode}
        isSpiralView={isSpiralView}
      />
      <div className="pt-13 p-1 flex-grow">
        {(folderError || filesError) && (
          <div className="text-red-500">{folderError || filesError}</div>
        )}
        <PlateGrid
          files={displayPlates}
          selectedFolder={selectedFolder}
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
