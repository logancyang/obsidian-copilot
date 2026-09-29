import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { CommandResult, SendContext } from "@/agentMode/protocol/commands";
import type {
  AgentQuestionAnswers,
  BackendId,
  PlanDecisionAction,
  PromptContent,
  SessionId,
} from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import type { MessageContext } from "@/types/message";
import { Notice } from "obsidian";
import { useMemo } from "react";

export interface SessionCommands {
  send: (
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ) => Promise<{ turn: Promise<void> }>;
  cancel: () => Promise<void>;
  resolvePermission: (toolCallId: string, optionId: string) => Promise<CommandResult>;
  answerQuestion: (requestId: string, answers: AgentQuestionAnswers) => Promise<CommandResult>;
  resolvePlan: (
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ) => Promise<CommandResult>;
}

function toSendContext(context: MessageContext | undefined): SendContext | undefined {
  if (!context) return undefined;
  const { notes, ...rest } = context;
  return { ...rest, notePaths: notes.map((note) => note.path) };
}

/**
 * The notice for notes a message named that the host could not resolve in its own vault. The agent
 * cannot read a note that exists only on this device, and saying so keeps its reply from being read
 * as one that saw the note.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/613
 * @param paths - The vault paths the host dropped, as this device sent them.
 */
export function describeDroppedNotes(paths: readonly string[]): string {
  const names = paths.map((path) => path.split("/").pop()?.replace(/\.md$/, "") ?? path);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  const [subject, object] =
    names.length === 1
      ? ["A note you mentioned is", "it"]
      : [`${names.length} notes you mentioned are`, "them"];
  return `${subject} not in the desktop's vault, so the agent could not read ${object}: ${shown}${more}.`;
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

// The composer and the pane act on a session only through client commands. `send` turns a composed
// message into a `send` command with notes as vault paths and reports when the turn it started has
// ended. A `stale` result on a prompt answer means another device already answered it, which is
// the expected outcome of a race and needs no report; any other failure leaves the prompt pending,
// so the user is told to answer again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/612
function reportFailure(name: string, result: CommandResult): CommandResult {
  if (!result.ok && result.code !== "stale") {
    logWarn(`[AgentMode] ${name} command failed (${result.code}): ${result.message}`);
    new Notice(`Could not send your answer to the agent (${result.message}). Try again.`);
  }
  return result;
}

export function useSessionCommands(client: SessionClient, sessionId: SessionId): SessionCommands {
  return useMemo(
    () => ({
      async send(text, context, promptContent, mentionedAgents) {
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
        if (result.value.droppedNotePaths.length > 0) {
          new Notice(describeDroppedNotes(result.value.droppedNotePaths));
        }
        return { turn: turnEnded(client, sessionId) };
      },
      async cancel() {
        const result = await client.command({ name: "cancel", sessionId });
        if (!result.ok) throw new Error(result.message);
      },
      resolvePermission: async (toolCallId, optionId) =>
        reportFailure(
          "resolvePermission",
          await client.command({ name: "resolvePermission", sessionId, toolCallId, optionId })
        ),
      answerQuestion: async (requestId, answers) =>
        reportFailure(
          "answerQuestion",
          await client.command({ name: "answerQuestion", sessionId, requestId, answers })
        ),
      resolvePlan: async (proposalId, decision, feedbackText) =>
        reportFailure(
          "resolvePlan",
          await client.command({
            name: "resolvePlan",
            sessionId,
            proposalId,
            decision,
            feedbackText,
          })
        ),
    }),
    [client, sessionId]
  );
}
