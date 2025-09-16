import React from "react";
import { useDisableMobileGestures } from "../hooks/useDisableMobileGestures";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  useDisableMobileGestures();
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-700 to-gray-400">
      {children}
    </div>
  );
};

export default Layout;
