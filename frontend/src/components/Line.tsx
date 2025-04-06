import React from 'react';

interface LineProps {
  line: string[];
  // Called when a line button is clicked; index indicates which button.
  onLineClick: (action: number) => void;
}

const Line: React.FC<LineProps> = ({ line, onLineClick }) => {
  return (
    <div className="flex flex-wrap gap-2 p-1">
      Line:
      {line.map((action, index) => (
        <button
          key={index}
          onClick={() => onLineClick(index)}
          className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 text-black rounded-lg transition-colors"
        >
          {action === 'Root' ? 'Reset' : action}
        </button>
      ))}
    </div>
  );
};

export default Line;
