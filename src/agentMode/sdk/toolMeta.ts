/**
 * Shared tool-metadata helpers used by both the SDK message translator
 * and the permission bridge.
 */
import type { ToolKind } from "@agentclientprotocol/sdk";

export function deriveToolKind(toolName: string): ToolKind {
  if (toolName === "ExitPlanMode" || toolName === "EnterPlanMode") return "switch_mode";
  const lower = toolName.toLowerCase();
  if (
    lower === "read" ||
    lower === "glob" ||
    lower === "grep" ||
    lower === "list" ||
    lower === "vault_read" ||
    lower === "vault_glob" ||
    lower === "vault_grep" ||
    lower === "vault_list"
  ) {
    return "read";
  }
  if (lower === "write" || lower === "edit" || lower === "vault_write" || lower === "vault_edit") {
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
