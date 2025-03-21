// src/components/Main.tsx
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
import useHistoryState from "../hooks/useHistoryState";

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();
  const { pushHistoryState } = useHistoryState();

  const { folders, selectedFolder, setSelectedFolder, error: folderError } =
    useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(
    API_BASE_URL,
    selectedFolder
  );

  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  // Determine plateCount based on the selected folder.
  const plateCount = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length : 1;
  }, [selectedFolder]);

  // Compute the default plate names based solely on plateCount.
  const defaultPlateNames = useMemo((): string[] => {
    const filesArray: string[] = [];
    for (let i = 0; i < plateCount - 1; i++) {
      const fileName = i === 0 ? "root.json" : Array(i).fill("0").join(".") + ".json";
      filesArray.push(fileName);
    }
    if (plateCount > 1) {
      const zeros = Array(plateCount - 1).fill("0");
      zeros[zeros.length - 1] = "1"; // Replace last "0" with "1"
      const extraFile = zeros.join(".") + ".json";
      filesArray.push(extraFile);
    }
    return filesArray;
  }, [plateCount]);

  const [loadedPlates, setLoadedPlates] = useState<string[]>(defaultPlateNames);
  const fetchedPlatesRef = useRef<Set<string>>(new Set());
  const [plateMapping, setPlateMapping] = useState<Record<string, string>>({});

  // Compute a fixed position order if plateCount is 8; otherwise, use the keys of plateMapping.
  const positionOrder = useMemo(() => {
    if (plateCount === 8) {
      return ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    }
    return Object.keys(plateMapping);
  }, [plateCount, plateMapping]);

  // Derive displayPlates from the fixed position order.
  const [displayPlates, setDisplayPlates] = useState<string[]>([]);
  useEffect(() => {
    setDisplayPlates(positionOrder.map((pos) => plateMapping[pos] || ""));
  }, [plateMapping, positionOrder]);

  // Reset loadedPlates, plateMapping, and fetchedPlates when plateCount changes.
  useEffect(() => {
    setLoadedPlates(defaultPlateNames);
    setPlateMapping({});
    fetchedPlatesRef.current = new Set();
  }, [defaultPlateNames]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        const { clickedRoot, folder, matrixFiles } = event.state;
        // Restore folder and other states from history
        setSelectedFolder(folder);
        setClickedRoot(clickedRoot);
        setLoadedPlates(matrixFiles || defaultPlateNames);
        // If needed, you can also update plateMapping or trigger fetching of new data here.
      }
    };
  
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [defaultPlateNames, setSelectedFolder]);
  

  // Append new plate names if they don't already exist.
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
      const baseName = prefix === "root" ? `${actionNumber}` : `${prefix}.${actionNumber}`;
      const newFiles: string[] = [];
      const baseFileName = `${baseName}.json`;
      availableFiles.forEach((file) => {
        if (file === baseFileName && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      const pattern = `^${baseName}(?:\\.0)+\\.json$`;
      const regex = new RegExp(pattern);
      availableFiles.forEach((file) => {
        if (regex.test(file) && !currentFiles.includes(file)) {
          newFiles.push(file);
        }
      });
      console.log(newFiles, currentFiles)
      return [...currentFiles, ...newFiles];
    },
    []
  );

  // Fetch position data for each plate in loadedPlates that hasn't been fetched yet.
  useEffect(() => {
    if (selectedFolder && loadedPlates.length > 0) {
      loadedPlates.forEach((plate) => {
        if (!fetchedPlatesRef.current.has(plate) && selectedFolder !== "") {
          axios
            .get(`${API_BASE_URL}/api/Files/${selectedFolder}/${plate}`)
            .then((response) => {
              const pos = response.data.Position;
              console.log(`Fetched Position for ${plate}:`, pos);
              setPlateMapping((prev) => ({ ...prev, [pos]: plate }));
              fetchedPlatesRef.current.add(plate);
            })
            .catch((err) => {
              console.error(`Error fetching ${plate} data:`, err);
            });
        }
      });
    }
  }, [loadedPlates, selectedFolder, API_BASE_URL]);

  // Handle plate action clicks.
  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);
      if (clickedIndex === -1) return;
  
      const updatedPlates = appendPlateNames(
        loadedPlates,
        clickedIndex,
        newValue,
        availableJsonFiles
      );
  
      const newlyAddedPlates = updatedPlates.slice(loadedPlates.length);
      newlyAddedPlates.forEach((newPlate) => {
        if (!fetchedPlatesRef.current.has(newPlate)) {
          axios
            .get(`${API_BASE_URL}/api/Files/${selectedFolder}/${newPlate}`)
            .then((response) => {
              const pos = response.data.Position;
              setPlateMapping((prev) => ({ ...prev, [pos]: newPlate }));
              fetchedPlatesRef.current.add(newPlate);
            })
            .catch((err) => {
              console.error(`Error fetching ${newPlate} data:`, err);
            });
        }
      });
  
      setLoadedPlates(updatedPlates);
      setClickedRoot(plateName.replace(".json", ""));
      
      // Push new state including the clicked root and current loaded plates
      pushHistoryState(
        plateName.replace(".json", ""),
        plateName.replace(".json", ""),
        selectedFolder,
        updatedPlates
      );
    },
    [loadedPlates, appendPlateNames, availableJsonFiles, selectedFolder, API_BASE_URL, pushHistoryState]
  );
  

  const handleFolderSelect = useCallback(
    (folder: string) => {
      if (folder === selectedFolder) {
        setSelectedFolder("");
        setTimeout(() => {
          setSelectedFolder(folder);
          setClickedRoot("");
          setLoadedPlates(defaultPlateNames);
          setPlateMapping({});
          fetchedPlatesRef.current = new Set();
          // Push new state with cleared clickedRoot and default plates
          pushHistoryState("", "", folder, defaultPlateNames);
        }, 0);
      } else {
        setSelectedFolder(folder);
        setClickedRoot("");
        setLoadedPlates(defaultPlateNames);
        setPlateMapping({});
        fetchedPlatesRef.current = new Set();
        // Push new state when a new folder is selected
        pushHistoryState("", "", folder, defaultPlateNames);
      }
    },
    [selectedFolder, defaultPlateNames, setSelectedFolder, pushHistoryState]
  );
  

  // Keyboard shortcuts.
  useKeyboardShortcuts({
    onBackspace: () => {
      if (clickedRoot) {
        setClickedRoot("");
        setLoadedPlates(defaultPlateNames);
        setPlateMapping({});
        fetchedPlatesRef.current = new Set();
      }
    },
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev)
  });

  const toggleViewMode = useCallback(() => {
    setIsSpiralView((prev) => !prev);
  }, []);

  return (
    <Layout>
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
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
        />
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default Main;
