// src/components/AccountMenu.tsx
import { auth } from "../firebase";
import { signOut } from "firebase/auth";
import { useState } from "react";

const AccountMenu = () => {
  const user = auth.currentUser;
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <div>
      {/* Desktop view: show full account info */}
      <div className="hidden sm:flex items-center space-x-2">
        <span className="text-sm font-bold">Account:</span>
        <span className="text-sm">{user?.email}</span>
        <button onClick={handleLogout} className="text-xs text-blue-500 hover:underline">
          Logout
        </button>
      </div>
      {/* Mobile view: show only a small logout button */}
      <div className="flex sm:hidden ">
        <button onClick={handleLogout} className="text-xs text-blue-500 cursor-pointer hover:underline">
          Logout
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
};

export default AccountMenu;
