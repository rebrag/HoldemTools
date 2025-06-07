// src/components/RandomizeButton.tsx
import React, { useState } from "react"; //, useEffect
import { motion } from "framer-motion";

export interface RandomizeButtonProps {
  randomFillEnabled: boolean;
  setRandomFillEnabled: () => void;
  // Optional prop to set the animation speed in seconds (default: 0.5)
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

  // Listen for "r" key to trigger the animation
  // useEffect(() => {
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     if (e.key.toLowerCase() === "r") {
  //       triggerAnimation();
  //     }
  //   };
  //   window.addEventListener("keydown", handleKeyDown);
  //   return () => window.removeEventListener("keydown", handleKeyDown);
  // // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [animationSpeed]);

  // Combined spin and shake variant
  const variants = {
    idle: { rotate: 0, x: 0 },
    spinShake: {
      rotate: [0, 360],
      x: [0, -10, 10, -10, 10, 0],
      transition: { duration: animationSpeed, ease: "easeInOut" },
    },
  };

  return (
    <motion.button onClick={handleClick} className="focus:outline-none select-none">
      <motion.img
        src="/dice.svg"
        alt="Dice"
        style={{ width: "40px", height: "40px" }}
        animate={animate ? "spinShake" : "idle"}
        variants={variants}
        whileHover={{ scale: 1.2 }}
      />
    </motion.button>
  );
};

export default RandomizeButton;
