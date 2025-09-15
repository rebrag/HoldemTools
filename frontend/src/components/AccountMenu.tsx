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
    <div className="space-y-2">
      {/* Desktop view: show full account info */}
      <div className="hidden sm:flex items-center flex-wrap gap-2">
        <span className="text-sm font-bold">Account:</span>
        <span className="text-sm">{user?.email}</span>
        <button onClick={handleLogout} className="text-xs text-blue-600 hover:underline">
          Logout
        </button>
      </div>
      {/* Mobile view: compact */}
      <div className="flex sm:hidden">
        <button onClick={handleLogout} className="text-xs text-blue-600 hover:underline">
          Logout
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
};

export default AccountMenu;
