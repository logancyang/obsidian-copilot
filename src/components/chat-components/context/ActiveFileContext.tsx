import React, { createContext, useContext } from "react";
import { TFile } from "obsidian";

/**
 * Context that provides the current active file to Lexical nodes
 * This allows pills and other components to reactively display information
 * about the currently active file in Obsidian
 */
interface ActiveFileContextType {
  currentActiveFile: TFile | null;
}

const ActiveFileContext = createContext<ActiveFileContextType | undefined>(undefined);

/**
 * Hook to access the current active file from any component
 * within the Lexical editor tree
 */
export function useActiveFile(): TFile | null {
  const context = useContext(ActiveFileContext);
  if (context === undefined) {
    // Return null if used outside provider instead of throwing
    // This allows pills to work even if context isn't set up
    return null;
  }
  return context.currentActiveFile;
}

interface ActiveFileProviderProps {
  currentActiveFile: TFile | null;
  children: React.ReactNode;
}

/**
 * Provider component that makes the current active file available
 * to all descendant components
 */
export function ActiveFileProvider({ currentActiveFile, children }: ActiveFileProviderProps) {
  return (
    <ActiveFileContext.Provider value={{ currentActiveFile }}>
      {children}
    </ActiveFileContext.Provider>
  );
}
