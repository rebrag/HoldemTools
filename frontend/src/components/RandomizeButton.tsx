// src/components/RandomizeButton.tsx
import React from "react";

interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
  square?: boolean;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  randomFillEnabled,
  setRandomFillEnabled,
  square = false,
}) => {
  return (
    <button
      onClick={setRandomFillEnabled}
      className={`rounded transition duration-200 ease-in-out ${
        square
          ? "w-10 h-10 text-sm bg-green-500 hover:bg-green-600"
          : "px-4 py-2 text-sm bg-green-500 hover:bg-green-600"
      }`}
    >
      {square ? "R" : randomFillEnabled ? "Disable Random" : "Randomize"}
    </button>
  );
};

export default RandomizeButton;
