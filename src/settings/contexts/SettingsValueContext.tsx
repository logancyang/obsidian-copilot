import { CopilotSettings } from "@/settings/SettingsPage";
import React, { createContext, useContext } from "react";

const SettingsValueContext = createContext<CopilotSettings | undefined>(undefined);

export const SettingsValueProvider: React.FC<{
  value: CopilotSettings;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return <SettingsValueContext.Provider value={value}>{children}</SettingsValueContext.Provider>;
};

export const useSettingsValueContext = () => {
  const context = useContext(SettingsValueContext);
  if (context === undefined) {
    throw new Error("useSettingsValueContext must be used within a SettingsValueProvider");
  }
  return context;
};
