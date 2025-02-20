import React, { useEffect, useState } from "react";
import axios from "axios";

interface HandCellData {
  hand: string;
  actions: Record<string, number>;
}

// Data returned from file API: Record<string, Record<string, [number, number]>>
type FileData = Record<string, Record<string, [number, number]>>;

// Generate a consistent color from a string using a hash function.
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
}




function App() {
  // State for folders, files, and selected folder/file
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [rawData, setRawData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  //const combined: { [hand: string]: HandCellData } = {};


  // State for grid data
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);

  // Fetch folders on component mount
  useEffect(() => {
    axios
      .get<string[]>("http://localhost:5192/api/Files/folders")
      .then((response) => {
        setFolders(response.data);
        // Optionally select the first folder automatically
        if (response.data.length > 0) {
          setSelectedFolder(response.data[0]);
          console.log(response)
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
      .get<string[]>(`http://localhost:5192/api/Files/listJSONs/${selectedFolder}`)
      .then((response) => {
        setFiles(response.data);
        // Optionally select the first file automatically
        if (response.data.length > 0) {
          setSelectedFile(response.data[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching files");
      });
  }, [selectedFolder]);

  // Fetch file data when selectedFile changes
  useEffect(() => {
    if (!selectedFile) return;
    setLoading(true);
    axios
      .get<FileData>(`http://localhost:5192/api/Files/${selectedFolder}/${selectedFile}`)
      .then((response) => {
        setRawData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching file data");
        setLoading(false);
      });
  }, [selectedFile]);

  // Combine data into grid format if rawData exists
  useEffect(() => {
    if (!rawData) return;
    const combined = combineDataByHand(rawData);
    setCombinedData(combined);
  }, [rawData]);

  const combineDataByHand = (data: FileData): HandCellData[] => {
    const combined: { [hand: string]: HandCellData } = {};
    for (const action in data) {
      const actionData = data[action];
      for (const hand in actionData) {
        const [strategy] = actionData[hand];
        if (!combined[hand]) {
          combined[hand] = { hand, actions: {} };
        }
        combined[hand].actions[action] = strategy;
      }
    }
    return Object.values(combined);
  };
  
  

  // Mapping group keys to colors
  const actionColorMapping: Record<string, string> = {
    Fold: "lightblue",
    ALLIN: "red",
    Min: "lightcoral",
    Call: "lightgreen",
    // You can add any known mappings here
  };
  
  const getColorForAction = (action: string): string => {
    return actionColorMapping[action] || stringToColor(action);
  };
  
  // A component to display the color key.
const ColorKey = ({ data }: { data: HandCellData[] }) => {
  // Extract a unique set of actions from the combined data.
  const uniqueActions = Array.from(
    data.reduce((set, cell) => {
      Object.keys(cell.actions).forEach((action) => set.add(action));
      return set;
    }, new Set<string>())
  );

  return (
    <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
      {uniqueActions.map((action) => (
        <div key={action} style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: "20px",
              height: "20px",
              backgroundColor: getColorForAction(action),
              marginRight: "5px",
              border: "1px solid #ccc",
            }}
          />
          <span>{action}</span>
        </div>
      ))}
    </div>
  );
};

  // Standard poker hand order grid
  const handOrder = [
    "AA", "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
    "AKo", "KK", "KQs", "KJs", "KTs", "K9s", "K8s", "K7s", "K6s", "K5s", "K4s", "K3s", "K2s",
    "AQo", "KQo", "QQ", "QJs", "QTs", "Q9s", "Q8s", "Q7s", "Q6s", "Q5s", "Q4s", "Q3s", "Q2s",
    "AJo", "KJo", "QJo", "JJ", "JTs", "J9s", "J8s", "J7s", "J6s", "J5s", "J4s", "J3s", "J2s",
    "ATo", "KTo", "QTo", "JTo", "TT", "T9s", "T8s", "T7s", "T6s", "T5s", "T4s", "T3s", "T2s",
    "A9o", "K9o", "Q9o", "J9o", "T9o", "99", "98s", "97s", "96s", "95s", "94s", "93s", "92s",
    "A8o", "K8o", "Q8o", "J8o", "T8o", "98o", "88", "87s", "86s", "85s", "84s", "83s", "82s",
    "A7o", "K7o", "Q7o", "J7o", "T7o", "97o", "87o", "77", "76s", "75s", "74s", "73s", "72s",
    "A6o", "K6o", "Q6o", "J6o", "T6o", "96o", "86o", "76o", "66", "65s", "64s", "63s", "62s",
    "A5o", "K5o", "Q5o", "J5o", "T5o", "95o", "85o", "75o", "65o", "55", "54s", "53s", "52s",
    "A4o", "K4o", "Q4o", "J4o", "T4o", "94o", "84o", "74o", "64o", "54o", "44", "43s", "42s",
    "A3o", "K3o", "Q3o", "J3o", "T3o", "93o", "83o", "73o", "63o", "53o", "43o", "33", "32s",
    "A2o", "K2o", "Q2o", "J2o", "T2o", "92o", "82o", "72o", "62o", "52o", "42o", "32o", "22"
  ];

  // Component for rendering one hand cell with a composite bar
  const HandCell = ({ data }: { data: HandCellData }) => {
    return (
      <div style={{
        border: "1px solid #ccc",
        height: "20px",
        position: "relative",
        width: "100%",
        userSelect: "none", // Prevents text selection
      }}>
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          {Object.entries(data.actions).map(([action, strategy]) => {
            const width = strategy * 100;
            return (
              <div
                key={action}
                style={{
                  width: `${width}%`,
                  backgroundColor: getColorForAction(action),
                }}
              />
            );
          })}
        </div>
        <div style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          color: "white",
          pointerEvents: "none",
          fontFamily: "Arial",
        }}>
          {data.hand}
        </div>
      </div>
    );
  };
  
  //{ ColorKey, HandCell };

  // Generate grid data based on the selected hand order
  const gridData = handOrder.map((hand) =>
    combinedData.find((item) => item.hand === hand)
  );

  return (
    <div style={{ padding: "20px" }}>
      <h1>Poker Strategy Grid</h1>
      
      {/* Dropdown for selecting folder */}
      <div style={{ marginBottom: "10px" }}>
        <label>
          Select Folder:{" "}
          <select
            value={selectedFolder}
            onChange={(e) => {
              setSelectedFolder(e.target.value);
              // Reset file selection when folder changes
              setSelectedFile("");
              setRawData(null);
            }}
          >
            {folders.map((folder, index) => (
              <option key={index} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>
      </div>
      
      {/* Dropdown for selecting file */}
      <div style={{ marginBottom: "20px" }}>
        <label>
          Select File:{" "}
          <select
            value={selectedFile}
            onChange={(e) => {
              setSelectedFile(e.target.value);
              setRawData(null);
            }}
            disabled={!files.length}
          >
            {files.map((file, index) => (
              <option key={index} value={file}>
                {file}
              </option>
            ))}
          </select>
        </label>
      </div>
      
      {/* Display error or loading state */}
      {loading && <div>Loading file data...</div>}
      {error && <div style={{ color: "red" }}>{error}</div>}
      
      {combinedData.length > 0 && <ColorKey data={combinedData} />}
      
      {/* Render grid only when data exists */}
      {rawData && !loading && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(13, 1fr)",
            gridTemplateRows: "repeat(13, 1fr)",
            gap: "0",
            width: "600px",
            maxWidth: "1000px",
          }}
        >
          {gridData.map((handData, index) =>
            handData ? <HandCell key={index} data={handData} /> : <div key={index} />
          )}
        </div>
      )}
    </div>
  );
}

export default App;
