import type {
  AgentToolCallOutput,
  AgentToolKind,
  AgentToolProgress,
  AgentToolStatus,
  CopilotToolUse,
} from "@copilot/protocol/toolCalls";

export interface FormattedDateTime {
  epoch: number;
  display: string;
  fileName: string;
}

export type PromptContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string };

export type StopReason = "end_turn" | "cancelled" | "refusal" | "max_tokens" | "max_turn_requests";

export type AgentCancelCause = "permission_declined" | "unspecified";

export interface AgentPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type CompactionStatus = "in_progress" | "completed" | "failed" | "cancelled" | "skipped";

export type CompactionTrigger = "manual" | "auto";

export interface CompactionSnapshot {
  id: string;
  status: CompactionStatus;
  trigger: CompactionTrigger;
  error?: string;
  preTokens?: number;
  postTokens?: number;
}

export type AgentMessagePart =
  | {
      kind: "tool_call";
      id: string;
      title: string;
      toolKind?: AgentToolKind;
      status: AgentToolStatus;
      userResponse?: string;
      input?: unknown;
      output?: AgentToolCallOutput[];
      locations?: { path: string; line?: number }[];
      vendorToolName?: string;
      mcpServer?: string;
      copilotTools?: CopilotToolUse;
      parentToolCallId?: string;
      progress?: AgentToolProgress;
    }
  | {
      kind: "thought";
      text: string;
      startedAtMs?: number;
      durationMs?: number;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "plan";
      entries: AgentPlanEntry[];
    }
  | ({ kind: "compaction"; startedAtMs: number } & CompactionSnapshot);

export interface TurnFileChange {
  path: string;
  status: "modified" | "created" | "deleted";
  before: string | null;
  after: string | null;
  additions: number;
  deletions: number;
}
