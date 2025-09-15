// src/components/RandomizeButton.tsx
import React, { useState } from "react";
import { motion } from "framer-motion";

export interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
  animationSpeed?: number;
}

const RandomizeButton: React.FC<RandomizeButtonProps> = ({
  setRandomFillEnabled,
  animationSpeed = 0.5,
}) => {
  const [animate, setAnimate] = useState(false);

  const triggerAnimation = () => {
    setAnimate(true);
    setRandomFillEnabled();
    // End the animation after the specified duration
    setTimeout(() => setAnimate(false), animationSpeed * 1000);
  };

  const handleClick = () => {
    triggerAnimation();
  };

  const variants = {
    idle: { rotate: 0 },
    spin: {
      rotate: [0, 360],
      transition: { duration: animationSpeed, ease: "easeInOut" },
    },
  };


  return (
    <motion.button onClick={handleClick} className="focus:outline-none select-none">
      <motion.img
        src="/diceOrig.svg"
        alt="Dice"
        style={{ width: 40, height: 40 }}
        animate={animate ? "spin" : "idle"} 
        variants={variants}
        whileHover={{ scale: 1.1 }}
      />
    </motion.button>
  );
};

export default RandomizeButton;
