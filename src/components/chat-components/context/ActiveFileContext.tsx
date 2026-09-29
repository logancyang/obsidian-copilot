import React, { createContext, useContext, useMemo } from "react";
import { TFile } from "obsidian";

interface ActiveFileContextType {
  currentActiveFile: TFile | null;
}

const ActiveFileContext = createContext<ActiveFileContextType | undefined>(undefined);

export function useActiveFile(): TFile | null {
  const context = useContext(ActiveFileContext);
  if (context === undefined) {
    return null;
  }
  return context.currentActiveFile;
}

interface ActiveFileProviderProps {
  currentActiveFile: TFile | null;
  children: React.ReactNode;
}

export function ActiveFileProvider({ currentActiveFile, children }: ActiveFileProviderProps) {
  const value = useMemo(() => ({ currentActiveFile }), [currentActiveFile]);
  return <ActiveFileContext.Provider value={value}>{children}</ActiveFileContext.Provider>;
}
