import { openAcpPermissionModal } from "@/agentMode/ui/AcpPermissionModal";
import type {
  AgentSessionManager,
  PermissionPrompter,
} from "@/agentMode/session/AgentSessionManager";
import type { App } from "obsidian";

/**
 * Detect a plan-finalization permission request. Routes to the originating
 * session's plan-card UX so the user sees the plan body and approve/reject
 * controls in chat instead of a generic permission modal.
 *
 * `session/request_permission` payloads do not carry vendor `_meta`, so this
 * detection is intentionally backend-agnostic — it relies on the standard
 * ACP `kind: "switch_mode"` plus the load-bearing content gate
 * `rawInput.plan: string`. A future non-plan mode-switch permission wouldn't
 * carry a `plan` markdown body, so the check stays unambiguous.
 */
export function isExitPlanModePermission(tc: {
  kind?: string | null;
  rawInput?: unknown;
}): boolean {
  if (tc.kind !== "switch_mode") return false;
  const plan = (tc.rawInput as { plan?: unknown } | null | undefined)?.plan;
  return typeof plan === "string";
}

/**
 * Default `PermissionPrompter` implementation: intercepts plan-mode exit
 * permission requests and routes them to the originating session's
 * plan-proposal handler; falls back to the modal for every other tool. Takes
 * a manager *getter* because the prompter is wired at manager construction
 * time, before the manager reference exists.
 */
export function createDefaultPermissionPrompter(
  app: App,
  getManager: () => AgentSessionManager | null
): PermissionPrompter {
  return (req) => {
    if (isExitPlanModePermission(req.toolCall)) {
      const session = getManager()?.getSessionByAcpId(req.sessionId);
      if (session) return session.handlePlanProposalPermission(req);
    }
    return openAcpPermissionModal(app, req);
  };
}
