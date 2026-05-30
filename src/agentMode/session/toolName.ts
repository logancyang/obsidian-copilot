/**
 * MCP tools are namespaced `mcp__<server>__<tool>` by the Claude Agent SDK (and
 * surfaced the same way by ACP backends that pass the qualified name through as
 * the tool-call title). Parsing splits the server from the bare tool name so the
 * UI can render a `server · tool` label and lookups see the bare name.
 *
 * The server group is non-greedy, so the first `__` after the prefix is treated
 * as the separator — correct for single-underscore server names. Returns null
 * for any non-MCP name; callers degrade gracefully (show the name as-is).
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}

/**
 * Resolve any tool name to its bare `tool` and (for an `mcp__<server>__<tool>`
 * name) the `mcpServer`. Non-MCP names pass through unchanged with no server.
 * Centralizes the parse-then-fall-back pattern the translators and permission
 * bridge run on every tool: `const { tool, mcpServer } = resolveToolName(name)`.
 */
export function resolveToolName(name: string): { tool: string; mcpServer?: string } {
  const mcp = parseMcpToolName(name);
  return mcp ? { tool: mcp.tool, mcpServer: mcp.server } : { tool: name };
}
