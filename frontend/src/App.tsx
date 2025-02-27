// src/App.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import DecisionMatrix from "./components/DecisionMatrix";
import "./App.css";
// import RandomizeModeButton from "./components/RandomizeModeButton";
import FolderSelector from "./components/FolderSelector";

const actionToPrefix: Record<string, string> = {
  Fold: "0",
  ALLIN: "3",
  Min: "5",
  Call: "1",
  "15": "15",
  "40054": "40054",
  "40075": "40075",
  "40078": "40078",
  "Raise 2bb": "15",
  "Raise 54%": "40054",
  "Raise 75%": "40075",
  "Raise 78%": "40078",
};

function App() {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // const [randomizeMode, setRandomizeMode] = useState<boolean>(false);

  // Fetch folders on component mount.
  useEffect(() => {
    axios
      //.get<string[]>("http://localhost:5192/api/Files/folders")
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
      //.get<string[]>(`http://localhost:5192/api/Files/listJSONs/${selectedFolder}`)
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

  // and store the clicked-on matrix's root in clickedRoot.
  const handleSelectAction = (parentPrefix: string, action: string) => {
    const mapping = actionToPrefix[action];
    console.log("Clicked action:", action);
    if (!mapping) {
      setRootPrefix("root");
      setClickedRoot("root");
      return;
    }
    const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
    console.log("Mapping:", mapping, "New root:", newRoot);
    setRootPrefix(newRoot);
    // Store the matrix where the click occurred.
    setClickedRoot(parentPrefix);
  };

  const renderSingleDecisionMatrix = (file: string) => {
    return (
      <div className="bg-gray-400 p-0 rounded-md w-[400px]">
        <DecisionMatrix key={file} folder={selectedFolder} file={file} onSelectAction={handleSelectAction} />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-100 to-purple-100 items-center p-4">
      <h1 className="text-3xl font-bold mb-4 text-center">GTO Lite</h1>
      {error && <div style={{ color: "red" }}>{error}</div>}
      
      {/* Folder selector */}
      <FolderSelector
        folders={folders}
        onFolderSelect={(folder) => {
          setSelectedFolder(folder);
          setRootPrefix("root");
          setClickedRoot("");
        }}
      />
      
    {/* Toggle Randomization */}
    {/* <RandomizeModeButton
        randomize={randomizeMode}
        toggleRandomize={() => setRandomizeMode((prev) => !prev)}
      /> */}

      {/* Display the current and clicked roots */}
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
        {clickedRoot.length > 0 && renderSingleDecisionMatrix(clickedRoot+".json")}
        {[...currentMatrixFiles].reverse().map((file) => (
          <DecisionMatrix
            key={file}
            folder={selectedFolder}
            file={file}
            onSelectAction={handleSelectAction}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
