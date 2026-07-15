//import React from "react";

const DealerButton = () => (
  <svg
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    width="100%"
    height="100%"
    style={{ filter: "drop-shadow(2px 3px 4px rgba(0,0,0,0.4))" }}
  >
    <defs>
      <radialGradient id="shimmer" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stopColor="white" stopOpacity="0.9" />
        <stop offset="40%" stopColor="lightgray" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#aaa" stopOpacity="1" />
      </radialGradient>
    </defs>

    {/* Slightly offset background ring for 3D look */}
    <circle cx="50" cy="50" r="25" stroke="gray" fill="url(#shimmer)" strokeWidth="5" />
    {/* Foreground ring */}
    <circle cx="50" cy="45" r="25" stroke="black" fill="url(#shimmer)" strokeWidth="5" />

    {/* Letter */}
    <text
      x="50"
      y="50"
      textAnchor="middle"
      fontWeight="bold"
      fontSize="20"
      fill="black"
      fontFamily="Arial, sans-serif"
    >
      D
    </text>
  </svg>
);

export default DealerButton;
