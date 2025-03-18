// src/components/MainApp.tsx
import { useState, useCallback, useEffect, useMemo } from "react";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToPrefixMap } from "../constants";
import useHistoryState from "../hooks/useHistoryState";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";

const MainApp = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  const { pushHistoryState } = useHistoryState();
  const { folders, selectedFolder, setSelectedFolder, error: folderError } = useFolders(API_BASE_URL, pushHistoryState);
  const { error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  // When the user clicks Back/Forward, restore state from history.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        const { rootPrefix, clickedRoot, folder } = event.state;
        if (typeof rootPrefix === "string") setRootPrefix(rootPrefix);
        if (typeof clickedRoot === "string") setClickedRoot(clickedRoot);
        if (typeof folder === "string") setSelectedFolder(folder);
        // if (matrixFiles) {
        //   setMatrixFiles(matrixFiles);
        // }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setRootPrefix, setClickedRoot, setSelectedFolder]);

  // Calculate plateCount based on the folder name.
  const plateCount = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length : 1;
  }, [selectedFolder]);

  // Compute the default matrix files from plateCount.
  const defaultMatrixFiles = useMemo(() => {
    const filesArray: string[] = [];
    for (let i = 0; i < plateCount - 1; i++) {
      if (i === 0) {
        filesArray.push("root.json");
      } else {
        // For i = 1, "0.json"; for i = 2, "0.0.json"; etc.
        const fileName = Array(i).fill("0").join(".") + ".json";
        filesArray.push(fileName);
      }
    }
    // Add the extra file for the last plate with a "1" at the end.
    if (plateCount > 1) {
      const zeros = Array(plateCount - 1).fill("0");
      zeros[zeros.length - 1] = "1"; // Replace last "0" with "1"
      const extraFile = zeros.join(".") + ".json";
      filesArray.push(extraFile);
    }
    return filesArray;
  }, [plateCount]);

  // Store matrixFiles in state so they can be updated.
  const [matrixFiles, setMatrixFiles] = useState<string[]>(defaultMatrixFiles);

  // When plateCount changes, reset matrixFiles.
  useEffect(() => {
    setMatrixFiles(defaultMatrixFiles);
  }, [defaultMatrixFiles]);

  // Helper to update matrix files from the clicked file onward.
  // If the clicked plate isn't the root, then prefix the new value to the clicked file's prefix.
  const updateMatrixFilesFn = (files: string[], clickedIndex: number, newValue: string): string[] => {
    const clickedPrefix = files[clickedIndex].replace(".json", "");
    // If clickedIndex is 0 (the root), then use newValue on its own.
    const basePrefix = clickedIndex === 0 ? newValue : `${clickedPrefix}.${newValue}`;
    
    const newFiles = files.slice(0, clickedIndex + 1);
    for (let i = clickedIndex + 1; i < files.length; i++) {
      const depth = i - clickedIndex - 1;
      const suffix = depth > 0 ? "." + Array(depth).fill("0").join(".") : "";
      newFiles.push(`${basePrefix}${suffix}.json`);
    }
    return newFiles;
  };

  // Callback passed to Plate components when a ColorKey action is clicked.
  // This updates the matrixFiles and also pushes the updated state (including matrixFiles) into history.
  const handleUpdateMatrixFiles = useCallback(
    (action: string, file: string) => {
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = matrixFiles.findIndex((f) => f === file);
      if (clickedIndex === -1) return;
      const updatedFiles = updateMatrixFilesFn(matrixFiles, clickedIndex, newValue);
      setMatrixFiles(updatedFiles);
      // Also push the new state into history.
      const clickedPrefix = file.replace(".json", "");
      pushHistoryState(newValue, clickedPrefix, selectedFolder, updatedFiles);
    },
    [matrixFiles, selectedFolder, pushHistoryState]
  );

  // Existing action handler for other parts of the app.
  const handleSelectAction = useCallback(
    (parentPrefix: string, action: string) => {
      const mapping = actionToPrefixMap[action];
      if (!mapping) {
        setRootPrefix("root");
        setClickedRoot("root");
        pushHistoryState("root", "root", selectedFolder, matrixFiles);
        return;
      }
      const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
      setRootPrefix(newRoot);
      setClickedRoot(parentPrefix);
      pushHistoryState(newRoot, parentPrefix, selectedFolder, matrixFiles);
    },
    [selectedFolder, pushHistoryState, matrixFiles]
  );

  // Handle folder selection.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSelectedFolder(folder);
      setRootPrefix("root");
      setClickedRoot("");
      setMatrixFiles(defaultMatrixFiles);
      pushHistoryState("root", "", folder, defaultMatrixFiles);
    },
    [pushHistoryState, setSelectedFolder, defaultMatrixFiles]
  );

  // Set up keyboard shortcuts.
  useKeyboardShortcuts({
    onBackspace: () => {
      if (rootPrefix !== "root" || clickedRoot) {
        setRootPrefix("root");
        setClickedRoot("");
        setMatrixFiles(defaultMatrixFiles);
        pushHistoryState("root", "", selectedFolder, defaultMatrixFiles);
      }
    },
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
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
        {(folderError || filesError) && <div className="text-red-500">{folderError || filesError}</div>}
        <PlateGrid
          files={matrixFiles}
          selectedFolder={selectedFolder}
          isSpiralView={isSpiralView}
          randomFillEnabled={randomFillEnabled}
          onSelectAction={handleSelectAction}
          onColorKeyClick={handleUpdateMatrixFiles}
          windowWidth={windowWidth}
        />
        {/* Debug section for troubleshooting matrixFiles */}
        <div className="mt-4 p-2 bg-gray-100 border border-gray-300 rounded">
          <h3 className="font-semibold mb-2">Current Matrix Files</h3>
          <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(matrixFiles, null, 2)}</pre>
        </div>
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default MainApp;
