import type { CopilotSettingsTabId } from "@/settings/settingsTabs";
import React, { createContext, useContext, useMemo, useState } from "react";

interface TabContextType {
  selectedTab: CopilotSettingsTabId;
  setSelectedTab: (tab: CopilotSettingsTabId) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

interface TabProviderProps {
  children: React.ReactNode;
  initialTab?: CopilotSettingsTabId;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children, initialTab = "basic" }) => {
  const [selectedTab, setSelectedTab] = useState<CopilotSettingsTabId>(initialTab);

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
