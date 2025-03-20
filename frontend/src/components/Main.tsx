// src/components/Main.tsx
import { useState, useCallback, useEffect, useMemo } from "react";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToPrefixMap } from "../constants";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";

// Define an interface for our matrix file objects.
export interface MatrixFile {
  name: string;
  data: Record<string, string>; // No longer using any position-related data.
}

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  const { folders, selectedFolder, setSelectedFolder, error: folderError } =
    useFolders(API_BASE_URL);
    const { files: availableJsonFiles, error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  // Determine plateCount based on the selected folder.
  const plateCount = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length : 1;
  }, [selectedFolder]);

  // Compute the default matrix files based solely on plateCount.
  const defaultMatrixFiles = useMemo((): MatrixFile[] => {
    const filesArray: MatrixFile[] = [];
    for (let i = 0; i < plateCount-1; i++) {
      const fileName = i === 0 ? "root.json" : Array(i).fill("0").join(".") + ".json";
      filesArray.push({
        name: fileName,
        data: {}
      });
    }
    if (plateCount > 1) {
      const zeros = Array(plateCount - 1).fill("0");
      zeros[zeros.length - 1] = "1"; // Replace last "0" with "1"
      const extraFile = zeros.join(".") + ".json";
      filesArray.push({
        name: extraFile,
        data: {}
      });
    }
    return filesArray;
  }, [plateCount]);

  // State for the full loaded plates (MatrixFile objects)
  const [loadedPlates, setLoadedPlates] = useState<MatrixFile[]>(defaultMatrixFiles);

  // For display, we simply list the names from the loadedPlates.
  const [displayPlates, setDisplayPlates] = useState<string[]>(defaultMatrixFiles.map(mf => mf.name));

  useEffect(() => {
    setDisplayPlates(loadedPlates.map(mf => mf.name));
  }, [loadedPlates]);

  // When plateCount changes, reset loadedPlates.
  useEffect(() => {
    setLoadedPlates(defaultMatrixFiles);
  }, [defaultMatrixFiles]);

  // Utility function to update browser history.
  const updateBrowserHistory = useCallback(
    (newState: {
      rootPrefix: string;
      clickedRoot: string;
      folder: string;
      matrixFiles: MatrixFile[];
    }) => {
      window.history.pushState(newState, "");
    },
    []
  );

  // Restore state when the user navigates with Back/Forward.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        const { clickedRoot, folder, matrixFiles } = event.state;
        if (typeof clickedRoot === "string") setClickedRoot(clickedRoot);
        if (typeof folder === "string") setSelectedFolder(folder);
        if (matrixFiles) {
          setLoadedPlates(matrixFiles);
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setClickedRoot, setSelectedFolder]);

  const appendMatrixFiles = useCallback(
    (
      currentFiles: MatrixFile[],
      clickedIndex: number,
      actionNumber: string,
      availableFiles: string[]
    ): MatrixFile[] => {
      const clickedFile = currentFiles[clickedIndex];
      if (!clickedFile) return currentFiles;
  
      const prefix = clickedFile.name.replace(".json", "");
      const baseName = prefix === "root" ? `${actionNumber}` : `${prefix}.${actionNumber}`;
      const newFiles: MatrixFile[] = [];
      const baseFileName = `${baseName}.json`;
      availableFiles.forEach((file) => {
        if (file === baseFileName) {
          newFiles.push({ name: file, data: {} });
        }
      });
      const pattern = `^${baseName}(?:\\.0)+\\.json$`;
      const regex = new RegExp(pattern);
      availableFiles.forEach((file) => {
        if (regex.test(file)) {
          newFiles.push({ name: file, data: {} });
        }
      });
      //console.log("appendMatrixFiles - new files:", newFiles.map((f) => f.name));
      return [...currentFiles, ...newFiles];
    },
    []
  );
  
  

  // Update handleActionClick to use appendMatrixFiles instead of updating files in place.
  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const matrixFile = loadedPlates.find((f) => f.name === fileName);
      if (!matrixFile) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((f) => f.name === matrixFile.name);
      if (clickedIndex === -1) return;
      
      // Get the updated list of files, including the newly appended ones.
      const updatedFiles = appendMatrixFiles(loadedPlates, clickedIndex, newValue, availableJsonFiles);
  
      // Calculate the newly added files by comparing lengths.
      const newlyAddedFiles = updatedFiles.slice(loadedPlates.length);
      console.log("New files added:", newlyAddedFiles.map(f => f.name));
      console.log("All loaded plates:", updatedFiles.map((f) => ({ name: f.name, data: f })));
  
      setLoadedPlates(updatedFiles);
      updateBrowserHistory({
        rootPrefix: newValue,
        clickedRoot: matrixFile.name.replace(".json", ""),
        folder: selectedFolder,
        matrixFiles: updatedFiles
      });
    },
    [loadedPlates, selectedFolder, updateBrowserHistory, appendMatrixFiles, availableJsonFiles]
  );
  
  

  // Handle folder selection.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSelectedFolder(folder);
      setClickedRoot("");
      setLoadedPlates(defaultMatrixFiles);
      updateBrowserHistory({
        rootPrefix: "root",
        clickedRoot: "",
        folder,
        matrixFiles: defaultMatrixFiles
      });
    },
    [defaultMatrixFiles, updateBrowserHistory, setSelectedFolder]
  );

  // Keyboard shortcuts.
  useKeyboardShortcuts({
    onBackspace: () => {
      if (clickedRoot) {
        setClickedRoot("");
        setLoadedPlates(defaultMatrixFiles);
        updateBrowserHistory({
          rootPrefix: "root",
          clickedRoot: "",
          folder: selectedFolder,
          matrixFiles: defaultMatrixFiles
        });
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
          files={displayPlates} // Only file names are passed for display.
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
