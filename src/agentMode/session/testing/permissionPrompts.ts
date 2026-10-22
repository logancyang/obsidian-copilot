import type { PermissionOption, PermissionPrompt } from "@/agentMode/session/types";

export const ALLOW_OR_REJECT_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
];

export function writePermissionRequest(): PermissionPrompt {
  return {
    sessionId: "acp-1",
    toolCall: {
      toolCallId: "tc-write",
      kind: "edit",
      status: "pending",
      title: "Write",
      rawInput: { file_path: "note.md", content: "updated" },
    },
    options: ALLOW_OR_REJECT_OPTIONS,
  };
}

export function planPermissionRequest(
  toolCallId: string,
  rawInput: Record<string, unknown>
): PermissionPrompt {
  return {
    sessionId: "acp-1",
    toolCall: {
      toolCallId,
      kind: "switch_mode",
      status: "pending",
      title: "ExitPlanMode",
      rawInput,
      vendorToolName: "ExitPlanMode",
      isPlanProposal: true,
    },
    options: ALLOW_OR_REJECT_OPTIONS,
  };
}
