import React from 'react';

interface LineProps {
  line: string[];
  // Called when a line button is clicked; index indicates which button.
  onLineClick: (action: number) => void;
}

const Line: React.FC<LineProps> = ({ line, onLineClick }) => {
  return (
    <div className="flex flex-wrap gap-1 p-1 z-10">
      Line:
      {line.map((action, index) => (
        <button
          key={index}
          onClick={() => onLineClick(index)}
          className="px-1.5 py-0.5 bg-gray-200 hover:bg-gray-300 text-black rounded-md transition-colors"
        >
          {action === 'Root' ? 'Reset' : action}
        </button>
      ))}
    </div>
  );
};

export default Line;
