import { logInfo, logWarn } from "@/logger";
import type { McpServer } from "@agentclientprotocol/sdk";
import { v4 as uuidv4 } from "uuid";
import type { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";

/** Transport mechanisms supported by the ACP MCP integration. */
export type McpTransport = "stdio" | "http" | "sse";

/**
 * Plugin-side storage shape for an MCP server. Includes UI-only fields
 * (`id`, `enabled`) that are stripped before sending to the agent. Stdio
 * servers populate `command`/`args`/`env`; http/sse populate `url`/`headers`.
 */
export interface StoredMcpServer {
  id: string;
  enabled: boolean;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
}

/**
 * Convert a stored entry to the ACP wire shape, or `null` if the entry is
 * malformed (missing required fields for its transport, or empty name).
 */
export function toAcpMcpServer(s: StoredMcpServer): McpServer | null {
  const name = s.name.trim();
  if (!name) return null;
  if (s.transport === "stdio") {
    const command = s.command?.trim();
    if (!command) return null;
    return {
      name,
      command,
      args: s.args ?? [],
      env: s.env ?? [],
    };
  }
  const url = s.url?.trim();
  if (!url) return null;
  const headers = s.headers ?? [];
  if (s.transport === "http") {
    return { type: "http", name, url, headers };
  }
  return { type: "sse", name, url, headers };
}

/**
 * Pure sanitizer used by the settings layer: drop entries that are not
 * plain objects, coerce missing fields to safe defaults, and skip anything
 * we cannot recognize as a transport. Tolerates the legacy `unknown[]`
 * placeholder shape. Logs a warning when entries are dropped so legacy or
 * malformed data does not vanish silently.
 */
export function sanitizeStoredMcpServers(raw: unknown): StoredMcpServer[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredMcpServer[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped++;
      continue;
    }
    const r = item as Record<string, unknown>;
    const transport = r.transport;
    if (transport !== "stdio" && transport !== "http" && transport !== "sse") {
      dropped++;
      continue;
    }
    const id = typeof r.id === "string" && r.id ? r.id : uuidv4();
    const name = typeof r.name === "string" ? r.name : "";
    const enabled = r.enabled !== false;
    const entry: StoredMcpServer = { id, enabled, name, transport };
    if (transport === "stdio") {
      entry.command = typeof r.command === "string" ? r.command : "";
      entry.args = Array.isArray(r.args)
        ? r.args.filter((a): a is string => typeof a === "string")
        : [];
      entry.env = sanitizeKvList(r.env);
    } else {
      entry.url = typeof r.url === "string" ? r.url : "";
      entry.headers = sanitizeKvList(r.headers);
    }
    out.push(entry);
  }
  if (dropped > 0) {
    logWarn(
      `[AgentMode] dropped ${dropped} unrecognized MCP server entr${dropped === 1 ? "y" : "ies"} from settings (unknown transport or non-object)`
    );
  }
  return out;
}

function sanitizeKvList(raw: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.value !== "string") continue;
    out.push({ name: r.name, value: r.value });
  }
  return out;
}

/**
 * Resolve the MCP servers to send to the agent on `session/new` /
 * `session/resume` / `session/load`. Filters out disabled and malformed
 * entries, plus any http/sse servers when the agent did not advertise the
 * matching capability in `mcpCapabilities`.
 *
 * Accepts the raw `mcpServers` value (rather than the full settings object)
 * to keep this module independent of `CopilotSettings` and avoid a
 * settings ⇆ agentMode-barrel type cycle.
 */
export function resolveMcpServers(proc: AcpBackendProcess, rawMcpServers: unknown): McpServer[] {
  const stored = sanitizeStoredMcpServers(rawMcpServers);
  const out: McpServer[] = [];
  for (const s of stored) {
    if (!s.enabled) continue;
    // Validate shape first so the user gets a precise "missing required field"
    // message even on backends that don't advertise http/sse — the entry is
    // bad regardless of capability.
    const wire = toAcpMcpServer(s);
    if (!wire) {
      const missing =
        s.transport === "stdio"
          ? !s.name.trim()
            ? "name"
            : "command"
          : !s.name.trim()
            ? "name"
            : "url";
      logWarn(
        `[AgentMode] skipping MCP server "${s.name || "(unnamed)"}": missing required field "${missing}"`
      );
      continue;
    }
    if (s.transport === "http" && !proc.hasCapability("mcp/http")) {
      logWarn(`[AgentMode] skipping MCP server "${s.name}": agent does not support http transport`);
      continue;
    }
    if (s.transport === "sse" && !proc.hasCapability("mcp/sse")) {
      logWarn(`[AgentMode] skipping MCP server "${s.name}": agent does not support sse transport`);
      continue;
    }
    out.push(wire);
  }
  const enabledCount = stored.filter((s) => s.enabled).length;
  if (enabledCount > 0) {
    const summary = out
      .map((s) => `${s.name}/${"type" in s && s.type ? s.type : "stdio"}`)
      .join(", ");
    logInfo(`[AgentMode] resolved ${out.length}/${enabledCount} MCP servers: [${summary}]`);
  }
  return out;
}
