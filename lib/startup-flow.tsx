import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type StartupFlowState = {
  enabled: boolean;
  guideCompleted: boolean;
  setGuideCompleted: (completed: boolean) => void;
};

const StartupFlowContext = createContext<StartupFlowState | null>(null);

/**
 * Modal coordination for the first launch:
 * permissions -> driver setup -> period setup -> guide -> weekly survey.
 * The dashboard reports when its own guide is finished, including when the
 * completion flag is restored from user-scoped local storage.
 */
export function StartupFlowProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [guideCompleted, setGuideCompleted] = useState(false);
  const value = useMemo(
    () => ({ enabled, guideCompleted, setGuideCompleted }),
    [enabled, guideCompleted],
  );
  return <StartupFlowContext.Provider value={value}>{children}</StartupFlowContext.Provider>;
}

export function useStartupFlow(): StartupFlowState {
  const value = useContext(StartupFlowContext);
  if (!value) throw new Error("useStartupFlow must be used inside StartupFlowProvider");
  return value;
}
