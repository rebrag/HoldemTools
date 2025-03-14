// src/hooks/useKeyboardShortcuts.ts
import { useEffect } from "react";

type Options = {
  onBackspace: () => void;
  onToggleRandom: () => void;
};

const useKeyboardShortcuts = ({ onBackspace, onToggleRandom }: Options) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        onBackspace();
      }
      if (
        e.key.toLowerCase() === "r" &&
        document.activeElement &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        onToggleRandom();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBackspace, onToggleRandom]);
};

export default useKeyboardShortcuts;
