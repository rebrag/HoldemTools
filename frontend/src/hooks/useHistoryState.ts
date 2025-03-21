// src/hooks/useHistoryState.ts
import { useCallback } from "react";

const useHistoryState = () => {
    const pushHistoryState = useCallback(
        (newRoot: string, newClicked: string, folder: string, matrixFiles?: string[]) => {
          const state = { rootPrefix: newRoot, clickedRoot: newClicked, folder, matrixFiles };
          console.log("Pushing history state:", state);
          window.history.pushState(state, "", "");
        },
        []
      );      
  return { pushHistoryState };
};

export default useHistoryState;
