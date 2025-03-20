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
  data: Record<string, string>; // No position field needed.
}

const generateChildMatrixFiles = (
  JsonName: string,
  action: string,
  plateCount: number
): MatrixFile[] => {
  // Remove the ".json" extension and split the name into segments.
  const baseName = JsonName.replace(".json", "");
  const fileNumbers = baseName.split(".");
  const nonZeroCount = fileNumbers.filter((segment) => segment !== "0").length;
  const iterations = (plateCount - fileNumbers.length - 1) + nonZeroCount;

  let currentName = `${baseName}.${action}`;
  const files: MatrixFile[] = [];
  for (let i = 0; i < iterations; i++) {
    if (i > 0) {
      currentName += ".0";
    }
    files.push({
      name: `${currentName}.json`,
      data: {}
    });
  }
  console.log(
    "generateChildMatrixFiles - parentJsonName:",
    JsonName,
    "iterations:",
    iterations,
    "generated files:",
    files.map((file) => file.name)
  );
  return files;
};

// Example usage: plateCount is 8.
const generatedFiles = generateChildMatrixFiles("0.5.json", "40054", 8);
console.log(generatedFiles);

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  const { folders, selectedFolder, setSelectedFolder, error: folderError } =
    useFolders(API_BASE_URL);
  const { error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  // Calculate plateCount based on the folder name.
  const plateCount = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length : 1;
  }, [selectedFolder]);

  // Compute the default matrix files from plateCount.
  const defaultMatrixFiles = useMemo((): MatrixFile[] => {
    const filesArray: MatrixFile[] = [];
    for (let i = 0; i < plateCount-1; i++) {
      const fileName = i === 0 ? "root.json" : Array(i).fill("0").join(".") + ".json";
      filesArray.push({
        name: fileName,
        data: {}
      });
    }
    // Optionally add an extra file if needed.
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

  // Whenever loadedPlates updates, update displayPlates.
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

  // --- Generalized updateMatrixFiles ---
  const updateMatrixFiles = useCallback(
    (files: MatrixFile[], clickedIndex: number, newValue: string): MatrixFile[] => {
      const clickedFile = files[clickedIndex];
      if (clickedIndex === 0) {
        const updated = files.map((file, index) => {
          if (index === 0) return file;
          const segments = file.name.replace(".json", "").split(".");
          const suffix =
            segments.length > 1 ? "." + Array(segments.length - 1).fill("0").join(".") : "";
          return { ...file, name: `${newValue}${suffix}.json` };
        });
        console.log(
          "updateMatrixFiles - clickedIndex:",
          clickedIndex,
          "updated files:",
          updated.map((file) => file.name)
        );
        return updated;
      } else {
        const prefix = clickedFile.name.replace(".json", "");
        const updated = files.map((file, index) => {
          if (index <= clickedIndex) return file;
          const trailingCount = index - clickedIndex - 1;
          const trailing =
            trailingCount > 0 ? "." + Array(trailingCount).fill("0").join(".") : "";
          return { ...file, name: `${prefix}.${newValue}${trailing}.json` };
        });
        console.log(
          "updateMatrixFiles - clickedIndex:",
          clickedIndex,
          "updated files:",
          updated.map((file) => file.name)
        );
        return updated;
      }
    },
    []
  );

  const handleActionClick = useCallback(
    (action: string, fileName: string) => {
      const matrixFile = loadedPlates.find((f) => f.name === fileName);
      if (!matrixFile) return;
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((f) => f.name === matrixFile.name);
      if (clickedIndex === -1) return;
      const updatedFiles = updateMatrixFiles(loadedPlates, clickedIndex, newValue);
      setLoadedPlates(updatedFiles);
      updateBrowserHistory({
        rootPrefix: newValue,
        clickedRoot: matrixFile.name.replace(".json", ""),
        folder: selectedFolder,
        matrixFiles: updatedFiles
      });
    },
    [loadedPlates, selectedFolder, updateBrowserHistory, updateMatrixFiles]
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
          files={displayPlates} // Only file names are passed for display/troubleshooting.
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
