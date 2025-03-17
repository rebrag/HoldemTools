// RandomizeButton.tsx (snippet)
import React from "react";
import Button from "./ButtonStyle"; // Adjust path as needed

interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  randomFillEnabled,
  setRandomFillEnabled,
}) => {
  return (
    <Button onClick={setRandomFillEnabled}>
      {randomFillEnabled ? "Disable Randomize" : "Randomize"}
    </Button>
  );
};

export default RandomizeButton;
