// src/hooks/useHistoryState.ts
import { useCallback } from "react";

const useHistoryState = () => {
    const pushHistoryState = useCallback(
      (newRoot: string, newClicked: string, folder: string) => {
        const state = { rootPrefix: newRoot, clickedRoot: newClicked, folder };
        window.history.pushState(state, "", "");
      },
      []
    );
    return { pushHistoryState };
  };
  
  export default useHistoryState;
  