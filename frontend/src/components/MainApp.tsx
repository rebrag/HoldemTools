// src/App.tsx
import { useEffect, useState } from "react";
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

  // Filter files based on the current rootPrefix.
  const currentMatrixFiles = files.filter((file) => {
    if (rootPrefix === "root") {
      return file === "root.json" || /^0(?:\.0+)*\.json$/.test(file);
    }
    const pattern = new RegExp(`^${rootPrefix}(?:\\.0+)*\\.json$`);
    return pattern.test(file);
  });

  // Handle the action selection by converting the action string to a numeric prefix.
  const handleSelectAction = (parentPrefix: string, action: string) => {
    const mapping = actionToPrefixMap[action];
    if (!mapping) {
      setRootPrefix("root");
      setClickedRoot("root");
      return;
    }
    const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
    setRootPrefix(newRoot);
    // Keep track of the parent prefix for display or further logic.
    setClickedRoot(parentPrefix);
  };

  const renderSingleDecisionMatrix = (file: string) => (
    <div className="bg-gray-400 p-0 rounded-md w-[400px]">
      <DecisionMatrix key={file} folder={selectedFolder} file={file} onSelectAction={handleSelectAction} />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-100 to-purple-100 items-center p-4">
      {/* Display account info at the top-right */}
      <AccountMenu />
    <div className="min-h-screen bg-gradient-to-r from-blue-100 to-purple-100 items-center p-4">
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

        {/* Display the selected folder, current root, and clicked root */}
        <div className="mt-1"
          style={{ marginBottom: "10px", cursor: "pointer" }}
          onClick={() => {
            setRootPrefix("root")
            setClickedRoot("")
          }}
          title="Click to reset current root"
        >
          <strong>Selected Folder: </strong>
          {selectedFolder}
        </div>
        <div style={{ marginBottom: "10px" }}>
          <strong>Current Root: </strong>
          {rootPrefix}
        </div>
        {clickedRoot && (
          <div style={{ marginBottom: "10px" }}>
            <strong>Clicked Root: </strong>
            {clickedRoot}
          </div>
        )}

        {/* Render the matrices */}
        <div className="matrix-grid pl-4 pr-4">
          {clickedRoot && renderSingleDecisionMatrix(`${clickedRoot}.json`)}
          {[...currentMatrixFiles].reverse().map((file) => (
            <DecisionMatrix
              key={file}
              folder={selectedFolder}
              file={file}
              onSelectAction={handleSelectAction}
            />
          ))}
        </div>
        <footer className="text-center mt-4"> © Josh Garber 2025</footer>
      </div>
    </div>
    </div>
  );
}

export default App;
