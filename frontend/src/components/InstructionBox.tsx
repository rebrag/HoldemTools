import React, { useState, useEffect, useRef } from "react";
import Draggable from "react-draggable";

interface InstructionBoxProps {
  children: React.ReactNode;
}

const InstructionBox: React.FC<InstructionBoxProps> = ({ children }) => {
  const [visible, setVisible] = useState<boolean>(true);
  const [fadeClass, setFadeClass] = useState("opacity-0"); // Start faded out
  const storageKey = "instructionBoxClosedAt";
  // For testing; change back to 5 hours in a real scenario.
  const fiveHours = 5*60*60*1000; //

  // Check if the instructions were recently closed.
  useEffect(() => {
    const closedAt = localStorage.getItem(storageKey);
    if (closedAt) {
      const closedTime = new Date(closedAt).getTime();
      const currentTime = Date.now();
      if (currentTime - closedTime < fiveHours) {
        setVisible(false);
      }
    }
  }, [fiveHours]);

  // Fade in the box after a delay.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeClass("opacity-100");
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    // Fade out before hiding.
    setFadeClass("opacity-0");
    setTimeout(() => {
      localStorage.setItem(storageKey, new Date().toISOString());
      setVisible(false);
    }, 500);
  };

  // Calculate initial centered position.
  const boxMaxWidth = 600;
  const viewportWidth = window.innerWidth;
  const computedWidth = viewportWidth * 0.8 > boxMaxWidth ? boxMaxWidth : viewportWidth * 0.8;
  const initialX = (viewportWidth - computedWidth) / 2;
  const defaultPos = { x: initialX, y: 70 };

  const nodeRef = useRef<HTMLDivElement>(null);

  if (!visible) return null;

  return (
    <Draggable
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      defaultPosition={defaultPos}
      cancel=".no-drag"  // Prevent dragging when interacting with elements with this class
    >
      <div
        ref={nodeRef}
        className={`relative border border-gray-300 rounded-xl p-6 bg-white/90 shadow-md transition-opacity duration-500 ${fadeClass}`}
        style={{
          width: "80vw",    // 80% of viewport width
          maxWidth: "600px", // Maximum 600px
          zIndex: 1000,
        }}
      >
        <button
          onClick={handleClose}
          className="no-drag text-3xl p-2 absolute top-2 right-4 text-gray-500 hover:text-gray-700"
          aria-label="Close instructions"
        >
          &#x2715;
        </button>
        {children}
      </div>
    </Draggable>
  );
};

export default InstructionBox;
