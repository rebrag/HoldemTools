// src/components/MainApp.tsx
import { useState, useCallback,useEffect, useMemo } from "react";
import NavBar from "./NavBar";
import PlateGrid from "./PlateGrid";
import Layout from "./Layout";
import { actionToPrefixMap } from "../constants";
import useHistoryState from "../hooks/useHistoryState";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useWindowDimensions from "../hooks/useWindowDimensions";
import useFolders from "../hooks/useFolders";
import useFiles from "../hooks/useFiles";

const MainApp = () => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  const { windowWidth } = useWindowDimensions();

  const { pushHistoryState } = useHistoryState();
  const { folders, selectedFolder, setSelectedFolder, error: folderError } = useFolders(API_BASE_URL, pushHistoryState);
  const { files, error: filesError } = useFiles(API_BASE_URL, selectedFolder);

  const [rootPrefix, setRootPrefix] = useState<string>("root");
  const [clickedRoot, setClickedRoot] = useState<string>("");
  const [randomFillEnabled, setRandomFillEnabled] = useState<boolean>(false);
  const [isSpiralView, setIsSpiralView] = useState<boolean>(true);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (event.state) {
        const { rootPrefix, clickedRoot, folder } = event.state;
        if (typeof rootPrefix === "string") setRootPrefix(rootPrefix);
        if (typeof clickedRoot === "string") setClickedRoot(clickedRoot);
        if (typeof folder === "string") setSelectedFolder(folder);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setRootPrefix, setClickedRoot, setSelectedFolder]);
  
  // Calculate maxZeros based on folder name.
  const maxZeros = useMemo(() => {
    return selectedFolder ? selectedFolder.split("_").length - 1 : 0;
  }, [selectedFolder]);

  // Filter and prepare files for display.
  const currentMatrixFiles = useMemo(() => {
    return files.filter((file) => {
      if (rootPrefix === "root") {
        const pattern = new RegExp(`^0(?:\\.0){0,${maxZeros}}\\.json$`);
        return file === "root.json" || pattern.test(file);
      }
      const pattern = new RegExp(`^${rootPrefix}(?:\\.0){0,${maxZeros}}\\.json$`);
      return pattern.test(file);
    });
  }, [files, rootPrefix, maxZeros]);

  const displayFiles = useMemo(() => {
    const plates = [...currentMatrixFiles];
    const clickedFile = clickedRoot ? `${clickedRoot}.json` : "";
    if (clickedFile && !plates.includes(clickedFile)) {
      plates.push(clickedFile);
    }
    return plates.reverse();
  }, [currentMatrixFiles, clickedRoot]);

  // Define action handling.
  const handleSelectAction = useCallback(
    (parentPrefix: string, action: string) => {
      const mapping = actionToPrefixMap[action];
      if (!mapping) {
        setRootPrefix("root");
        setClickedRoot("root");
        pushHistoryState("root", "root", selectedFolder);
        return;
      }
      const newRoot = parentPrefix === "root" ? mapping : `${parentPrefix}.${mapping}`;
      setRootPrefix(newRoot);
      setClickedRoot(parentPrefix);
      pushHistoryState(newRoot, parentPrefix, selectedFolder);
    },
    [selectedFolder, pushHistoryState]
  );

  // Handle folder selection from NavBar.
  const handleFolderSelect = useCallback(
    (folder: string) => {
      setSelectedFolder(folder);
      setRootPrefix("root");
      setClickedRoot("");
      pushHistoryState("root", "", folder);
    },
    [pushHistoryState, setSelectedFolder]
  );

  // Set up keyboard shortcuts.
  useKeyboardShortcuts({
    onBackspace: () => {
      if (rootPrefix !== "root" || clickedRoot) {
        setRootPrefix("root");
        setClickedRoot("");
        pushHistoryState("root", "", selectedFolder);
      }
    },
    onToggleRandom: () => setRandomFillEnabled((prev) => !prev),
  });

  const toggleViewMode = useCallback(() => {
    setIsSpiralView((prev) => !prev);
  }, []);

  return (
    <Layout>
      <NavBar
        randomFillEnabled={randomFillEnabled}
        toggleRandomization={() => setRandomFillEnabled((prev) => !prev)}
        folders={folders}
        onFolderSelect={handleFolderSelect}
        toggleViewMode={toggleViewMode}
        isSpiralView={isSpiralView}
      />
      <div className="pt-13 p-1 flex-grow">
        {(folderError || filesError) && <div className="text-red-500">{folderError || filesError}</div>}
        <PlateGrid
          files={displayFiles}
          selectedFolder={selectedFolder}
          isSpiralView={isSpiralView}
          randomFillEnabled={randomFillEnabled}
          onSelectAction={handleSelectAction}
          windowWidth={windowWidth}
        />
      </div>
      <footer className="text-center select-none">© Josh Garber 2025</footer>
    </Layout>
  );
};

export default MainApp;
