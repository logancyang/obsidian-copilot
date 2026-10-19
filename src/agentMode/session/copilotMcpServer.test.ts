import {
  createCopilotMcpServer,
  COPILOT_MCP_SERVER_NAME,
  SEND_FEEDBACK_TOOL,
  type CopilotMcpServer,
} from "./copilotMcpServer";
import type { AgentMcpServer } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logError: jest.fn() }));

interface HttpResult {
  status: number;
  body: unknown;
}

function post(
  server: AgentMcpServer,
  body: unknown,
  options: { method?: string; headers?: Record<string, string>; url?: string } = {}
): Promise<HttpResult> {
  const http = jest.requireActual<typeof import("node:http")>("node:http");
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      options.url ?? server.url,
      {
        method: options.method ?? "POST",
        headers: { ...server.headers, "Content-Type": "application/json", ...options.headers },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : null })
        );
      }
    );
    request.on("error", reject);
    request.end(options.method === "GET" ? undefined : payload);
  });
}

function rpc(id: number, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

const COMPLAINT = {
  title: "Replied in Swedish to an English request",
  what_happened: "The agent answered 'hej' instead of English.",
  user_said: "Why do you switch to a different language?",
  repro: "1. Type a garbled 'commit and push'. 2. Observe a Swedish reply.",
};

describe("copilotMcpServer", () => {
  describe("createCopilotMcpServer()", () => {
    let server: CopilotMcpServer;

    beforeEach(() => {
      server = createCopilotMcpServer(() => true);
    });

    afterEach(() => server.dispose());

    it("reports whether any hosted tool is switched on, following the switch as it changes", () => {
      let on = true;
      server.dispose();
      server = createCopilotMcpServer((toolName) => toolName === "send_feedback" && on);

      expect(server.hasEnabledTools()).toBe(true);
      on = false;
      expect(server.hasEnabledTools()).toBe(false);
    });

    it("hands each session a loopback MCP server named obsidian-copilot with its own bearer token", async () => {
      const first = await server.connect("session-a", jest.fn());
      const second = await server.connect("session-b", jest.fn());

      expect(first.name).toBe(COPILOT_MCP_SERVER_NAME);
      expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(second.url).toBe(first.url);
      expect(first.headers.Authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
      expect(second.headers.Authorization).not.toBe(first.headers.Authorization);
    });

    it("completes the MCP handshake by echoing a supported protocol version and advertising tools", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, rpc(1, "initialize", { protocolVersion: "2025-03-26" }));

      expect(result).toEqual({
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: COPILOT_MCP_SERVER_NAME, version: "1.0.0" },
          },
        },
      });
    });

    it("answers an unknown protocol version with the latest one it speaks", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, rpc(1, "initialize", { protocolVersion: "1999-01-01" }));

      expect(result.body).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    });

    it("lists only send_feedback, always loaded and read-only so agents see it without an approval prompt", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, rpc(2, "tools/list"));

      expect(result.body).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [SEND_FEEDBACK_TOOL] },
      });
      expect(SEND_FEEDBACK_TOOL).toMatchObject({
        annotations: { readOnlyHint: true },
        _meta: { "anthropic/alwaysLoad": true },
      });
    });

    it("lists no tools while send_feedback is switched off", async () => {
      server.dispose();
      server = createCopilotMcpServer(() => false);
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, rpc(2, "tools/list"));

      expect(result.body).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
    });

    it("forwards a send_feedback call to its own session and tells the agent the card was shown", async () => {
      const ownHandler = jest.fn().mockReturnValue("shown");
      const otherHandler = jest.fn();
      const channel = await server.connect("session-a", ownHandler);
      await server.connect("session-b", otherHandler);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(ownHandler).toHaveBeenCalledWith(
        {
          title: COMPLAINT.title,
          whatHappened: COMPLAINT.what_happened,
          userSaid: COMPLAINT.user_said,
          repro: COMPLAINT.repro,
        },
        null
      );
      expect(otherHandler).not.toHaveBeenCalled();
      expect(result.body).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [
            { type: "text", text: "Shown to the user. Continue; don't mention it unless asked." },
          ],
          isError: false,
        },
      });
    });

    it.each([
      ["already_offered", "Already offered this session. Don't call send_feedback again."],
      ["turned_off", "The user turned off feedback reports. Don't call send_feedback again."],
      [
        "unattributed",
        "Copilot couldn't tell which chat this came from, so nothing was shown. Don't call send_feedback again.",
      ],
    ] as const)("tells the agent to stop when the session answers %s", async (outcome, text) => {
      const channel = await server.connect("session-a", () => outcome);

      const result = await post(
        channel,
        rpc(4, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(result.body).toMatchObject({ result: { content: [{ text }], isError: false } });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/733 answers a call to a switched-off send_feedback with the turned-off result and raises no card", async () => {
      let on = true;
      server.dispose();
      server = createCopilotMcpServer(() => on);
      const handler = jest.fn().mockReturnValue("shown");
      const channel = await server.connect("session-a", handler);

      on = false;
      const result = await post(
        channel,
        rpc(4, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result.body).toMatchObject({
        result: {
          content: [
            { text: "The user turned off feedback reports. Don't call send_feedback again." },
          ],
          isError: false,
        },
      });
    });

    it("treats a missing user_said as an agent-noticed problem and trims every field", async () => {
      const handler = jest.fn().mockReturnValue("shown");
      const channel = await server.connect("session-a", handler);

      await post(
        channel,
        rpc(5, "tools/call", {
          name: "send_feedback",
          arguments: { title: "  Retracted answer  ", what_happened: "x", repro: "y" },
        })
      );

      expect(handler).toHaveBeenCalledWith(
        { title: "Retracted answer", whatHappened: "x", userSaid: "", repro: "y" },
        null
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 hands the handler the caller session an agent stamped on the call, and keeps it out of the draft", async () => {
      const handler = jest.fn().mockReturnValue("shown");
      const channel = await server.connect("opencode:/vault", handler);

      await post(
        channel,
        rpc(6, "tools/call", {
          name: "send_feedback",
          arguments: { ...COMPLAINT, caller_session_id: "ses_caller" },
        })
      );

      expect(handler).toHaveBeenCalledWith(
        {
          title: COMPLAINT.title,
          whatHappened: COMPLAINT.what_happened,
          userSaid: COMPLAINT.user_said,
          repro: COMPLAINT.repro,
        },
        "ses_caller"
      );
    });

    it("rejects a call missing a required field without raising a card", async () => {
      const handler = jest.fn();
      const channel = await server.connect("session-a", handler);

      const result = await post(
        channel,
        rpc(6, "tools/call", { name: "send_feedback", arguments: { title: "Only a title" } })
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result.body).toMatchObject({ result: { isError: true } });
    });

    it("reports an unknown tool or method as an error", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const tool = await post(channel, rpc(7, "tools/call", { name: "delete_vault" }));
      const method = await post(channel, rpc(8, "resources/list"));

      expect(tool.body).toMatchObject({ result: { isError: true } });
      expect(method.body).toMatchObject({ error: { code: -32601 } });
    });

    it("acknowledges notifications with 202 and no body", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, { jsonrpc: "2.0", method: "notifications/initialized" });

      expect(result).toEqual({ status: 202, body: null });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 refuses a request without a session's token, so nothing else on the machine can raise a card", async () => {
      const handler = jest.fn();
      const channel = await server.connect("session-a", handler);

      const result = await post(
        channel,
        rpc(9, "tools/call", { name: "send_feedback", arguments: COMPLAINT }),
        { headers: { Authorization: "Bearer forged" } }
      );

      expect(result.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 declines the optional SSE stream with 405", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const result = await post(channel, "", { method: "GET" });

      expect(result.status).toBe(405);
    });

    it("rejects a request body over 64 KiB of UTF-8 without raising a card, even when it has fewer characters", async () => {
      const handler = jest.fn().mockReturnValue("shown");
      const channel = await server.connect("session-a", handler);

      const result = await post(
        channel,
        rpc(5, "tools/call", {
          name: "send_feedback",
          arguments: { ...COMPLAINT, repro: "界".repeat(30_000) },
        })
      );

      expect(result).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
      expect(handler).not.toHaveBeenCalled();
    });

    it("answers other paths with 404, malformed JSON with a parse error and a non-object or batch with an invalid request", async () => {
      const channel = await server.connect("session-a", jest.fn());

      const missing = await post(channel, rpc(1, "ping"), {
        url: channel.url.replace("/mcp", "/other"),
      });
      const malformed = await post(channel, "{not json");
      const notAnObject = await post(channel, "null");
      const batch = await post(channel, JSON.stringify([rpc(1, "ping")]));

      expect(missing.status).toBe(404);
      expect(malformed).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
      expect(notAnObject).toMatchObject({ status: 400, body: { error: { code: -32600 } } });
      expect(batch).toMatchObject({ status: 400, body: { error: { code: -32600 } } });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 hands a reconnected key its existing token and sends its calls to the newest handler", async () => {
      const replaced = jest.fn();
      const current = jest.fn().mockReturnValue("shown");
      const first = await server.connect("opencode:/vault", replaced);

      const again = await server.connect("opencode:/vault", current);
      await post(first, rpc(1, "tools/call", { name: "send_feedback", arguments: COMPLAINT }));

      expect(again).toEqual(first);
      expect(current).toHaveBeenCalledTimes(1);
      expect(replaced).not.toHaveBeenCalled();
    });

    it("revokes a session's token on disconnect and leaves other sessions working", async () => {
      const kept = await server.connect("session-a", jest.fn());
      const revoked = await server.connect("session-b", jest.fn());

      server.disconnect("session-b");

      expect((await post(kept, rpc(1, "ping"))).status).toBe(200);
      expect((await post(revoked, rpc(1, "ping"))).status).toBe(401);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 fails a connect still waiting for the server to start when it is disposed", async () => {
      const pending = server.connect("session-a", jest.fn());

      server.dispose();

      await expect(pending).rejects.toThrow("The Copilot MCP server is closed.");
    });

    it("refuses new sessions after dispose", async () => {
      server.dispose();

      await expect(server.connect("session-a", jest.fn())).rejects.toThrow(
        "The Copilot MCP server is closed."
      );
    });
  });
});
