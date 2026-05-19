import type CopilotPlugin from "@/main";
import React, { createContext, useContext } from "react";

const PluginContext = createContext<CopilotPlugin | undefined>(undefined);

export const PluginProvider: React.FC<{
  plugin: CopilotPlugin;
  children: React.ReactNode;
}> = ({ plugin, children }) => (
  <PluginContext.Provider value={plugin}>{children}</PluginContext.Provider>
);

export const usePlugin = (): CopilotPlugin => {
  const plugin = useContext(PluginContext);
  if (!plugin) throw new Error("usePlugin must be used inside <PluginProvider>");
  return plugin;
};
