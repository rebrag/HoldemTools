import React from "react";

interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: (enabled: boolean) => void;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  randomFillEnabled,
  setRandomFillEnabled,
}) => {
  return (
    <button
      onClick={() => setRandomFillEnabled(!randomFillEnabled)}
      className={`px-4 py-2 rounded-lg font-bold text-white transition ${
        randomFillEnabled ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"
      }`}
    >
      {randomFillEnabled ? "Disable Randomization (r)" : "Enable Randomization (r)"}
    </button>
  );
};

export default RandomizeButton;
