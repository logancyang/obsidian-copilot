import type { LucideIcon } from "lucide-react";
import { Bot } from "lucide-react";
import { pickToolIcon } from "@/agentMode/ui/toolIcons";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { getVaultBase, toVaultRelative } from "@/agentMode/ui/vaultPath";

/**
 * Tool-aware presentation for one or more tool_call parts. Each tool
 * family contributes one entry; lookup order is `vendorToolName` →
 * `toolKind` → generic fallback. The summary functions are pure — no
 * React, no I/O — so they can be unit-tested cheaply.
 */
export interface ToolSummary {
  /** Lucide icon component shown in the collapsed line. */
  icon: LucideIcon;
  /** Single-line "Edited practice-log.md" style verb · target. */
  collapsedLine: (part: ToolCallPart) => string;
  /** Optional muted line below the title — counts/sizes/duration. Null hides. */
  outcome: (part: ToolCallPart) => string | null;
  /** Tool-aware aggregate stat for N consecutive same-key parts. */
  aggregate: (parts: ToolCallPart[]) => { line: string; outcome: string };
}

/**
 * Result of recognizing one tool_call part. Consumers can also call
 * `lookupToolSummaryForAggregate` when they have a homogenous group.
 */
export function lookupToolSummary(part: ToolCallPart): ToolSummary {
  // Heuristic: opencode's `task` tool is a sub-agent invocation but emits
  // no `_meta` and maps to `kind: "other"`. Recognize it by data shape so
  // the registry stays backend-id-free.
  if (isOpencodeTaskTool(part)) return TASK_SUMMARY;
  if (part.vendorToolName) {
    const v = VENDOR_SUMMARIES[part.vendorToolName];
    if (v) return v;
  }
  if (part.toolKind) {
    const k = KIND_SUMMARIES[part.toolKind];
    if (k) return k;
  }
  return GENERIC_SUMMARY;
}

function isOpencodeTaskTool(part: ToolCallPart): boolean {
  if (part.vendorToolName) return false;
  if (part.toolKind && part.toolKind !== "other") return false;
  const input = part.input as { subagent_type?: unknown } | null | undefined;
  return typeof input?.subagent_type === "string";
}

function statusCounts(parts: ToolCallPart[]): {
  done: number;
  failed: number;
  pending: number;
} {
  let done = 0;
  let failed = 0;
  let pending = 0;
  for (const p of parts) {
    if (p.status === "completed") done++;
    else if (p.status === "failed") failed++;
    else pending++;
  }
  return { done, failed, pending };
}

function statusSuffix(parts: ToolCallPart[]): string {
  const { done, failed, pending } = statusCounts(parts);
  // Mixed-status surfaces explicitly; clean runs say nothing.
  if (failed === 0 && pending === 0) return "";
  const bits: string[] = [];
  if (done > 0) bits.push(`${done} done`);
  if (failed > 0) bits.push(`${failed} failed`);
  if (pending > 0) bits.push(`${pending} pending`);
  return ` · ${bits.join(" · ")}`;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

function targetFromTitle(part: ToolCallPart): string {
  return part.title || "(no title)";
}

function targetFromPath(part: ToolCallPart): string | null {
  const base = getVaultBase();
  const loc = part.locations?.[0]?.path;
  if (typeof loc === "string" && loc.length > 0) return toVaultRelative(loc, base);
  const input = part.input as { file_path?: unknown; filePath?: unknown } | null | undefined;
  if (typeof input?.file_path === "string") return toVaultRelative(input.file_path, base);
  if (typeof input?.filePath === "string") return toVaultRelative(input.filePath, base);
  return null;
}

function queryFromInput(part: ToolCallPart): string | null {
  const input = part.input as
    | { query?: unknown; pattern?: unknown; q?: unknown }
    | null
    | undefined;
  for (const k of ["query", "pattern", "q"] as const) {
    const v = input?.[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function diffStats(part: ToolCallPart): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of part.output ?? []) {
    if (o.type !== "diff") continue;
    if (o.oldText !== null) {
      removed += o.oldText.split("\n").length;
    }
    added += o.newText.split("\n").length;
  }
  return { added, removed };
}

function approxTokens(part: ToolCallPart): number {
  let chars = 0;
  for (const o of part.output ?? []) {
    if (o.type === "text") chars += o.text.length;
  }
  return Math.round(chars / 4);
}

// ---- Vendor (Claude Code) entries ----

const READ_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Read" }),
  collapsedLine: (p) => `Read ${targetFromPath(p) ?? targetFromTitle(p)}`,
  outcome: (p) => {
    const t = approxTokens(p);
    return t > 0 ? `~${formatTokens(t)} tokens` : null;
  },
  aggregate: (parts) => {
    const tokens = parts.reduce((sum, p) => sum + approxTokens(p), 0);
    return {
      line: `Read ${pluralize(parts.length, "note")}${statusSuffix(parts)}`,
      outcome: tokens > 0 ? `~${formatTokens(tokens)} tokens` : "",
    };
  },
};

const EDIT_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Edit" }),
  collapsedLine: (p) => `Edited ${targetFromPath(p) ?? targetFromTitle(p)}`,
  outcome: (p) => {
    const { added, removed } = diffStats(p);
    if (added === 0 && removed === 0) return null;
    return `+${added} / −${removed} lines`;
  },
  aggregate: (parts) => {
    let added = 0;
    let removed = 0;
    for (const p of parts) {
      const s = diffStats(p);
      added += s.added;
      removed += s.removed;
    }
    return {
      line: `Edited ${pluralize(parts.length, "note")}${statusSuffix(parts)}`,
      outcome: added + removed > 0 ? `+${added} / −${removed} lines` : "",
    };
  },
};

