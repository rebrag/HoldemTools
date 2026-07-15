// src/components/AccountMenu.tsx
import React from "react";

type AccountMenuProps = {
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  displayLabel?: boolean;        // when true, show "Account:"
  userEmail?: string | null;
};

const AccountMenu: React.FC<AccountMenuProps> = ({
  isLoggedIn,
  onLogin,
  onLogout,
  displayLabel = false,
  userEmail,
}) => {
  return (
    <div className="flex flex-col gap-2">
      {displayLabel && (
        <div className="text-sm font-medium text-gray-700">
          Account{userEmail ? `: ${userEmail}` : ":"}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            isLoggedIn ? onLogout() : onLogin();
          }}
          className="rounded-md bg-gray-900 text-white px-3 py-1.5 text-sm hover:bg-gray-800"
        >
          {isLoggedIn ? "Logout" : "Login"}
        </button>

      </div>
    </div>
  );
};

export default AccountMenu;
