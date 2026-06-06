import React, { useState, useEffect, useRef } from "react";
import Draggable from "react-draggable";

interface InstructionBoxProps {
  children: React.ReactNode;
  onClose: () => void;          // ← new
}

const InstructionBox: React.FC<InstructionBoxProps> = ({ children, onClose }) => {
  /* simple fade-in / fade-out */
  const [fadeClass, setFadeClass] = useState("opacity-0");
  useEffect(() => { const t = setTimeout(() => setFadeClass("opacity-100"), 50); return () => clearTimeout(t); }, []);

  const nodeRef = useRef<HTMLDivElement>(null);

  /* centred default position */
  const w = Math.min(window.innerWidth * 0.8, 600);
  const defaultPos = { x: (window.innerWidth - w) / 2, y: 70 };

  const handleClose = () => {
    setFadeClass("opacity-0");
    setTimeout(onClose, 300);
  };

  return (
    <Draggable nodeRef={nodeRef as React.RefObject<HTMLDivElement>} defaultPosition={defaultPos} cancel=".no-drag">
      <div
        ref={nodeRef}
        className={`relative border border-gray-300 rounded-xl p-6 bg-white/90 shadow-md transition-opacity duration-300 ${fadeClass}`}
        style={{ width: "80vw", maxWidth: "600px", zIndex: 1000 }}
      >
        <button
          className="no-drag text-3xl p-2 absolute top-2 right-4 text-gray-500 hover:text-gray-700"
          aria-label="Close instructions"
          onClick={handleClose}
        >
          ×
        </button>
        {children}
      </div>
    </Draggable>
  );
};

export default InstructionBox;
