// src/components/RandomizeModeButton.tsx
import React from "react";

interface RandomizeModeButtonProps {
  randomize: boolean;
  toggleRandomize: () => void;
}

const RandomizeModeButton: React.FC<RandomizeModeButtonProps> = ({ randomize, toggleRandomize }) => {
  return (
    <button
      className="mb-4 px-4 py-2 bg-green-500 text-white rounded shadow-md"
      onClick={toggleRandomize}
    >
      {randomize ? "Disable Randomization" : "Randomize Strategies"}
    </button>
  );
};

export default RandomizeModeButton;
