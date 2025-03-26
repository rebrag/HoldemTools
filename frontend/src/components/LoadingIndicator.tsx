import React from "react";

const LoadingIndicator: React.FC = () => {
  return (
    <div
      style={{
        display: "inline-block",
        padding: "8px 12px",
        background: "rgba(0, 0, 0, 0.7)",
        color: "white",
        borderRadius: "4px",
        fontSize: "0.9rem",
        textAlign: "center",
        marginTop: "8px"
      }}
    >
      ^_^ Loading...
    </div>
  );
};

export default LoadingIndicator;
