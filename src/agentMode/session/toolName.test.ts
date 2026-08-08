import { parseMcpToolName } from "@/agentMode/session/toolName";

describe("parseMcpToolName", () => {
  it("splits a qualified MCP name into server and tool", () => {
    expect(parseMcpToolName("mcp__context7__query-docs")).toEqual({
      server: "context7",
      tool: "query-docs",
    });
  });

  it("treats the first '__' after the prefix as the separator (single-underscore server)", () => {
    expect(parseMcpToolName("mcp__my_server__do_thing")).toEqual({
      server: "my_server",
      tool: "do_thing",
    });
  });

  it("keeps trailing '__' inside the tool segment", () => {
    expect(parseMcpToolName("mcp__srv__tool__name")).toEqual({
      server: "srv",
      tool: "tool__name",
    });
  });

  it("returns null for non-MCP names", () => {
    expect(parseMcpToolName("Read")).toBeNull();
    expect(parseMcpToolName("AskUserQuestion")).toBeNull();
    expect(parseMcpToolName("mcp__incomplete")).toBeNull();
    expect(parseMcpToolName("")).toBeNull();
  });
});
