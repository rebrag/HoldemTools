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

// Provide a dummy function for pushHistoryState to satisfy useFolders' signature.
const dummyPushHistoryState = () => {};

// Define an interface for our matrix file objects.
export interface MatrixFile {
  name: string;
  data: {
    position: string; // e.g. "UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"
    // Additional JSON data fields can be added here.
  };
}

const Main = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  // Pass the dummy function as second argument.
  const { folders, selectedFolder, setSelectedFolder, error: folderError } =
    useFolders(API_BASE_URL, dummyPushHistoryState);
  const { error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  // No forced default folder now.
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  // Calculate plateCount based on the folder name.
  const plateCount = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length : 1;
  }, [selectedFolder]);

  // Using useMemo so that positionsOrder reference is stable.
  const positionsOrder = useMemo(
    () => ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    []
  );

  // Compute the default matrix files from plateCount.
  const defaultMatrixFiles = useMemo((): MatrixFile[] => {
    const filesArray: MatrixFile[] = [];
    const defaultPositions = ["UTG", "UTG1", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
    for (let i = 0; i < plateCount - 1; i++) {
      let fileName: string;
      if (i === 0) {
        fileName = "root.json";
      } else {
        fileName = Array(i).fill("0").join(".") + ".json";
      }
      filesArray.push({
        name: fileName,
        data: { position: defaultPositions[i] || `Pos${i}` }
      });
    }
    if (plateCount > 1) {
      const zeros = Array(plateCount - 1).fill("0");
      zeros[zeros.length - 1] = "1"; // Replace last "0" with "1"
      const extraFile = zeros.join(".") + ".json";
      filesArray.push({
        name: extraFile,
        data: { position: defaultPositions[plateCount - 1] || `Pos${plateCount - 1}` }
      });
    }
    return filesArray;
  }, [plateCount]);

  // State for the full loaded plates (MatrixFile objects)
  const [loadedPlates, setLoadedPlates] = useState<MatrixFile[]>(defaultMatrixFiles);
  // State for display plates (file names only)
  const [displayPlates, setDisplayPlates] = useState<string[]>(defaultMatrixFiles.map(mf => mf.name));

  // Whenever loadedPlates changes, derive displayPlates (only names).
  useEffect(() => {
    // Ensure exactly one name per position.
    const newDisplay = positionsOrder.map((pos) => {
      const platesForPos = loadedPlates.filter((mf) => mf.data.position === pos);
      if (platesForPos.length === 0) return "";
      // Choose the one with the highest segment count.
      platesForPos.sort(
        (a, b) =>
          a.name.replace(".json", "").split(".").length -
          b.name.replace(".json", "").split(".").length
      );
      return platesForPos[platesForPos.length - 1].name;
    });
    setDisplayPlates(newDisplay);
  }, [loadedPlates, positionsOrder]);

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
        const { rootPrefix, clickedRoot, folder, matrixFiles } = event.state;
        if (typeof rootPrefix === "string") setRootPrefix(rootPrefix);
        if (typeof clickedRoot === "string") setClickedRoot(clickedRoot);
        if (typeof folder === "string") setSelectedFolder(folder);
        if (matrixFiles) {
          setLoadedPlates(matrixFiles);
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setRootPrefix, setClickedRoot, setSelectedFolder]);

  // --- Generalized updateMatrixFilesFn ---
  const updateMatrixFilesFn = useCallback(
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
        return updated.sort(
          (a, b) =>
            positionsOrder.indexOf(a.data.position) - positionsOrder.indexOf(b.data.position)
        );
      } else {
        const prefix = clickedFile.name.replace(".json", "");
        const updated = files.map((file, index) => {
          if (index <= clickedIndex) return file;
          // Subtract one so that the immediate next file gets no extra trailing "0"
          const trailingCount = index - clickedIndex - 1;
          const trailing =
            trailingCount > 0 ? "." + Array(trailingCount).fill("0").join(".") : "";
          return { ...file, name: `${prefix}.${newValue}${trailing}.json` };
        });
        return updated.sort(
          (a, b) =>
            positionsOrder.indexOf(a.data.position) - positionsOrder.indexOf(b.data.position)
        );
      }
    },
    [positionsOrder]
  );
  
  
  // --- End updateMatrixFilesFn ---

  // Internal handler for color key actions.
  const internalHandleUpdateMatrixFiles = useCallback(
    (action: string, file: MatrixFile) => {
      const newValue = actionToPrefixMap[action] || action;
      const clickedIndex = loadedPlates.findIndex((f) => f.name === file.name);
      if (clickedIndex === -1) return;
      const updatedFiles = updateMatrixFilesFn(loadedPlates, clickedIndex, newValue);
      setLoadedPlates(updatedFiles);
      updateBrowserHistory({
        rootPrefix: newValue,
        clickedRoot: file.name.replace(".json", ""),
        folder: selectedFolder,
        matrixFiles: updatedFiles
      });
    },
    [loadedPlates, selectedFolder, updateBrowserHistory, updateMatrixFilesFn]
  );

  // Adapter for onColorKeyClick: PlateGrid expects (action: string, file: string)
  const handleColorKeyClick = useCallback(
    (action: string, fileName: string) => {
      const matrixFile = loadedPlates.find((f) => f.name === fileName);
      if (!matrixFile) return;
      internalHandleUpdateMatrixFiles(action, matrixFile);
    },
    [loadedPlates, internalHandleUpdateMatrixFiles]
  );

  // Action handler for other parts of the app.
  const handleSelectAction = useCallback(
    (parentPrefix: string, action: string) => {
      const mapping = actionToPrefixMap[action];
      if (!mapping) {
        setRootPrefix("root");
        setClickedRoot("root");
        updateBrowserHistory({
          rootPrefix: "root",
          clickedRoot: "root",
          folder: selectedFolder,
          matrixFiles: loadedPlates
        });
        return;
      }
      const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
      setRootPrefix(newRoot);
      setClickedRoot(parentPrefix);
      updateBrowserHistory({
        rootPrefix: newRoot,
        clickedRoot: parentPrefix,
        folder: selectedFolder,
        matrixFiles: loadedPlates
      });
    },
    [selectedFolder, loadedPlates, updateBrowserHistory]
  );

  // Handle folder selection.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSelectedFolder(folder);
      setRootPrefix("root");
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
      if (rootPrefix !== "root" || clickedRoot) {
        setRootPrefix("root");
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
          onSelectAction={handleSelectAction}
          onColorKeyClick={handleColorKeyClick}
          windowWidth={windowWidth}
        />
        {/* Debug section: two columns side-by-side */}
        <div className="mt-4 p-2 bg-gray-100 border border-gray-300 rounded flex flex-col md:flex-row md:justify-between">
          <div className="md:w-1/2">
            <h3 className="font-semibold mb-2">Loaded Plates (Names Only)</h3>
            <pre className="text-sm whitespace-pre-wrap">
              {JSON.stringify(loadedPlates.map(mf => mf.name), null, 2)}
            </pre>
          </div>
          <div className="md:w-1/2 mt-4 md:mt-0">
            <h3 className="font-semibold mb-2">Display Plates</h3>
            <pre className="text-sm whitespace-pre-wrap">
              {JSON.stringify(displayPlates, null, 2)}
            </pre>
          </div>
        </div>
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default Main;
