import type { AgentSession } from "@/agentMode/session/AgentSession";
import { tryReadExitPlanModeCall } from "@/agentMode/session/messageParts";
import type {
  AskUserQuestionPrompter,
  PermissionPrompter,
} from "@/agentMode/session/AgentSessionManager";
import type { SessionId } from "@/agentMode/session/types";

export function createDefaultPermissionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): PermissionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    // Codex's ACP plan review carries the plan in a switch-mode request, without
    // the SDK-only proposal marker. https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    if (
      req.toolCall.isPlanProposal ||
      tryReadExitPlanModeCall({
        kind: req.toolCall.kind,
        rawInput: req.toolCall.rawInput,
      })
    ) {
      return session.handlePlanProposalPermission(req);
    }
    return session.handleToolPermission(req);
  };
}

export function createDefaultAskUserQuestionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): AskUserQuestionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({});
    return session.handleAskUserQuestion(req);
  };
}
