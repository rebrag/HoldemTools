import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFolder = searchParams.get("folder") || "";

  const { folders, error: folderError } = useFolders(API_BASE_URL);
  const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [randomFillEnabled, setRandomFillEnabled] = useState(false);
  const [isSpiralView, setIsSpiralView] = useState(true);

  const playerCount = useMemo(
    () => (selectedFolder ? selectedFolder.split("_").length : 1),
    [selectedFolder]
  );

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

  useEffect(() => {
    resetPlateState();
  }, [selectedFolder, resetPlateState]);

  useEffect(() => {
    const source = axios.CancelToken.source();

    const platesToFetch = loadedPlates.filter((plate) => !fetchedPlatesRef.current.has(plate));

    Promise.all(
      platesToFetch.map((plate) =>
        axios
          .get(`${API_BASE_URL}/api/Files/${selectedFolder}/${plate}`, { cancelToken: source.token })
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
        fetchedPlatesRef.current.add(plate);
      });

      setPlateData((prev) => ({ ...prev, ...newPlateData }));
      setPlateMapping((prev) => ({ ...prev, ...newPlateMapping }));
    });

    return () => source.cancel();
  }, [loadedPlates, selectedFolder, API_BASE_URL]);

  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSearchParams(folder ? { folder } : {});
    },
    [setSearchParams]
  );

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const plateName = loadedPlates.find((name) => name === fileName);
      if (!plateName) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((name) => name === plateName);

      setLoadedPlates((prev) => appendPlateNames(prev, clickedIndex, newValue, availableJsonFiles));
      setSearchParams({ folder: selectedFolder, root: plateName.replace(".json", "") });
    },
    [loadedPlates, setSearchParams, selectedFolder, appendPlateNames, availableJsonFiles]
  );

  useKeyboardShortcuts({
    onBackspace: () => {
      setSearchParams({ folder: selectedFolder });
    },
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });

  // Console logging for plate states
  useEffect(() => {
    console.log("Plate States Updated:", {
      loadedPlates,
      plateMapping,
    });
  }, [loadedPlates, plateMapping, plateData]);

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
        {(folderError || filesError) && <div className="text-red-500">{folderError || filesError}</div>}
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
