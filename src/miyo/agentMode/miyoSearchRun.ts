import type { AgentMessagePart, AgentToolStatus } from "@/agentMode/session/types";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { codeStringField, copilotToolCall } from "@/agentMode/ui/copilotToolCall";
import { MIYO_SEARCH_TOOL_NAME } from "@/miyo/miyoSearchTool";

export const EMPTY_MIYO_PATHS: readonly string[] = Object.freeze([]);

export interface MiyoNote {
  folder?: string;
  path: string;
}

export interface MiyoSearchRun {
  status: AgentToolStatus;
  query: string | null;
  notes: readonly MiyoNote[] | null;
  error: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function miyoSearchQuery(part: ToolCallPart): string | null | undefined {
  const call = copilotToolCall(part, MIYO_SEARCH_TOOL_NAME);
  if (!call) return undefined;
  return "args" in call ? stringOrNull(call.args.query) : codeStringField(call.code, "query");
}

// The tool's failure text opens with an instruction to the agent; the card shows only the reason.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
const MIYO_FAILURE_REASON = /Details: ([\s\S]*)$/;

function miyoNotes(text: string): MiyoNote[] | null {
  try {
    const results = (JSON.parse(text) as { results?: unknown }).results;
    if (!Array.isArray(results)) return null;
    const notes = new Map<string, MiyoNote>();
    for (const r of results as ({ folder?: unknown; path?: unknown } | null)[]) {
      if (typeof r?.path !== "string") continue;
      const folder = typeof r.folder === "string" ? r.folder : undefined;
      notes.set(JSON.stringify([folder, r.path]), { folder, path: r.path });
    }
    return [...notes.values()];
  } catch {
    return null;
  }
}

export function miyoSearchRun(part: ToolCallPart): MiyoSearchRun | null {
  const query = miyoSearchQuery(part);
  if (query === undefined) return null;
  const text = (part.output ?? []).flatMap((o) => (o.type === "text" ? [o.text] : [])).join("");
  return {
    status: part.status,
    query,
    notes: miyoNotes(text),
    error:
      part.status === "failed" ? stringOrNull(MIYO_FAILURE_REASON.exec(text)?.[1] ?? text) : null,
  };
}

// Only notes without a folder are in the active vault, so only their paths can match a link in the answer.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
export function miyoResultPaths(parts: readonly AgentMessagePart[]): readonly string[] {
  const paths = parts.flatMap((part) =>
    part.kind === "tool_call"
      ? (miyoSearchRun(part)?.notes ?? []).flatMap((note) =>
          note.folder === undefined ? [note.path] : []
        )
      : []
  );
  return paths.length > 0 ? [...new Set(paths)] : EMPTY_MIYO_PATHS;
}
