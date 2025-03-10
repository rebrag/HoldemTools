// src/components/Main.tsx
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import Plate from "./Plate";
import NavBar from "./NavBar";
import "./App.css";
import { actionToPrefixMap } from "../constants";

function MainApp() {
  // ...existing states...
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [windowWidth, setWindowWidth] = useState<number>(window.innerWidth);
  // New state to toggle view mode
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);
  
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

  // Push updated state to browser history.
  const pushHistoryState = useCallback(
    (newRoot: string, newClicked: string, folder: string) => {
      const state = { rootPrefix: newRoot, clickedRoot: newClicked, folder };
      window.history.pushState(state, "", "");
    },
    []
  );

  // Restore state on popstate.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        const { rootPrefix, clickedRoot, folder } = event.state;
        if (typeof rootPrefix === "string") setRootPrefix(rootPrefix);
        if (typeof clickedRoot === "string") setClickedRoot(clickedRoot);
        if (typeof folder === "string") setSelectedFolder(folder);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Fetch folders on mount.
  useEffect(() => {
    axios
      .get<string[]>(`https://gtotest1.azurewebsites.net/api/Files/folders`)
      .then((response) => {
        setFolders(response.data);
        if (response.data.length > 0) {
          setSelectedFolder(response.data[0]);
          pushHistoryState("root", "", response.data[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching folders");
      });
  }, [API_BASE_URL, pushHistoryState]);

  // Fetch files when selectedFolder changes.
  useEffect(() => {
    if (!selectedFolder) return;
    axios
      .get<string[]>(`https://gtotest1.azurewebsites.net/api/Files/listJSONs/${selectedFolder}`)
      .then((response) => {
        setFiles(response.data);
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching files");
      });
  }, [API_BASE_URL, selectedFolder]);

  // Handle Backspace for undoing actions.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        if (rootPrefix !== "root" || clickedRoot) {
          setRootPrefix("root");
          setClickedRoot("");
          pushHistoryState("root", "", selectedFolder);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rootPrefix, clickedRoot, selectedFolder, pushHistoryState]);

  // Toggle randomization when 'r' is pressed.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "r" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        setRandomFillEnabled((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Track window width.
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Compute the maximum allowed number of ".0" groups based on the folder name.
  const maxZeros = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length - 1 : 0;
  }, [selectedFolder]);

  // Filter files based on the current rootPrefix.
  const currentMatrixFiles = useMemo(() => {
    return files.filter((file) => {
      if (rootPrefix === "root") {
        const pattern = new RegExp(`^0(?:\\.0){0,${maxZeros}}\\.json$`);
        return file === "root.json" || pattern.test(file);
      }
      const pattern = new RegExp(`^${rootPrefix}(?:\\.0){0,${maxZeros}}\\.json$`);
      return pattern.test(file);
    });
  }, [files, rootPrefix, maxZeros]);

  // Combine the clickedRoot file with currentMatrixFiles.
  const displayFiles = useMemo(() => {
    const plates = [...currentMatrixFiles];
    const clickedFile = clickedRoot ? `${clickedRoot}.json` : "";
    if (clickedFile && !plates.includes(clickedFile)) {
      plates.push(clickedFile);
    }
    // Reverse to mimic previous behavior if desired.
    return plates.reverse();
  }, [currentMatrixFiles, clickedRoot]);

  // Determine grid layout based on viewport width.
  const isNarrow = windowWidth <= 450;
  const gridRows = isNarrow ? Math.ceil(displayFiles.length / 2) : 2;
  const gridCols = isNarrow ? 2 : Math.ceil(displayFiles.length / 2);

  // Generate spiral order for a grid of size rows x cols.
  const generateSpiralOrder = (rows: number, cols: number): [number, number][] => {
    let top = 0,
      bottom = rows - 1,
      left = 0,
      right = cols - 1;
    const order: [number, number][] = [];
    while (top <= bottom && left <= right) {
      // Traverse top row.
      for (let j = left; j <= right; j++) {
        order.push([top, j]);
      }
      top++;
      // Traverse right column.
      for (let i = top; i <= bottom; i++) {
        order.push([i, right]);
      }
      right--;
      if (top <= bottom) {
        // Traverse bottom row.
        for (let j = right; j >= left; j--) {
          order.push([bottom, j]);
        }
        bottom--;
      }
      if (left <= right) {
        // Traverse left column.
        for (let i = bottom; i >= top; i--) {
          order.push([i, left]);
        }
        left++;
      }
    }
    return order;
  };

  // Compute new ordering of plates based on spiral order.
  const orderedFiles = useMemo(() => {
    const totalCells = gridRows * gridCols;
    // Create an array with blank placeholders.
    const gridArray: (string | null)[] = new Array(totalCells).fill(null);
    const spiralPositions = generateSpiralOrder(gridRows, gridCols);
    // Fill in the grid positions in spiral order with the available plates.
    displayFiles.forEach((file, idx) => {
      if (idx < spiralPositions.length) {
        const [r, c] = spiralPositions[idx];
        gridArray[r * gridCols + c] = file;
      }
    });
    return gridArray;
  }, [displayFiles, gridRows, gridCols]);

  // Determine which order to render based on view mode.
  const finalFiles = useMemo(() => {
    return isSpiralView ? orderedFiles : displayFiles;
  }, [isSpiralView, orderedFiles, displayFiles]);

  // Toggle view mode (to be triggered by a button in the NavBar)
  const toggleViewMode = useCallback(() => {
    setIsSpiralView((prev) => !prev);
  }, []);

  // Update state when a Plate triggers an action.
  const handleSelectAction = useCallback(
    (parentPrefix: string, action: string) => {
      const mapping = actionToPrefixMap[action];
      if (!mapping) {
        setRootPrefix("root");
        setClickedRoot("root");
        pushHistoryState("root", "root", selectedFolder);
        return;
      }
      const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
      setRootPrefix(newRoot);
      setClickedRoot(parentPrefix);
      pushHistoryState(newRoot, parentPrefix, selectedFolder);
    },
    [selectedFolder, pushHistoryState]
  );

  // Handle folder selection from NavBar.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSelectedFolder(folder);
      setRootPrefix("root");
      setClickedRoot("");
      pushHistoryState("root", "", folder);
    },
    [pushHistoryState]
  );

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
        folders={folders}
        onFolderSelect={handleFolderSelect}
        // Pass the toggle function and current view mode to NavBar
        toggleViewMode={toggleViewMode}
        isSpiralView={isSpiralView}
      />
      <div className="pt-13 p-1 flex-grow">
        {error && <div style={{ color: "red" }}>{error}</div>}
        <div className="flex-grow">
          <div
            className="grid gap-1 select-none"
            style={
              isNarrow
                ? {
                    gridTemplateColumns: "repeat(2, minmax(170px, 280px))",
                    gridTemplateRows: `repeat(${gridRows}, 1fr)`,
                    justifyContent: "center",
                  }
                : {
                    gridTemplateRows: "repeat(2, 1fr)",
                    gridTemplateColumns: `repeat(${gridCols}, minmax(210px, 280px))`,
                    justifyContent: "center",
                  }
            }
          >
            {finalFiles.map((file, index) =>
              file ? (
                <Plate
                  key={file}
                  folder={selectedFolder}
                  file={file}
                  onSelectAction={handleSelectAction}
                  randomFillEnabled={randomFillEnabled}
                />
              ) : (
                <div key={`blank-${index}`} />
              )
            )}
          </div>
        </div>
      </div>
      <footer className="text-center select-none">
        © Josh Garber 2025
      </footer>
    </div>
  );
}

export default MainApp;
