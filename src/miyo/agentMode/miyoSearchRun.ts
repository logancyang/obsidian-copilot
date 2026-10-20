import { COPILOT_MCP_SERVER_NAME } from "@/agentMode/session/copilotMcpServer";
import type { AgentMessagePart, AgentToolStatus } from "@/agentMode/session/types";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { MIYO_SEARCH_TOOL_NAME } from "@/miyo/miyoSearchTool";

export const EMPTY_MIYO_PATHS: readonly string[] = Object.freeze([]);

export interface MiyoSearchRun {
  status: AgentToolStatus;
  query: string | null;
  noteCount: number | null;
  notePaths: readonly string[];
  error: string | null;
}

const OPENCODE_MIYO_CALL = new RegExp(
  `tools\\[["']${COPILOT_MCP_SERVER_NAME}["']\\]\\.${MIYO_SEARCH_TOOL_NAME}\\(`
);

function inputOf(part: ToolCallPart): Record<string, unknown> {
  const input = part.input;
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Claude names the call by server and tool, Codex nests the arguments under `server`/`tool`, and
// OpenCode runs it as JavaScript inside its `execute` tool.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
function miyoSearchQuery(part: ToolCallPart): string | null | undefined {
  const input = inputOf(part);
  if (part.mcpServer === COPILOT_MCP_SERVER_NAME && part.vendorToolName === MIYO_SEARCH_TOOL_NAME) {
    return stringOrNull(input.query);
  }
  if (input.server === COPILOT_MCP_SERVER_NAME && input.tool === MIYO_SEARCH_TOOL_NAME) {
    const args = input.arguments;
    return stringOrNull(
      args && typeof args === "object" ? (args as { query?: unknown }).query : null
    );
  }
  const code = typeof input.code === "string" ? input.code : "";
  const call = OPENCODE_MIYO_CALL.exec(code);
  if (!call) return undefined;
  const literal = /\bquery["']?:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/.exec(
    code.slice(call.index)
  );
  if (!literal) return null;
  // Generated JavaScript often single-quotes the query, which JSON cannot parse until its quotes are swapped.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/735
  const body = literal[1] ?? literal[2].replace(/\\'/g, "'").replace(/\\?"/g, '\\"');
  try {
    return stringOrNull(JSON.parse(`"${body}"`));
  } catch {
    return null;
  }
}

// The tool's failure text opens with an instruction to the agent; the card shows only the reason.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
const MIYO_FAILURE_REASON = /Details: ([\s\S]*)$/;

// Only notes without a folder are in the active vault, so only their paths can match a link in the answer.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/735
function miyoNotes(text: string): { count: number; vaultPaths: string[] } | null {
  try {
    const results = (JSON.parse(text) as { results?: unknown }).results;
    if (!Array.isArray(results)) return null;
    const notes = results.filter(
      (r: { path?: unknown } | null): r is { folder?: string; path: string } =>
        typeof r?.path === "string"
    );
    return {
      count: new Set(notes.map((r) => JSON.stringify([r.folder, r.path]))).size,
      vaultPaths: [...new Set(notes.filter((r) => r.folder === undefined).map((r) => r.path))],
    };
  } catch {
    return null;
  }
}

export function miyoSearchRun(part: ToolCallPart): MiyoSearchRun | null {
  const query = miyoSearchQuery(part);
  if (query === undefined) return null;
  const text = (part.output ?? []).flatMap((o) => (o.type === "text" ? [o.text] : [])).join("");
  const notes = miyoNotes(text);
  return {
    status: part.status,
    query,
    noteCount: notes?.count ?? null,
    notePaths: notes?.vaultPaths ?? EMPTY_MIYO_PATHS,
    error:
      part.status === "failed" ? stringOrNull(MIYO_FAILURE_REASON.exec(text)?.[1] ?? text) : null,
  };
}

export function miyoResultPaths(parts: readonly AgentMessagePart[]): readonly string[] {
  const paths = parts.flatMap((part) =>
    part.kind === "tool_call" ? (miyoSearchRun(part)?.notePaths ?? []) : []
  );
  return paths.length > 0 ? paths : EMPTY_MIYO_PATHS;
}
