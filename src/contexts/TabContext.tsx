import React, { createContext, useContext, useMemo, useState } from "react";

interface TabContextType {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider: React.FC<{ children: React.ReactNode; initialTab?: string }> = ({
  children,
  initialTab = "basic",
}) => {
  // Obsidian creates a fresh settings tree for a one-shot Relevant Notes
  // handoff, so that tree must be able to start on Miyo instead of Basic.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const [selectedTab, setSelectedTab] = useState(initialTab);

  const value = useMemo(() => ({ selectedTab, setSelectedTab }), [selectedTab]);

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};

export const useTab = () => {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTab must be used within a TabProvider");
  }
  return context;
};
