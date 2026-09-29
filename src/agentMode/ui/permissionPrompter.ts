import { tryReadExitPlanModeCall, type AgentSession } from "@/agentMode/session/AgentSession";
import type {
  AskUserQuestionPrompter,
  PermissionPrompter,
} from "@/agentMode/session/AgentSessionManager";
import { isVaultWriteToolKind } from "@/agentMode/session/fanout/fanoutTypes";
import {
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  type PermissionDecision,
  type PermissionPrompt,
  type SessionId,
} from "@/agentMode/session/types";

function decideReadOnly(req: PermissionPrompt): PermissionDecision {
  const kind = req.toolCall.kind;
  const deny = isVaultWriteToolKind(kind) || kind === "other";
  const kinds = deny ? PERMISSION_REJECT_KINDS : PERMISSION_ALLOW_KINDS;
  const opt = req.options.find((o) => kinds.includes(o.kind));
  if (!opt) return { outcome: { outcome: "cancelled" } };
  const decision: PermissionDecision = { outcome: { outcome: "selected", optionId: opt.optionId } };
  return deny
    ? { ...decision, denyMessage: "Read-only QA turn: vault-write tools are disabled." }
    : decision;
}

export function createDefaultPermissionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null,
  isReadOnlySession?: (backendSessionId: SessionId) => boolean
): PermissionPrompter {
  return (req) => {
    if (isReadOnlySession?.(req.sessionId)) {
      return Promise.resolve(decideReadOnly(req));
    }
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
