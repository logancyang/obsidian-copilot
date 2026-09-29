import React, { createContext, useContext, useMemo } from "react";

export const EMPTY_CLOUD_AGENT_IDS: ReadonlySet<string> = Object.freeze(new Set<string>());

const CloudAgentContext = createContext<ReadonlySet<string>>(EMPTY_CLOUD_AGENT_IDS);

export function useCloudAgentIds(): ReadonlySet<string> {
  return useContext(CloudAgentContext);
}

interface CloudAgentProviderProps {
  cloudAgentIds: ReadonlySet<string>;
  children: React.ReactNode;
}

export function CloudAgentProvider({ cloudAgentIds, children }: CloudAgentProviderProps) {
  const value = useMemo(() => cloudAgentIds, [cloudAgentIds]);
  return <CloudAgentContext.Provider value={value}>{children}</CloudAgentContext.Provider>;
}
