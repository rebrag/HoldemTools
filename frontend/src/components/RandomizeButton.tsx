// src/components/RandomizeButton.tsx
import React, { useState, useEffect } from "react";
import { FaDice } from "react-icons/fa";

export interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
  // Optional prop to set the animation speed in seconds (default: 0.5)
  animationSpeed?: number;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  randomFillEnabled,
  setRandomFillEnabled,
  animationSpeed = 0.4,
}) => {
  const [animating, setAnimating] = useState(false);

  const triggerAnimation = () => {
    setAnimating(true);
    setRandomFillEnabled();
    // Remove animation after the specified duration (in ms)
    setTimeout(() => setAnimating(false), animationSpeed * 1000);
  };

  const handleClick = () => {
    triggerAnimation();
  };

  // Listen for "r" key presses to trigger the animation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r") {
        triggerAnimation();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationSpeed]);

  return (
    <button onClick={handleClick} className="focus:outline-none">
      <FaDice
        className={`w-8 h-8 ${animating ? "animate-spin" : ""}`}
        style={animating ? { animationDuration: `${animationSpeed}s` } : {}}
        color={randomFillEnabled ? "#4CAF50" : "#000000"}
      />
    </button>
  );
};

export default RandomizeButton;
