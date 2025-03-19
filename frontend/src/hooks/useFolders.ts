// src/hooks/useFolders.ts
import { useEffect, useState } from "react";
import axios from "axios";

const useFolders = (API_BASE_URL: string) => {
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>("");

  useEffect(() => {
    axios
      .get<string[]>(`${API_BASE_URL}/api/Files/folders`)
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
  }, [API_BASE_URL]);

  return { folders, selectedFolder, setSelectedFolder, error };
};

export default useFolders;
