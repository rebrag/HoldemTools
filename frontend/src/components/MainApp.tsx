// MainApp.tsx
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import DecisionMatrix from "./DecisionMatrix";
import FolderSelector from "./FolderSelector";
import "./App.css";
import { actionToPrefixMap } from "../constants";
import AccountMenu from "./AccountMenu";

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);

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

  // Backspace functionality.
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

  // Filter files based on the current rootPrefix.
  const currentMatrixFiles = files.filter((file) => {
    if (rootPrefix === "root") {
      return file === "root.json" || /^0(?:\.0+)*\.json$/.test(file);
    }
    const pattern = new RegExp(`^${rootPrefix}(?:\\.0+)*\\.json$`);
    return pattern.test(file);
  });

  // Handle the action selection by converting the action string to a numeric prefix.
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


  const renderSingleDecisionMatrix = (file: string) => (
    <div className="bg-gray-400 p-0 rounded-md w-[400px]">
      <DecisionMatrix key={file} folder={selectedFolder} file={file} onSelectAction={handleSelectAction} />
    </div>
  );

  return (
    <div className="min-h-screen relative p-4">
      {/* Account info positioned at the top-right */}
      <div className="absolute z-10 top-4 right-4">
        <AccountMenu />
      </div>

      {/* Global toggle button at the top */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
        {/* Add any global controls if needed */}
      </div>

      {/* Main content */}
      <div className="mt-2">
        <h1 className="text-3xl font-bold mb-4 text-center">GTO Lite</h1>
        {error && <div style={{ color: "red" }}>{error}</div>}
        <div className="flex-grow">
          {/* Folder selector */}
          <FolderSelector
            folders={folders}
            onFolderSelect={(folder) => {
              setSelectedFolder(folder);
              setRootPrefix("root");
              setClickedRoot("");
            }}
          />
          <button
            onClick={() => setRandomFillEnabled((prev) => !prev)}
            style={{
              padding: "8px 16px",
              fontSize: "1rem",
              cursor: "pointer",
              backgroundColor: "#007BFF",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
              textShadow: "1px 1px 2px rgba(0, 0, 0, 0.2)",
              transition: "background-color 0.3s ease",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0056b3";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#007BFF";
            }}
          >
            {randomFillEnabled ? "Un-Randomize" : "Randomize"}
          </button>

          {/* Display selected folder */}
          <div className="mt-1 cursor-unselectable" style={{ marginBottom: "10px" }}>
            <strong>Selected Folder: </strong>
            {selectedFolder}
          </div>

          {/* Debugging Information
          <div style={{ marginBottom: "10px" }}>
            <strong>Current Root: </strong>
            {rootPrefix}
          </div>
          {clickedRoot && (
            <div style={{ marginBottom: "10px" }}>
              <strong>Clicked Root: </strong>
              {clickedRoot}
            </div>
      )} */}

          {/* Render the matrices */}
          <div className="matrix-grid pl-4 pr-4">
            {clickedRoot && renderSingleDecisionMatrix(`${clickedRoot}.json`)}
            {[...currentMatrixFiles].reverse().map((file) => (
              <DecisionMatrix
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

export default App;
