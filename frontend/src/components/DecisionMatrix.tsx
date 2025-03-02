import React, { useEffect, useState } from "react";
import axios from "axios";
import { FileData, combineDataByHand, HandCellData } from "../utils/utils";
import Plate from "./Plate";

interface DecisionMatrixProps {
  folder: string;
  file: string;
  onSelectAction: (parentPrefix: string, action: string) => void;
  randomFillEnabled?: boolean;
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

  useEffect(() => {
    if (!rawData) return;
    const data = combineDataByHand(rawData);
    setCombinedData(data);
  }, [rawData]);

  const parentPrefix = file.replace(".json", "");

  return (
    <div className="matrix-item">
      {loading && <p>Loading data...</p>}
      {error && <p className="text-red-500">{error}</p>}
      <Plate
        position={rawData?.Position || file}
        bb={String(rawData?.bb ?? "Unknown")}
        gridData={combinedData}
        width={420}
        height={500}
        onSelectAction={(action) => onSelectAction(parentPrefix, action)}
        randomFillEnabled={randomFillEnabled}
      />
    </div>
  );
};

export default DecisionMatrix;
