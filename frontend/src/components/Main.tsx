// src/components/Main.tsx
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Plate from "./Plate";
import NavBar from "./NavBar";
import "./App.css";
import { actionToPrefixMap } from "../constants";

function MainApp() {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);

  // Toggle global randomization using useCallback for a stable reference.
  const toggleRandomization = useCallback(() => {
    setRandomFillEnabled((prev) => !prev);
  }, []);

  // Fetch folders on mount.
  useEffect(() => {
    axios
      .get<string[]>("https://gtotest1.azurewebsites.net/api/Files/folders")
      .then((response) => {
        setFolders(response.data);
        if (response.data.length > 0) {
          setSelectedFolder(response.data[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching folders");
      });
  }, []);

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

  // Backspace resets the root prefix.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        setRootPrefix("root");
        setClickedRoot("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Toggle randomization when the 'r' key is pressed (if focus is not on an input/textarea)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "r" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        toggleRandomization();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleRandomization]);

  // Filter files based on the current rootPrefix.
  const currentMatrixFiles = files.filter((file) => {
    if (rootPrefix === "root") {
      return file === "root.json" || /^0(?:\.0+)*\.json$/.test(file);
    }
    const pattern = new RegExp(`^${rootPrefix}(?:\\.0+)*\\.json$`);
    return pattern.test(file);
  });

  // Convert action string to numeric prefix and update state.
  const handleSelectAction = useCallback(
    (parentPrefix: string, action: string) => {
      const mapping = actionToPrefixMap[action];
      if (!mapping) {
        setRootPrefix("root");
        setClickedRoot("root");
        return;
      }
      const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
      setRootPrefix(newRoot);
      setClickedRoot(parentPrefix);
    },
    []
  );

  return (
    <div className="min-h-screen relative">
      {/* Fixed Navigation Bar */}
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={toggleRandomization}
        folders={folders}
        onFolderSelect={(folder) => {
          setSelectedFolder(folder);
          setRootPrefix("root");
          setClickedRoot("");
        }}
      />

      {/* Main Content */}
      <div className="pt-18 p-1">
        {/* Optionally, add a header */}
        {/* <h1 className="text-3xl font-bold mb-4 text-center">GTO Lite</h1> */}
        {error && <div style={{ color: "red" }}>{error}</div>}
        <div className="flex-grow">
          {/* Grid container using auto-fit with a minmax of 190px */}
          <div
            className="grid gap-2 
                      max-[440px]:grid-cols-2 
                      min-[441px]:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]"
          >
            {clickedRoot && (
              <Plate
                key={clickedRoot}
                folder={selectedFolder}
                file={`${clickedRoot}.json`}
                onSelectAction={handleSelectAction}
                randomFillEnabled={randomFillEnabled}
              />
            )}
            {[...currentMatrixFiles]
              .reverse()
              .map((file) => (
                <Plate
                  key={file}
                  folder={selectedFolder}
                  file={file}
                  onSelectAction={handleSelectAction}
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
