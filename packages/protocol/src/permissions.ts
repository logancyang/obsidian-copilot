import type { SessionId } from "@copilot/protocol/session";
import type { ToolCallSnapshot } from "@copilot/protocol/toolCalls";

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  name: string;
  description?: string;
  kind: PermissionOptionKind;
}

export interface AskedAgentRequester {
  slug: string;
  name: string;
  faceSrc: string;
}

export type PermissionRequester = "main" | { taskId: string } | { agent: AskedAgentRequester };

export interface PermissionPrompt {
  sessionId: SessionId;
  requester?: PermissionRequester;
  toolCall: ToolCallSnapshot;
  options: PermissionOption[];
}

export interface PermissionDecision {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  denyMessage?: string;
}
