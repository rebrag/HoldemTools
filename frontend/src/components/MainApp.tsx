import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Plate from "./Plate";
import FolderSelector from "./FolderSelector";
import RandomizeButton from "./RandomizeButton";
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

  // Toggle global randomization
  const toggleRandomization = () => {
    setRandomFillEnabled((prev) => !prev);
  };

  // Fetch folders on mount
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

  // Fetch files when selectedFolder changes
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

  // Backspace resets the root prefix
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('Viewport width:', window.innerWidth);
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

  // Filter files based on the current rootPrefix
  const currentMatrixFiles = files.filter((file) => {
    if (rootPrefix === "root") {
      return file === "root.json" || /^0(?:\.0+)*\.json$/.test(file);
    }
    const pattern = new RegExp(`^${rootPrefix}(?:\\.0+)*\\.json$`);
    return pattern.test(file);
  });

  // Convert action string to numeric prefix and update state
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
    <div className="min-h-screen relative p-3">
      {/* Account info at top-right */}
      <div className="absolute z-10 top-4 right-4">
        <AccountMenu />
      </div>

      {/* Global Randomize Button */}
      <div className="absolute flex top-4 left-4">
  <RandomizeButton
    randomFillEnabled={randomFillEnabled}
    setRandomFillEnabled={toggleRandomization}
  />
</div>


      <h1 className="text-3xl font-bold mb-4 text-center">GTO Lite</h1>
      {error && <div style={{ color: "red" }}>{error}</div>}

      <div className="flex-grow">
        <FolderSelector
          folders={folders}
          onFolderSelect={(folder) => {
            setSelectedFolder(folder);
            setRootPrefix("root");
            setClickedRoot("");
          }}
        />

        <div className="mt-1 cursor-unselectable mb-2">
          <strong>Selected Folder: </strong> {selectedFolder}
        </div>

        <div className="grid grid-cols-1 gap-0 
        [@media(min-width:650px)]:grid-cols-2 
        [@media(min-width:950px)]:grid-cols-3 
        [@media(min-width:1200px)]:grid-cols-4">
          {clickedRoot && (
            <Plate
              key={clickedRoot}
              folder={selectedFolder}
              file={`${clickedRoot}.json`}
              onSelectAction={handleSelectAction}
              randomFillEnabled={randomFillEnabled}
            />
          )}
          {[...currentMatrixFiles].reverse().map((file) => (
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
  );
}

export default App;
