// src/components/RandomizeButton.tsx
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

export interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
  // Optional prop to set the animation speed in seconds (default: 0.5)
  animationSpeed?: number;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  //randomFillEnabled,
  setRandomFillEnabled,
  animationSpeed = 0.5,
}) => {
  const [animate, setAnimate] = useState(false);

  const triggerAnimation = () => {
    setAnimate(true);
    setRandomFillEnabled();
    // End animation after the specified duration
    setTimeout(() => setAnimate(false), animationSpeed * 1000);
  };

  const handleClick = () => {
    triggerAnimation();
  };

  // Listen for "r" key to trigger the animation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r") {
        triggerAnimation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [animationSpeed]);

  // Framer Motion variants for spin (or you can swap to "shake" if desired)
  const variants = {
    idle: { rotate: 0 },
    spin: {
      rotate: [0, 540],
      transition: { duration: animationSpeed, ease: "easeInOut" },
    },
    // Example shake variant (uncomment to use)
    // shake: {
    //   x: [0, -10, 10, -10, 10, 0],
    //   transition: { duration: animationSpeed, ease: "easeInOut" },
    // },
  };

  return (
    <motion.button onClick={handleClick} className="focus:outline-none">
      <motion.img
        src="/dice.svg"
        alt="Dice"
        style={{ width: "40px", height: "40px" }}
        animate={animate ? "spin" : "idle"}
        variants={variants}
        whileHover={{scale: 1.2}}
      />


    </motion.button>
  );
};

export default RandomizeButton;
