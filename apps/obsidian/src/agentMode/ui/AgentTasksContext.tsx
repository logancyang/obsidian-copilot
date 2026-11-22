import type { AgentTask } from "@/agentMode/session/AgentSession";
import React, { createContext, useContext, useMemo } from "react";

export interface AgentTasksContextValue {
  tasks: readonly AgentTask[];
  openTask: (toolCallId: string) => void;
}

const AgentTasksContext = createContext<AgentTasksContextValue | null>(null);

interface AgentTasksProviderProps extends AgentTasksContextValue {
  children: React.ReactNode;
}

export const AgentTasksProvider: React.FC<AgentTasksProviderProps> = ({
  tasks,
  openTask,
  children,
}) => {
  const value = useMemo(() => ({ tasks, openTask }), [tasks, openTask]);
  return <AgentTasksContext.Provider value={value}>{children}</AgentTasksContext.Provider>;
};

export function useAgentTasks(): AgentTasksContextValue | null {
  return useContext(AgentTasksContext);
}
