import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { SendContext } from "@/agentMode/protocol/commands";
import type { BackendId, PromptContent, SessionId } from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import { useMemo } from "react";

// The composer's two ways to act on its session. Until the composer reads the replica for
// everything else (https://github.com/Brevilabs/obsidian-copilot-private/issues/612), this is the
// only seam between it and the client: it turns a composed message into a `send` command and
// reports when the turn it started has ended.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface ComposerCommands {
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): Promise<{ turn: Promise<void> }>;
  cancel(): Promise<void>;
}

function toSendContext(context: MessageContext | undefined): SendContext | undefined {
  if (!context) return undefined;
  const { notes, ...rest } = context;
  return { ...rest, notePaths: notes.map((note) => note.path) };
}

function turnEnded(client: SessionClient, sessionId: SessionId): Promise<void> {
  return new Promise((resolve) => {
    const settled = (): boolean => {
      const status = client.getHost()?.tabs.find((tab) => tab.id === sessionId)?.status;
      return status !== "running" && status !== "awaiting_permission";
    };
    if (settled()) return resolve();
    const unsubscribe = client.subscribe(() => {
      if (!settled()) return;
      unsubscribe();
      resolve();
    });
  });
}

export function useComposerCommands(client: SessionClient, sessionId: SessionId): ComposerCommands {
  return useMemo(
    () => ({
      async sendMessage(text, context, promptContent, mentionedAgents) {
        const images = promptContent?.flatMap((block) =>
          block.type === "image" ? [{ mimeType: block.mimeType, data: block.data }] : []
        );
        const result = await client.command({
          name: "send",
          sessionId,
          text,
          context: toSendContext(context),
          images: images && images.length > 0 ? images : undefined,
          mentionedAgents:
            mentionedAgents && mentionedAgents.length > 0 ? [...mentionedAgents] : undefined,
        });
        if (!result.ok) throw new Error(result.message);
        return { turn: turnEnded(client, sessionId) };
      },
      async cancel() {
        const result = await client.command({ name: "cancel", sessionId });
        if (!result.ok) throw new Error(result.message);
      },
    }),
    [client, sessionId]
  );
}
