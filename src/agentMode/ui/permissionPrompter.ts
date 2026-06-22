import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  AskUserQuestionPrompter,
  PermissionPrompter,
} from "@/agentMode/session/AgentSessionManager";
import { isWriteOrExecToolKind } from "@/agentMode/session/fanout/fanoutTypes";
import {
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  type PermissionDecision,
  type PermissionPrompt,
  type SessionId,
} from "@/agentMode/session/types";

/**
 * Decide a `PermissionPrompt` for a read-only fan-out sub-session: allow
 * read/search/fetch, hard-deny write/exec. Auto-decided — these ephemeral
 * sub-sessions have no visible tab to surface a card on. The per-backend
 * enforcement layer behind the orchestrator's read-only guarantee.
 */
function decideReadOnly(req: PermissionPrompt): PermissionDecision {
  // `other` is an unknown/MCP tool we can't verify is read-only, so fail safe
  // and deny it here too (mirrors the Claude SDK bridge's unknown-MCP denial);
  // read/search/fetch/think/switch_mode still pass.
  const kind = req.toolCall.kind;
  const deny = isWriteOrExecToolKind(kind) || kind === "other";
  const kinds = deny ? PERMISSION_REJECT_KINDS : PERMISSION_ALLOW_KINDS;
  const opt = req.options.find((o) => kinds.includes(o.kind));
  if (!opt) return { outcome: { outcome: "cancelled" } };
  const decision: PermissionDecision = { outcome: { outcome: "selected", optionId: opt.optionId } };
  return deny
    ? { ...decision, denyMessage: "Read-only QA turn: write and exec tools are disabled." }
    : decision;
}

/**
 * Permission prompts route into the owning session so the user sees an inline
 * card in the chat instead of a modal. Plan proposals flow through
 * `handlePlanProposalPermission` (which also publishes the plan body); every
 * other tool call flows through `handleToolPermission`. Returns `cancelled`
 * when no session owns the request — without that the SDK turn would hang.
 *
 * `isReadOnlySession`, when supplied, is consulted first: a fan-out sub-session
 * request is decided by {@link decideReadOnly} rather than routed to a tab.
 */
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
    if (req.toolCall.isPlanProposal) {
      return session.handlePlanProposalPermission(req);
    }
    return session.handleToolPermission(req);
  };
}

/**
 * AskUserQuestion requests route into the owning session so the user answers
 * via an inline card in the chat instead of a modal — the sibling of
 * `createDefaultPermissionPrompter`. Returns `{}` (the cancellation signal)
 * when no session owns the request, so the SDK turn unblocks with the standard
 * cancellation deny instead of hanging on a dangling promise.
 */
export function createDefaultAskUserQuestionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): AskUserQuestionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({});
    return session.handleAskUserQuestion(req);
  };
}
