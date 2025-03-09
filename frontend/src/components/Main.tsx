// src/components/Main.tsx
import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import Plate from "./Plate";
import NavBar from "./NavBar";
import "./App.css";
import { actionToPrefixMap } from "../constants";

function MainApp() {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  // Use state for rootPrefix and clickedRoot that we'll sync with history.
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);

  // Push updated state to browser history.
  const pushHistoryState = useCallback(
    (newRoot: string, newClicked: string, folder: string) => {
      const state = { rootPrefix: newRoot, clickedRoot: newClicked, folder };
      window.history.pushState(state, "", "");
    },
    []
  );

  // On mount, add a popstate listener to restore state.
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
      .get<string[]>("https://gtotest1.azurewebsites.net/api/Files/folders")
      .then((response) => {
        setFolders(response.data);
        if (response.data.length > 0) {
          setSelectedFolder(response.data[0]);
          // Initialize history state.
          pushHistoryState("root", "", response.data[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching folders");
      });
  }, [pushHistoryState]);

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
  }, [selectedFolder]);

  // Handle Backspace for undoing actions.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        // If not in initial state, undo by resetting both rootPrefix and clickedRoot.
        if (rootPrefix !== "root" || clickedRoot) {
          // For simplicity, we just reset to "root" and clear clickedRoot.
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

  // Filter files based on the current rootPrefix.
  const currentMatrixFiles = useMemo(() => {
    return files.filter((file) => {
      if (rootPrefix === "root") {
        return file === "root.json" || /^0(?:\.0+)*\.json$/.test(file);
      }
      const pattern = new RegExp(`^${rootPrefix}(?:\\.0+)*\\.json$`);
      return pattern.test(file);
    });
  }, [files, rootPrefix]);

  // Combine the clickedRoot file with currentMatrixFiles.
  const displayFiles = useMemo(() => {
    const plates = [...currentMatrixFiles];
    const clickedFile = clickedRoot ? `${clickedRoot}.json` : "";
    if (clickedFile && !plates.includes(clickedFile)) {
      plates.push(clickedFile);
    }
    return plates.reverse(); // Adjust ordering as needed.
  }, [currentMatrixFiles, clickedRoot]);

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
    <div className="min-h-screen relative">
      {/* Fixed Navigation Bar */}
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
        folders={folders}
        onFolderSelect={handleFolderSelect}
      />

      {/* Main Content */}
      <div className="pt-18 p-1">
        {error && <div style={{ color: "red" }}>{error}</div>}
        <div className="flex-grow">
          <div
            className="grid gap-1 
                      max-[440px]:grid-cols-2 
                      min-[441px]:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]"
          >
            {displayFiles.map((file) => (
              <Plate
                key={file}
                folder={selectedFolder}
                file={file}
                onSelectAction={handleSelectAction}
                // If needed, you can pass onColorKeyClick similarly.
                randomFillEnabled={randomFillEnabled}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MainApp;
