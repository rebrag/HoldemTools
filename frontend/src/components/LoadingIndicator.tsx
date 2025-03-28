import React from "react";
import FadeLoader from "react-spinners/FadeLoader";

const LoadingIndicator: React.FC = () => {
  return (
    <div
      style={{
      }}
    >
      <FadeLoader radius={1} color="#000000" />
    </div>
  );
};

export default LoadingIndicator;
