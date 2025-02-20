// src/App.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import DecisionMatrix from "./components/DecisionMatrix";

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Fetch folders on component mount.
  useEffect(() => {
    axios
      .get<string[]>("http://localhost:5192/api/Files/folders")
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
      .get<string[]>(`http://localhost:5192/api/Files/listJSONs/${selectedFolder}`)
      .then((response) => {
        setFiles(response.data);
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching files");
      });
  }, [selectedFolder]);

  // Filter files to only those that are decision matrices:
  // For example, "root.json" or files that match the pattern 0.json, 0.0.json, 0.0.0.json, etc.
  const decisionMatrixFiles = files.filter(
    (file) => file === "root.json" || /^0(?:\.0+)*\.json$/.test(file)
  );

  return (
    <div style={{ padding: "20px" }}>
      <h1>Poker Strategy Grids</h1>
      {error && <div style={{ color: "red" }}>{error}</div>}
      
      {/* Folder selector */}
      <div style={{ marginBottom: "10px" }}>
        <label>
          Select Folder:{" "}
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
          >
            {folders.map((folder, index) => (
              <option key={index} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>
      </div>
      
      {/* Render each decision matrix */}
      {decisionMatrixFiles.map((file) => (
        <DecisionMatrix key={file} folder={selectedFolder} file={file} />
      ))}
    </div>
  );
}

export default App;
