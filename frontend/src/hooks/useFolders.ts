import { useEffect, useState } from "react";
import axios from "axios";

/** Matches server DTO shape from /api/Files/foldersWithMetadata */
export type FolderMetadata = {
  name: string;
  ante: number;
  isIcm: boolean;
  icmCount: number;

  // NEW: derived info from server
  seats?: number;
  tags?: string[];        // e.g. ["FT", "HU", "ICM"]
  icmPayouts?: number[];  // optional full payout structure
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
        const { data } = await axios.get<FolderWithMetadata[]>(
          `${API_BASE_URL}/api/Files/foldersWithMetadata?includeMissing=true`
        );
        if (cancelled) return;

        const names: string[] = [];
        const byFolder: Record<string, FolderMetadata | null> = {};

        data.forEach((x) => {
          names.push(x.folder);
          byFolder[x.folder] = x.metadata ?? null;
        });

        names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

        setFolders(names);
        if (names.length > 0 && !selectedFolder) {
          setSelectedFolder(names[0]);
        }
        setFolderMetaMap(byFolder);
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
