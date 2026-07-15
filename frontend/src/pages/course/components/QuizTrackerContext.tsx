import React, { createContext, useCallback, useContext, useRef } from "react";

type QuizTrackerCtx = {
  register: (id: string) => void;
  unregister: (id: string) => void;
  reportCorrect: (id: string) => void;
} | null;

const QuizTrackerContext = createContext<QuizTrackerCtx>(null);

export function useQuizTrackerContext() {
  return useContext(QuizTrackerContext);
}

interface QuizTrackerProps {
  onAllCorrect: () => void;
  children: React.ReactNode;
}

export const QuizTracker: React.FC<QuizTrackerProps> = ({ onAllCorrect, children }) => {
  const registered = useRef(new Set<string>());
  const correct = useRef(new Set<string>());
  const fired = useRef(false);

  // Always call the latest version of onAllCorrect without making it a dep of reportCorrect
  const onAllCorrectRef = useRef(onAllCorrect);
  onAllCorrectRef.current = onAllCorrect;

  const register = useCallback((id: string) => {
    registered.current.add(id);
  }, []);

  const unregister = useCallback((id: string) => {
    registered.current.delete(id);
    correct.current.delete(id);
  }, []);

  const reportCorrect = useCallback((id: string) => {
    if (fired.current) return;
    correct.current.add(id);
    if (
      registered.current.size > 0 &&
      correct.current.size >= registered.current.size
    ) {
      fired.current = true;
      onAllCorrectRef.current();
    }
  }, []);

  return (
    <QuizTrackerContext.Provider value={{ register, unregister, reportCorrect }}>
      {children}
    </QuizTrackerContext.Provider>
  );
};
