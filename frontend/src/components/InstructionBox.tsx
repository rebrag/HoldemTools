import React, { useState, useEffect, useRef } from "react";
import Draggable from "react-draggable";

interface InstructionBoxProps {
  children: React.ReactNode;
}

const InstructionBox: React.FC<InstructionBoxProps> = ({ children }) => {
  const [visible, setVisible] = useState<boolean>(true);
  const [fadeClass, setFadeClass] = useState("opacity-0"); // Start faded out
  const storageKey = "instructionBoxClosedAt";
  // For testing we use 500ms; change this back to 5 * 60 * 60 * 1000 for 5 hours.
  const fiveHours = 5*60*60*1000;

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
    // Start the fade-out animation.
    setFadeClass("opacity-0");
    // After fade-out duration (500ms), mark the box as not visible.
    setTimeout(() => {
      localStorage.setItem(storageKey, new Date().toISOString());
      setVisible(false);
    }, 500);
  };

  // For calculating the initial centered position:
  const boxMaxWidth = 600;
  const viewportWidth = window.innerWidth;
  // Use 80vw but cap at 600px.
  const computedWidth = viewportWidth * 0.8 > boxMaxWidth ? boxMaxWidth : viewportWidth * 0.8;
  const initialX = (viewportWidth - computedWidth) / 2;
  const defaultPos = { x: initialX, y: 70 };

  const nodeRef = useRef<HTMLDivElement>(null);

  if (!visible) return null;

  return (
    <Draggable nodeRef={nodeRef as React.RefObject<HTMLElement>} defaultPosition={defaultPos}>
      <div
        ref={nodeRef}
        className={`relative border border-gray-300 rounded-xl p-6 bg-white/90 shadow-md transition-opacity duration-500 ${fadeClass}`}
        style={{
          width: "80vw",    // 80% of the viewport width
          maxWidth: "600px", // Maximum of 600px
          zIndex: 1000,
        }}
      >
        <button
          onClick={handleClose}
          className="absolute top-2 right-4 text-gray-500 hover:text-gray-700"
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
