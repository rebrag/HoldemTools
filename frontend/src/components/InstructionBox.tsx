import React, { useState, useEffect } from "react";

interface InstructionBoxProps {
  children: React.ReactNode;
}

const InstructionBox: React.FC<InstructionBoxProps> = ({ children }) => {
  const [visible, setVisible] = useState(true);
  const storageKey = "instructionBoxClosedAt";
  const fiveHours = 5 * 60 * 60 * 1000; // 5 hours in milliseconds

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

  const handleClose = () => {
    localStorage.setItem(storageKey, new Date().toISOString());
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="relative border border-gray-300 rounded-xl p-4 mt-4 bg-white/70 shadow-md">
      <button
        onClick={handleClose}
        className="absolute top-1 right-1 text-gray-500 hover:text-gray-700"
        aria-label="Close instructions"
      >
        &#x2715;
      </button>
      {children}
    </div>
  );
};

export default InstructionBox;
