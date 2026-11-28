export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}

export function resolveToolName(name: string): { tool: string; mcpServer?: string } {
  const mcp = parseMcpToolName(name);
  return mcp ? { tool: mcp.tool, mcpServer: mcp.server } : { tool: name };
}
