import type { ClientView } from "@/agentMode/protocol/ClientView";
import type { CommandResult } from "@/agentMode/protocol/commands";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import type { BackendId, ModelSelection, SessionId } from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import { useMemo } from "react";

export interface TabCommands {
  createTab(): Promise<CommandResult<{ sessionId: SessionId }>>;
  showTab(id: SessionId): void;
  closeTab(id: SessionId): Promise<CommandResult>;
  renameTab(id: SessionId, label: string | null): Promise<CommandResult>;
  replaceTab(
    id: SessionId,
    options?: { backendId?: BackendId; preserveChatInput?: boolean; seedSelection?: ModelSelection }
  ): Promise<CommandResult<{ sessionId: SessionId }>>;
}

// A command that fails is reported to the caller as a result; the log line keeps the host's
// reason for a support report without surfacing it to the user.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/612
function logged<V>(name: string, result: CommandResult<V>): CommandResult<V> {
  if (!result.ok) logWarn(`[AgentMode] ${name} command failed (${result.code}): ${result.message}`);
  return result;
}

export function useTabCommands(client: SessionClient, view: ClientView): TabCommands {
  return useMemo(() => {
    const scopeOf = (id: SessionId): ProjectScopeId =>
      client.getHost()?.tabs.find((tab) => tab.id === id)?.projectId ?? view.getProjectScope();
    return {
      async createTab() {
        const projectId = view.getProjectScope();
        const result = logged(
          "createSession",
          await client.command({ name: "createSession", projectId })
        );
        if (result.ok) view.activate({ id: result.value.sessionId, projectId });
        return result;
      },
      showTab(id) {
        const tab = client.getHost()?.tabs.find((candidate) => candidate.id === id);
        if (tab) view.activate({ id, projectId: tab.projectId, chatInputId: tab.chatInputId });
      },
      closeTab: async (id) =>
        logged("closeTab", await client.command({ name: "closeTab", sessionId: id })),
      renameTab: async (id, label) =>
        logged(
          "renameSession",
          await client.command({ name: "renameSession", sessionId: id, label })
        ),
      async replaceTab(id, options = {}) {
        const projectId = scopeOf(id);
        const result = logged(
          "replaceSession",
          await client.command({ name: "replaceSession", sessionId: id, ...options })
        );
        if (result.ok) view.activate({ id: result.value.sessionId, projectId });
        return result;
      },
    };
  }, [client, view]);
}
