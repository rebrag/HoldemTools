import { useState, useEffect } from "react";
import axios from "axios";

export interface FileData {
  Position: string;
  // other fields as needed
}

const useFetchMatrixFile = (folder: string, file: string, apiBaseUrl: string) => {
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    axios.get<FileData>(`${apiBaseUrl}/api/Files/${folder}/${file}`)
      .then((response) => {
        setData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(`Error fetching ${file}:`, err);
        setError("Error fetching file data");
        setLoading(false);
      });
  }, [folder, file, apiBaseUrl]);

  return { data, loading, error };
};

export default useFetchMatrixFile;
