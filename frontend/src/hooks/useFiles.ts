//  src/hooks/useFiles.ts
import { useEffect, useState } from "react";
import axios, { CancelTokenSource } from "axios";

const useFiles = (API_BASE_URL: string, selectedFolder: string) => {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFolder) return;

    // reset state for new folder so the old files don't flash
    setFiles([]);
    setError(null);

    /* create a fresh cancel-token for this request */
    const source: CancelTokenSource = axios.CancelToken.source();

    axios
      .get<string[]>(
        `${API_BASE_URL}/api/Files/listJSONs/${encodeURIComponent(
          selectedFolder
        )}`,
        { cancelToken: source.token }
      )
      .then(res => setFiles(res.data))
      .catch(err => {
        if (axios.isCancel(err)) {
          /* request was cancelled → not an actual error */
          return;
        }
        console.error("useFiles:", err);
        setError("Error fetching files");
      });

    /* cancel the request if the component unmounts
       or the folder changes before we finish */
    return () => source.cancel("folder-switch");

  }, [API_BASE_URL, selectedFolder]);

  return { files, error };
};

export default useFiles;
