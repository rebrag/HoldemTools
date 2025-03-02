// src/components/DecisionMatrix.tsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { FileData, combineDataByHand, HandCellData, getColorForAction } from "../utils/utils";
import HandCell from "./HandCell";
import ColorKey from "./ColorKey";

interface DecisionMatrixProps {
  folder: string;
  file: string;
  onSelectAction: (parentPrefix: string, action: string) => void;
  randomFillEnabled?: boolean; // Updated prop name to match App.tsx
}

const DecisionMatrix: React.FC<DecisionMatrixProps> = ({
  folder,
  file,
  onSelectAction,
  randomFillEnabled,
}) => {
  const [rawData, setRawData] = useState<FileData | null>(null);
  const [combinedData, setCombinedData] = useState<HandCellData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Array to store a random fill color for each cell (aligned with gridData order)
  const [randomColors, setRandomColors] = useState<(string | null)[]>([]);

  // Fetch file data when the component mounts or folder/file changes.
  useEffect(() => {
    setLoading(true);
    axios
      .get<FileData>(`https://gtotest1.azurewebsites.net/api/Files/${folder}/${file}`)
      .then((response) => {
        setRawData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Error fetching file data");
        setLoading(false);
      });
  }, [folder, file]);

  // Process raw data into grid format.
  useEffect(() => {
    if (!rawData) return;
    const data = combineDataByHand(rawData);
    setCombinedData(data);
  }, [rawData]);

  // Standard poker hand order (adjust as needed)
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

  const gridData = handOrder.map((hand) =>
    combinedData.find((item) => item.hand === hand)
  );

  const parentPrefix = file.replace(".json", "");

  // Function to compute a weighted random action for a cell.
  const selectRandomAction = (actions: { [action: string]: number }): string => {
    const rand = Math.random();
    let cumulative = 0;
    for (const [action, probability] of Object.entries(actions)) {
      cumulative += probability;
      if (rand < cumulative) {
        return action;
      }
    }
    return Object.keys(actions)[0]; // fallback
  };

  // Calculate random colors for each cell.
  const calculateRandomColors = () => {
    const newColors = gridData.map((cellData) => {
      if (!cellData) return null;
      const chosenAction = selectRandomAction(cellData.actions);
      return getColorForAction(chosenAction);
    });
    setRandomColors(newColors);
  };

  // When randomFillEnabled changes, recalculate random colors.
  useEffect(() => {
    if (randomFillEnabled) {
      calculateRandomColors();
    } else {
      setRandomColors([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [randomFillEnabled, rawData, combinedData]);

  return (
    <div className="matrix-item">
      <div style={{ marginBottom: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "0px" }}>
          {rawData ? (
            <h2
              className="decoration-solid font-bold mr-4 mb-1"
              style={{ textShadow: "1px 1px 1px rgba(0, 0, 0, 0.7)" }}
            >
              {rawData.Position} {rawData.bb}bb
            </h2>
          ) : (
            <h2 style={{ marginRight: "10px" }}>{file}</h2>
          )}
          {combinedData.length > 0 && (
            <ColorKey
              data={combinedData}
              onSelectAction={(action) => onSelectAction(parentPrefix, action)}
            />
          )}
        </div>
        {loading && <div>Loading file data...</div>}
        {error && <div style={{ color: "red" }}>{error}</div>}
        {rawData && !loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(13, 1fr)",
              gridTemplateRows: "repeat(13, 1fr)",
              gap: "0px",
              width: "400px", //width of whole 13x13 matrix
              maxWidth: "1000px",
            }}
          >
            {gridData.map((handData, index) =>
              handData ? (
                <HandCell
                  key={index}
                  data={handData}
                  randomFillColor={randomColors[index] || undefined}
                />
              ) : (
                <div key={index} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DecisionMatrix;
