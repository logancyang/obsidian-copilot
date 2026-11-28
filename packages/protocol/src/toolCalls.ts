export type AgentToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AgentToolStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export type AgentToolCallOutput =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

export interface AgentToolProgress {
  description?: string;
  toolName?: string;
  toolUses?: number;
  durationMs?: number;
  totalTokens?: number;
}

export type CopilotToolCall = { name: string } & (
  | { args: Record<string, unknown> }
  | { code: string }
);

export interface CopilotToolUse {
  wrapper?: string;
  calls: readonly CopilotToolCall[];
}

export interface ToolCallSnapshot {
  toolCallId: string;
  title: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  content?: ToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  vendorToolName?: string;
  mcpServer?: string;
  copilotTools?: CopilotToolUse;
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

export type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string };
