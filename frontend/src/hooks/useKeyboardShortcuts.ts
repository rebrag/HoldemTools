import { useEffect } from "react";

type Options = {
  onToggleRandom: () => void;
};

const useKeyboardShortcuts = ({ onToggleRandom }: Options) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [onToggleRandom]);
};

export default useKeyboardShortcuts;
