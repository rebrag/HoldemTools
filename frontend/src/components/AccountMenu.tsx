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
    <div className="border-b-neutral-800" style={{ padding: "1rem", textAlign: "right" }}>
      {user ? (
        <>
          <div>
            <strong>Account:</strong> {user.email}
          </div>
          <button onClick={handleLogout} style={{ marginTop: "0.5rem" }}>
            Logout
          </button>
        </>
      ) : (
        <div>No user signed in.</div>
      )}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
};

export default AccountMenu;