const BASH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Bash" }),
  collapsedLine: (p) => {
    const input = p.input as { command?: unknown; description?: unknown } | null | undefined;
    if (typeof input?.description === "string" && input.description.length > 0) {
      return `Ran ${input.description}`;
    }
    if (typeof input?.command === "string") {
      const cmd = input.command.length > 60 ? input.command.slice(0, 60) + "…" : input.command;
      return `Ran \`${cmd}\``;
    }
    return `Ran ${targetFromTitle(p)}`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Ran ${pluralize(parts.length, "command")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const SEARCH_VAULT_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Grep" }),
  collapsedLine: (p) => {
    const q = queryFromInput(p);
    return q ? `Searched vault · "${q}"` : `Searched vault · ${targetFromTitle(p)}`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Searched vault · ${pluralize(parts.length, "query", "queries")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const WEB_SEARCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "WebSearch" }),
  collapsedLine: (p) => {
    const q = queryFromInput(p);
    return q ? `Searched web · "${q}"` : `Searched web · ${targetFromTitle(p)}`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Searched web · ${pluralize(parts.length, "query", "queries")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const WEB_FETCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "WebFetch" }),
  collapsedLine: (p) => {
    const input = p.input as { url?: unknown } | null | undefined;
    if (typeof input?.url === "string") return `Fetched ${input.url}`;
    return `Fetched ${targetFromTitle(p)}`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Fetched ${pluralize(parts.length, "URL")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const TASK_SUMMARY: ToolSummary = {
  icon: Bot,
  collapsedLine: (p) => {
    const input = p.input as
      | { description?: unknown; subagent_type?: unknown; prompt?: unknown }
      | null
      | undefined;
    const agent = typeof input?.subagent_type === "string" ? input.subagent_type : null;
    const desc =
      typeof input?.description === "string" && input.description.length > 0
        ? input.description
        : typeof input?.prompt === "string"
          ? input.prompt.slice(0, 60)
          : targetFromTitle(p);
    return agent ? `${agent} · "${desc}"` : `Sub-agent · "${desc}"`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Ran ${pluralize(parts.length, "sub-agent")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const TODO_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "TodoWrite" }),
  collapsedLine: () => "Updated task list",
  outcome: (p) => {
    const input = p.input as { todos?: unknown[] } | null | undefined;
    const n = Array.isArray(input?.todos) ? input!.todos!.length : 0;
    return n > 0 ? pluralize(n, "task") : null;
  },
  aggregate: (parts) => ({
    line: `Updated task list · ${pluralize(parts.length, "time")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const EXIT_PLAN_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "ExitPlanMode" }),
  collapsedLine: () => "Proposed plan",
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Proposed ${pluralize(parts.length, "plan")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const VENDOR_SUMMARIES: Record<string, ToolSummary> = {
  Read: READ_SUMMARY,
  Edit: EDIT_SUMMARY,
  MultiEdit: EDIT_SUMMARY,
  Write: EDIT_SUMMARY,
  Bash: BASH_SUMMARY,
  Glob: SEARCH_VAULT_SUMMARY,
  Grep: SEARCH_VAULT_SUMMARY,
  WebSearch: WEB_SEARCH_SUMMARY,
  WebFetch: WEB_FETCH_SUMMARY,
  Task: TASK_SUMMARY,
  // Claude Code reports the parent sub-agent invocation under
  // `_meta.claudeCode.toolName: "Agent"` — register the same summary
  // so it doesn't fall through to KIND_THINK_SUMMARY ("Thought" + Brain).
  Agent: TASK_SUMMARY,
  TodoWrite: TODO_SUMMARY,
  ExitPlanMode: EXIT_PLAN_SUMMARY,
};

// ---- ACP-kind fallbacks (work for opencode, codex, future backends) ----

const KIND_SEARCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "search" }),
  collapsedLine: (p) => {
    const q = queryFromInput(p);
    return q ? `Searched · "${q}"` : `Searched · ${targetFromTitle(p)}`;
  },
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Searched · ${pluralize(parts.length, "query", "queries")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};
const KIND_EXECUTE_SUMMARY: ToolSummary = {
  ...BASH_SUMMARY,
  icon: pickToolIcon({ toolKind: "execute" }),
};
const KIND_FETCH_SUMMARY: ToolSummary = {
  ...WEB_FETCH_SUMMARY,
  icon: pickToolIcon({ toolKind: "fetch" }),
};
const KIND_DELETE_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "delete" }),
  collapsedLine: (p) => `Deleted ${targetFromPath(p) ?? targetFromTitle(p)}`,
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Deleted ${pluralize(parts.length, "item")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};
const KIND_MOVE_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "move" }),
  collapsedLine: (p) => `Moved ${targetFromPath(p) ?? targetFromTitle(p)}`,
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Moved ${pluralize(parts.length, "item")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};
const KIND_SWITCH_MODE_SUMMARY: ToolSummary = {
  ...EXIT_PLAN_SUMMARY,
  icon: pickToolIcon({ toolKind: "switch_mode" }),
};
const KIND_THINK_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "think" }),
  collapsedLine: () => "Thought",
  outcome: () => null,
  aggregate: (parts) => ({
    line: `Thought · ${pluralize(parts.length, "step")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

const KIND_SUMMARIES: Record<string, ToolSummary> = {
  read: READ_SUMMARY,
  edit: EDIT_SUMMARY,
  search: KIND_SEARCH_SUMMARY,
  execute: KIND_EXECUTE_SUMMARY,
  fetch: KIND_FETCH_SUMMARY,
  delete: KIND_DELETE_SUMMARY,
  move: KIND_MOVE_SUMMARY,
  switch_mode: KIND_SWITCH_MODE_SUMMARY,
  think: KIND_THINK_SUMMARY,
};

const GENERIC_SUMMARY: ToolSummary = {
  icon: pickToolIcon({}),
  collapsedLine: (p) => targetFromTitle(p),
  outcome: () => null,
  aggregate: (parts) => ({
    line: `${pluralize(parts.length, "tool call")}${statusSuffix(parts)}`,
    outcome: "",
  }),
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Extract the prompt the parent agent sent to a sub-agent. Sourced from
 * `part.input.prompt` (Claude Code's Agent tool and opencode's task tool
 * both surface the prompt this way). Returns null when absent or empty.
 */
export function extractSubAgentInputPrompt(part: ToolCallPart): string | null {
  const input = part.input as { prompt?: unknown } | null | undefined;
  const prompt = input?.prompt;
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract the sub-agent return value from a Task / sub-agent tool call's
 * output. Strips `<task_result>…</task_result>` markers (opencode wraps
 * the result this way) and returns the inner text. Returns null when
 * the part has no text output, or when the output is identical to the
 * input prompt — Claude Code initially echoes the prompt as the Agent
 * tool's `content` before the sub-agent has produced anything, and that
 * echoed prompt would otherwise render in the "response" slot.
 */
export function extractSubAgentReturnText(part: ToolCallPart): string | null {
  if (!part.output) return null;
  const textChunks = part.output.filter((o) => o.type === "text") as { text: string }[];
  if (textChunks.length === 0) return null;
  const joined = textChunks.map((c) => c.text).join("\n");
  const m = joined.match(/<task_result>([\s\S]*?)<\/task_result>/);
  const result = m ? m[1].trim() : joined.trim();
  if (!result) return null;
  const prompt = extractSubAgentInputPrompt(part);
  if (prompt && prompt === result) return null;
  return result;
}
