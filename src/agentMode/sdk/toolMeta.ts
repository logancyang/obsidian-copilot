import type { AgentToolKind } from "@/agentMode/session/types";

export interface VendorMetaFields {
  vendorToolName: string;
  parentToolCallId?: string;
  isPlanProposal?: boolean;
}

/**
 * Caller passes the normalized tool name (any `mcp__server__` prefix
 * already stripped) plus its `mcpServer` when the name came from an MCP tool.
 * `isPlanProposal` is omitted unless true so the flag doesn't leak onto
 * unrelated tool calls. `ExitPlanMode` is a *native* Claude tool; an MCP tool
 * sharing the bare name (`mcp__srv__ExitPlanMode`) must not be routed through
 * the plan-approval flow, so the flag is gated on `mcpServer` being absent.
 */
export function vendorMetaFields(
  normalizedName: string,
  parentToolCallId?: string,
  mcpServer?: string
): VendorMetaFields {
  const fields: VendorMetaFields = { vendorToolName: normalizedName };
  if (parentToolCallId) fields.parentToolCallId = parentToolCallId;
  if (!mcpServer && normalizedName === "ExitPlanMode") fields.isPlanProposal = true;
  return fields;
}

/**
 * `mcpServer` is passed when the name came from an MCP tool. `switch_mode` is
 * reserved for the native plan tools; an MCP tool sharing the bare name must
 * not map to it, since `switch_mode` feeds plan-card publishing.
 */
export function deriveToolKind(toolName: string, mcpServer?: string): AgentToolKind {
  if (!mcpServer && (toolName === "ExitPlanMode" || toolName === "EnterPlanMode")) {
    return "switch_mode";
  }
  const lower = toolName.toLowerCase();
  if (lower === "read" || lower === "glob" || lower === "grep" || lower === "ls") {
    return "read";
  }
  if (lower === "write" || lower === "edit" || lower === "multiedit" || lower === "notebookedit") {
    return "edit";
  }
  if (lower === "bash") return "execute";
  if (lower === "websearch" || lower === "webfetch") return "fetch";
  if (lower === "todowrite" || lower === "task" || lower === "agent") return "think";
  return "other";
}

/**
 * Build a one-line "what is the agent doing" title surfaced on the action
 * card. `titleOverride` short-circuits when the SDK already supplied one
 * (e.g. via `canUseTool` ctx).
 */
export function deriveToolTitle(
  toolName: string,
  rawInput: unknown,
  titleOverride?: string
): string {
  if (typeof titleOverride === "string" && titleOverride.length > 0) return titleOverride;
  const input = rawInput as Record<string, unknown> | null | undefined;
  if (input && typeof input === "object") {
    if (typeof input.path === "string") return `${toolName} ${input.path}`;
    if (typeof input.file_path === "string") return `${toolName} ${input.file_path}`;
    if (typeof input.command === "string") return `${toolName}: ${truncate(input.command, 60)}`;
    if (typeof input.pattern === "string") return `${toolName} ${truncate(input.pattern, 60)}`;
    if (typeof input.url === "string") return `${toolName} ${input.url}`;
  }
  return toolName;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
