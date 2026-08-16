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
    <div className="flex min-w-0 flex-col gap-2">
      {displayLabel && (
        <div className="min-w-0 text-xs font-medium text-slate-400">
          Account
          {userEmail ? (
            <span className="block truncate text-sm text-slate-200" title={userEmail}>
              {userEmail}
            </span>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            isLoggedIn ? onLogout() : onLogin();
          }}
          className={
            isLoggedIn
              ? "rounded-lg border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              : "rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition-all hover:shadow-glow"
          }
        >
          {isLoggedIn ? "Logout" : "Login"}
        </button>

      </div>
    </div>
  );
};

export default AccountMenu;
