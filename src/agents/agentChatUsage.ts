import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import { ensureEntitlement } from "@/plusUtils";
import type { App } from "obsidian";

interface PromptListener {
  onMessagesChanged(): void;
  onStatusChanged(): void;
  onPromptSent(): void;
}

interface PromptedChat {
  subscribe(listener: PromptListener): () => void;
}

export function countAgentChatUse(app: App, chat: PromptedChat): void {
  // The license check is the only usage signal custom agents send; one per chat, on its first message, keeps it within the /license rate limit.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/594
  const stop = chat.subscribe({
    onMessagesChanged: () => {},
    onStatusChanged: () => {},
    onPromptSent: () => {
      stop();
      void ensureEntitlement(app, "custom_agents", () => getCustomAgentsGate() === "full");
    },
  });
}
