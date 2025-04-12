import React from "react";
import PuffLoader from "react-spinners/PuffLoader";

const LoadingIndicator: React.FC = () => {
  return (
    <div
      style={{
      }}
    >
      <PuffLoader size={100} color="#000000" />
    </div>
  );
};

export default LoadingIndicator;
