import type { Query } from "@anthropic-ai/claude-agent-sdk";

// sdk.d.ts omits this Query control although the SDK implements it. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
interface UndeclaredQueryControls {
  cancelAsyncMessage(messageUuid: string): Promise<boolean>;
}

export function cancelQueuedMessage(query: Query, messageUuid: string): Promise<boolean> {
  return (query as Query & UndeclaredQueryControls).cancelAsyncMessage(messageUuid);
}
