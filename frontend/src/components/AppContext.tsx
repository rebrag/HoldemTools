// AppContext.tsx
import React, { createContext, useReducer, useContext, ReactNode } from "react";

interface AppState {
  folder: string;
  plateMapping: Record<string, string>;
}

type Action =
  | { type: "SET_FOLDER"; payload: string }
  | { type: "SET_PLATE_MAPPING"; payload: Record<string, string> };

const initialState: AppState = {
  folder: "20BTN_20BB",
  plateMapping: {},
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | undefined>(undefined);

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_FOLDER":
      return { ...state, folder: action.payload };
    case "SET_PLATE_MAPPING":
      return { ...state, plateMapping: action.payload };
    default:
      return state;
  }
}

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
