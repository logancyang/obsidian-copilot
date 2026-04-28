import { logWarn } from "@/logger";
import {
  resolveMcpServers,
  sanitizeStoredMcpServers,
  toAcpMcpServer,
  type StoredMcpServer,
} from "./mcpResolver";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function fakeProc(supports: { http?: boolean; sse?: boolean }) {
  return {
    hasCapability: (cap: string) => {
      if (cap === "mcp/http") return supports.http === true;
      if (cap === "mcp/sse") return supports.sse === true;
      return false;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("toAcpMcpServer", () => {
  it("maps a stdio entry without a `type` field (per ACP schema)", () => {
    const stored: StoredMcpServer = {
      id: "1",
      enabled: true,
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: [{ name: "FOO", value: "bar" }],
    };
    expect(toAcpMcpServer(stored)).toEqual({
      name: "fs",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: [{ name: "FOO", value: "bar" }],
    });
  });

  it("maps an http entry with the `type: http` discriminant", () => {
    const stored: StoredMcpServer = {
      id: "2",
      enabled: true,
      name: "remote",
      transport: "http",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    };
    expect(toAcpMcpServer(stored)).toEqual({
      type: "http",
      name: "remote",
      url: "https://example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer x" }],
    });
  });

  it("returns null for stdio missing a command", () => {
    expect(toAcpMcpServer({ id: "x", enabled: true, name: "n", transport: "stdio" })).toBeNull();
  });

  it("returns null for http missing a url", () => {
    expect(toAcpMcpServer({ id: "x", enabled: true, name: "n", transport: "http" })).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(
      toAcpMcpServer({ id: "x", enabled: true, name: "  ", transport: "stdio", command: "ls" })
    ).toBeNull();
  });
});

describe("sanitizeStoredMcpServers", () => {
  it("returns [] for non-array input (legacy unknown[] placeholder)", () => {
    expect(sanitizeStoredMcpServers(undefined)).toEqual([]);
    expect(sanitizeStoredMcpServers(null)).toEqual([]);
    expect(sanitizeStoredMcpServers({})).toEqual([]);
  });

  it("drops items with an unknown transport", () => {
    expect(sanitizeStoredMcpServers([{ name: "x", transport: "websocket" }])).toEqual([]);
  });

  it("backfills a fresh id when missing", () => {
    const out = sanitizeStoredMcpServers([{ name: "x", transport: "stdio", command: "ls" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/.+/);
    expect(out[0].enabled).toBe(true);
  });

  it("treats enabled=false as disabled, anything else as enabled", () => {
    const out = sanitizeStoredMcpServers([
      { id: "a", name: "x", transport: "stdio", enabled: false, command: "ls" },
      { id: "b", name: "y", transport: "stdio", command: "ls" },
    ]);
    expect(out.map((s) => [s.id, s.enabled])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("resolveMcpServers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns [] when the raw value is missing", () => {
    expect(resolveMcpServers(fakeProc({}), undefined)).toEqual([]);
    expect(resolveMcpServers(fakeProc({}), null)).toEqual([]);
  });

  it("skips disabled entries silently", () => {
    const out = resolveMcpServers(fakeProc({}), [
      { id: "a", name: "x", transport: "stdio", enabled: false, command: "ls" },
    ]);
    expect(out).toEqual([]);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("filters http servers when the agent does not advertise mcp/http", () => {
    const out = resolveMcpServers(fakeProc({ http: false }), [
      {
        id: "a",
        enabled: true,
        name: "remote",
        transport: "http",
        url: "https://example.com",
        headers: [],
      },
    ]);
    expect(out).toEqual([]);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it("passes http servers when the agent advertises mcp/http", () => {
    const out = resolveMcpServers(fakeProc({ http: true }), [
      {
        id: "a",
        enabled: true,
        name: "remote",
        transport: "http",
        url: "https://example.com",
        headers: [],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "http", url: "https://example.com" });
  });

  it("drops malformed entries (no command) and warns about the missing field", () => {
    const out = resolveMcpServers(fakeProc({}), [
      { id: "a", enabled: true, name: "x", transport: "stdio" },
    ]);
    expect(out).toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipping MCP server "x": missing required field "command"')
    );
  });

  it("warns about a missing field even when the agent lacks the matching capability", () => {
    // Validation must run before the capability gate so the user gets a
    // precise diagnostic instead of a misleading "transport not supported".
    const out = resolveMcpServers(fakeProc({ http: false }), [
      { id: "a", enabled: true, name: "broken", transport: "http" },
    ]);
    expect(out).toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipping MCP server "broken": missing required field "url"')
    );
  });
});
