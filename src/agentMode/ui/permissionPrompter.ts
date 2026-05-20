import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { PermissionPrompter } from "@/agentMode/session/AgentSessionManager";
import type { SessionId } from "@/agentMode/session/types";

/**
 * Permission prompts route into the owning session so the user sees an inline
 * card in the chat instead of a modal. Plan proposals flow through
 * `handlePlanProposalPermission` (which also publishes the plan body); every
 * other tool call flows through `handleToolPermission`. Returns `cancelled`
 * when no session owns the request — without that the SDK turn would hang.
 */
export function createDefaultPermissionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): PermissionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    if (req.toolCall.isPlanProposal) {
      return session.handlePlanProposalPermission(req);
    }
    return session.handleToolPermission(req);
  };
}
