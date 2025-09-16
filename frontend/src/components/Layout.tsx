import React from "react";
interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="h-auto flex flex-col bg-gradient-to-br from-gray-700 to-gray-400">
      {children}
    </div>
  );
};

export default Layout;
