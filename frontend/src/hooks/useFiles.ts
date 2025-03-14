// src/hooks/useFiles.ts
import { useEffect, useState } from "react";
import axios from "axios";

const useFiles = (API_BASE_URL: string, selectedFolder: string) => {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFolder) return;
    axios
      .get<string[]>(`${API_BASE_URL}/api/Files/listJSONs/${selectedFolder}`)
      .then((response) => setFiles(response.data))
      .catch((err) => {
        console.error(err);
        setError("Error fetching files");
      });
  }, [API_BASE_URL, selectedFolder]);

  return { files, error };
};

export default useFiles;
