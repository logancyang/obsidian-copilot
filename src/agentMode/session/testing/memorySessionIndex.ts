import { AgentSessionIndex } from "@/agentMode/session/AgentSessionIndex";

export function createMemorySessionIndex(): AgentSessionIndex {
  const files = new Map<string, string>();
  return new AgentSessionIndex(
    {
      exists: async (path) => files.has(path),
      read: async (path) => files.get(path) ?? "",
      write: async (path, content) => {
        files.set(path, content);
      },
    },
    "agent-chat-index.json"
  );
}
