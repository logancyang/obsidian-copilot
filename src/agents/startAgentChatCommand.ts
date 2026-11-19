import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate, subscribeToCustomAgentsGate } from "@/agents/customAgentsGate";
import { AgentPickerModal } from "@/agents/ui/AgentPickerModal";
import { logError } from "@/logger";
import { Notice, type Plugin } from "obsidian";

export const START_AGENT_CHAT_COMMAND_ID = "start-chat-with-agent";

type RemovableCommands = Plugin & { removeCommand(id: string): void };

// The command exists only while custom agents are fully available, so a build without the team license shows nothing new, not even in Hotkeys.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/937
export function registerStartAgentChatCommand(
  plugin: Plugin,
  store: CustomAgentStore,
  startChat: (agent: CustomAgent) => Promise<void>
): () => void {
  let registered = false;
  const start = (agent: CustomAgent): void => {
    startChat(agent).catch((error) => {
      logError(`[Custom agents] Could not start a chat with ${agent.slug}`, error);
      new Notice("Could not start the chat. Check the Copilot log.");
    });
  };
  const sync = (): void => {
    const available = getCustomAgentsGate() === "full";
    if (available === registered) return;
    registered = available;
    if (!available) {
      (plugin as RemovableCommands).removeCommand(START_AGENT_CHAT_COMMAND_ID);
      return;
    }
    plugin.addCommand({
      id: START_AGENT_CHAT_COMMAND_ID,
      name: "Start a chat with an agent",
      callback: () => new AgentPickerModal(plugin.app, store.getAgents(), start).open(),
    });
  };
  sync();
  const unsubscribe = subscribeToCustomAgentsGate(sync);
  return () => {
    unsubscribe();
    if (registered) (plugin as RemovableCommands).removeCommand(START_AGENT_CHAT_COMMAND_ID);
  };
}
