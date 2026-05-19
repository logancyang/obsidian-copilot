import { openPermissionModal } from "@/agentMode/ui/PermissionModal";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { PermissionPrompter } from "@/agentMode/session/AgentSessionManager";
import type { SessionId } from "@/agentMode/session/types";
import type { App } from "obsidian";

/**
 * Plan-finalization prompts route into the owning session's plan-card flow
 * (so the user sees the plan body in chat instead of a generic permission
 * modal); everything else opens the modal. Returns `cancelled` when no
 * session owns the plan request, otherwise the SDK turn would hang.
 */
export function createDefaultPermissionPrompter(
  app: App,
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): PermissionPrompter {
  return (req) => {
    if (req.toolCall.isPlanProposal) {
      const session = resolveSession(req.sessionId);
      if (!session) return Promise.resolve({ outcome: { outcome: "cancelled" } });
      return session.handlePlanProposalPermission(req);
    }
    return openPermissionModal(app, req);
  };
}
