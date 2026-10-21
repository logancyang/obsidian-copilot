import type { Query, SDKControlInterruptResponse } from "@anthropic-ai/claude-agent-sdk";

// sdk.d.ts omits these Query controls although the SDK implements them. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
interface UndeclaredQueryControls {
  interrupt(options: { cancelQueued: boolean }): Promise<SDKControlInterruptResponse | undefined>;
  cancelAsyncMessage(messageUuid: string): Promise<boolean>;
}

export function interruptAndCancelQueued(
  query: Query
): Promise<SDKControlInterruptResponse | undefined> {
  return (query as Query & UndeclaredQueryControls).interrupt({ cancelQueued: true });
}

export function cancelQueuedMessage(query: Query, messageUuid: string): Promise<boolean> {
  return (query as Query & UndeclaredQueryControls).cancelAsyncMessage(messageUuid);
}
