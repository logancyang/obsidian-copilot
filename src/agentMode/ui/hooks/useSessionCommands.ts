import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { CommandResult } from "@/agentMode/protocol/commands";
import type {
  AgentQuestionAnswers,
  PlanDecisionAction,
  SessionId,
} from "@/agentMode/session/types";
import { logWarn } from "@/logger";
import { Notice } from "obsidian";
import { useMemo } from "react";

export interface SessionCommands {
  resolvePermission: (toolCallId: string, optionId: string) => Promise<CommandResult>;
  answerQuestion: (requestId: string, answers: AgentQuestionAnswers) => Promise<CommandResult>;
  resolvePlan: (
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ) => Promise<CommandResult>;
}

// The pane answers a session's pending prompts through client commands. A `stale` result means
// another device already answered the prompt, which is the expected outcome of a race and needs
// no report. Any other failure leaves the prompt pending, so the user is told to answer again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
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
