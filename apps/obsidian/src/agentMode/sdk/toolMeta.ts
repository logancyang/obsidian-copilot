import type { AgentToolKind } from "@/agentMode/session/types";

const TITLE_ARG_MAX_CHARS = 60;

export interface VendorMetaFields {
  vendorToolName: string;
  parentToolCallId?: string;
  isPlanProposal?: boolean;
}

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
    if (typeof input.command === "string") return `${toolName}: ${truncate(input.command)}`;
    if (typeof input.pattern === "string") return `${toolName} ${truncate(input.pattern)}`;
    if (typeof input.url === "string") return `${toolName} ${input.url}`;
  }
  return toolName;
}

function truncate(s: string): string {
  return s.length > TITLE_ARG_MAX_CHARS ? `${s.slice(0, TITLE_ARG_MAX_CHARS - 1)}…` : s;
}
