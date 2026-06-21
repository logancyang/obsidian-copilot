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
 * Resolve a `PermissionPrompt` for a read-only fan-out sub-session: allow
 * read/search/fetch tools, hard-deny write/exec tools. Auto-decided without a
 * user card — fan-out sub-sessions have no visible tab to surface one on. This
 * is the per-backend enforcement layer the orchestrator relies on (it routes
 * through the same shared prompter every backend uses), on top of the universal
 * "answer only, no writes" prompt preamble.
 */
function decideReadOnly(req: PermissionPrompt): PermissionDecision {
  const deny = isWriteOrExecToolKind(req.toolCall.kind);
  const kinds = deny ? PERMISSION_REJECT_KINDS : PERMISSION_ALLOW_KINDS;
  // Both kind lists have two fixed entries, so `includes` preserves the allow-
  // /reject-once-first ordering while collapsing the nested scan to one `find`.
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
 * `isReadOnlySession`, when supplied, is consulted first: a request from a
 * read-only fan-out sub-session is decided by {@link decideReadOnly} (allow
 * reads, deny writes/exec) instead of being routed to a visible session, since
 * fan-out sub-sessions are ephemeral and have no tab to prompt on.
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
