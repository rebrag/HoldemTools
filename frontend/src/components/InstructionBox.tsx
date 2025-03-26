import React from "react";

interface InstructionBoxProps {
  children: React.ReactNode;
}

const InstructionBox: React.FC<InstructionBoxProps> = ({ children }) => {
  return (
    <div className="border border-gray-300 rounded-xl p-4 mt-4 bg-white/70 shadow-md">
      {children}
    </div>
  );
};

export default InstructionBox;
