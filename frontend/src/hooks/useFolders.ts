import { useEffect, useState } from "react";
import axios from "axios";

/** Matches server DTO shape from /api/Files/foldersWithMetadata */
export type FolderMetadata = {
  name: string;
  ante: number;
  isIcm: boolean;
  icmCount: number;
};

type FolderWithMetadata = {
  folder: string;
  hasMetadata: boolean;
  metadata: FolderMetadata | null;
};

const useFolders = (API_BASE_URL: string) => {
  const [folders, setFolders] = useState<string[]>([]);
  const [folderMetaMap, setFolderMetaMap] = useState<Record<string, FolderMetadata | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1) FAST: get folder names only
        const { data: names } = await axios.get<string[]>(`${API_BASE_URL}/api/Files/folders`);
        if (cancelled) return;
        setFolders(names);
        if (names.length > 0 && !selectedFolder) setSelectedFolder(names[0]);

        // 2) BACKGROUND: hydrate metadata (don’t block UI)
        axios
          .get<FolderWithMetadata[]>(
            `${API_BASE_URL}/api/Files/foldersWithMetadata?includeMissing=true`
          )
          .then(({ data }) => {
            if (cancelled) return;
            const byFolder: Record<string, FolderMetadata | null> = {};
            data.forEach((x) => (byFolder[x.folder] = x.metadata ?? null));
            setFolderMetaMap(byFolder);
          })
          .catch((err) => {
            console.warn("metadata load failed", err);
          });
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Error fetching folders");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [API_BASE_URL]); // eslint-disable-line react-hooks/exhaustive-deps

  return { folders, folderMetaMap, selectedFolder, setSelectedFolder, error };
};

export default useFolders;
