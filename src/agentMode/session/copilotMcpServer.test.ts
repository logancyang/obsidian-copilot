import {
  createCopilotMcpServer,
  COPILOT_MCP_SERVER_NAME,
  SEND_FEEDBACK_TOOL,
  type CopilotMcpServer,
  type HostedTool,
  type McpToolDefinition,
  type ToolListing,
  type ToolProvider,
} from "./copilotMcpServer";
import type { AgentMcpServer } from "@/agentMode/session/types";
import { FEEDBACK_OFFER, type FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { fakeChat, type FakeChat } from "@/agentMode/session/testing/fakeChat";

jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn() }));

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

const COMPLAINT_DRAFT = {
  title: COMPLAINT.title,
  whatHappened: COMPLAINT.what_happened,
  userSaid: COMPLAINT.user_said,
  repro: COMPLAINT.repro,
};

const NO_CHAT = () => null;

function offerIn(chat: FakeChat): FeedbackOffer | null {
  return chat.readChatState(FEEDBACK_OFFER);
}

const LOOKUP_DEFINITION = Object.freeze({ name: "lookup", inputSchema: { type: "object" } });

function lookupTool(call: HostedTool["call"] = jest.fn()): HostedTool {
  return {
    definition: LOOKUP_DEFINITION,
    turnedOffText: "lookup is off. Don't call it again.",
    call,
  };
}

const CONNECTORS_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/857";
const NOTION_SEARCH = Object.freeze({
  name: "notion_search",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
});
const NOTION_CREATE = Object.freeze({
  name: "notion_create",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: false },
});

function connectorProvider(overrides: Partial<ToolProvider> = {}) {
  let listed: readonly McpToolDefinition[] = [];
  const provider = {
    refresh: jest.fn(async () => {
      listed = [NOTION_SEARCH, NOTION_CREATE];
    }),
    tools: jest.fn((_listedBy?: ToolListing) => listed),
    forget: jest.fn(),
    dispose: jest.fn(async () => {}),
    call: jest.fn(
      (name: string): ReturnType<ToolProvider["call"]> =>
        name.startsWith("notion_")
          ? Promise.resolve({ content: [{ type: "text", text: `ran ${name}` }], isError: false })
          : null
    ),
    ...overrides,
  };
  return provider;
}

describe("copilotMcpServer", () => {
  describe("createCopilotMcpServer()", () => {
    let server: CopilotMcpServer;

    beforeEach(() => {
      server = createCopilotMcpServer((toolName) => toolName === "send_feedback", []);
    });

    afterEach(() => server.dispose());

    it("hands each session a loopback MCP server named obsidian-copilot with its own bearer token", async () => {
      const first = await server.connect("session-a", "claude", NO_CHAT);
      const second = await server.connect("session-b", "claude", NO_CHAT);

      expect(first.name).toBe(COPILOT_MCP_SERVER_NAME);
      expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(second.url).toBe(first.url);
      expect(first.headers.Authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
      expect(second.headers.Authorization).not.toBe(first.headers.Authorization);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/807 names only the tools marked read-only, so an agent can run them without asking and asks before the rest", async () => {
      server.dispose();
      server = createCopilotMcpServer(
        () => true,
        [
          lookupTool(),
          {
            ...lookupTool(),
            definition: { name: "peek", annotations: { readOnlyHint: true } },
          },
          {
            ...lookupTool(),
            definition: { name: "draw", annotations: { readOnlyHint: false } },
          },
        ]
      );

      const channel = await server.connect("session-a", "claude", NO_CHAT);

      expect(channel.readOnlyToolNames).toEqual(["send_feedback", "peek"]);
    });

    it(`${CONNECTORS_ISSUE} refreshes the connected services before handing a session its server, then lists their tools after its own and names their read-only ones`, async () => {
      server.dispose();
      server = createCopilotMcpServer(() => true, [], connectorProvider());

      const channel = await server.connect("session-a", "claude", NO_CHAT);
      const result = await post(channel, rpc(2, "tools/list"));

      expect(channel.readOnlyToolNames).toEqual(["send_feedback", "notion_search"]);
      expect(result.body).toMatchObject({
        result: { tools: [SEND_FEEDBACK_TOOL, NOTION_SEARCH, NOTION_CREATE] },
      });
    });

    it(`${CONNECTORS_ISSUE} tells the connected services which session and backend listed their tools, and forgets the session on disconnect, so a service logging in again reloads only chats that lack it`, async () => {
      server.dispose();
      const provider = connectorProvider();
      server = createCopilotMcpServer(() => true, [], provider);

      const channel = await server.connect("session-a", "codex", NO_CHAT);
      await post(channel, rpc(2, "tools/list"));
      server.disconnect("session-a");

      expect(provider.tools).toHaveBeenLastCalledWith({
        sessionKey: "session-a",
        backendId: "codex",
      });
      expect(provider.forget).toHaveBeenCalledWith("session-a");
    });

    it(`${CONNECTORS_ISSUE} closes the connected services' connections when it is disposed`, () => {
      server.dispose();
      const provider = connectorProvider();
      server = createCopilotMcpServer(() => true, [], provider);

      server.dispose();

      expect(provider.dispose).toHaveBeenCalledTimes(1);
    });

    it(`${CONNECTORS_ISSUE} still hands a session its server with Copilot's own tools when the connected services can't be refreshed`, async () => {
      server.dispose();
      const provider = connectorProvider({ refresh: jest.fn().mockRejectedValue(new Error("x")) });
      server = createCopilotMcpServer(() => true, [], provider);

      const channel = await server.connect("session-a", "claude", NO_CHAT);

      expect(channel.readOnlyToolNames).toEqual(["send_feedback"]);
    });

    it(`${CONNECTORS_ISSUE} forwards a call to a connected service's tool and returns its result as the service gave it`, async () => {
      server.dispose();
      const provider = connectorProvider();
      server = createCopilotMcpServer(() => true, [], provider);
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "notion_search", arguments: { query: "plans" } })
      );
      const unknown = await post(channel, rpc(4, "tools/call", { name: "linear_search" }));

      expect(provider.call).toHaveBeenCalledWith("notion_search", { query: "plans" });
      expect(result.body).toMatchObject({
        result: { content: [{ type: "text", text: "ran notion_search" }], isError: false },
      });
      expect(unknown.body).toMatchObject({
        result: { content: [{ type: "text", text: "Unknown tool: linear_search" }], isError: true },
      });
    });

    it("completes the MCP handshake by echoing a supported protocol version and advertising tools", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

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
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, rpc(1, "initialize", { protocolVersion: "1999-01-01" }));

      expect(result.body).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
    });

    it("lists only send_feedback, always loaded and read-only so agents see it without an approval prompt", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

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

    it("lists a hosted tool beside send_feedback when both are on", async () => {
      server.dispose();
      server = createCopilotMcpServer(() => true, [lookupTool()]);
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, rpc(2, "tools/list"));

      expect(result.body).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [SEND_FEEDBACK_TOOL, LOOKUP_DEFINITION] },
      });
    });

    it("lists only a hosted tool when send_feedback is off", async () => {
      server.dispose();
      server = createCopilotMcpServer((toolName) => toolName === "lookup", [lookupTool()]);
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, rpc(2, "tools/list"));

      expect(result.body).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [LOOKUP_DEFINITION] },
      });
    });

    it("hands a hosted tool call's arguments and the calling chat to the tool and returns its text, raising no feedback card", async () => {
      const call = jest.fn().mockResolvedValue({ text: '{"results":[]}', isError: false });
      server.dispose();
      server = createCopilotMcpServer(() => true, [lookupTool(call)]);
      const chat = fakeChat();
      const channel = await server.connect("session-a", "claude", () => chat);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "lookup", arguments: { query: "sourdough" } })
      );

      expect(call).toHaveBeenCalledWith({ query: "sourdough" }, chat);
      expect(offerIn(chat)).toBeNull();
      expect(result.body).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: '{"results":[]}' }], isError: false },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 hands a hosted tool the chat found by the caller session an agent stamped on the call, and keeps the stamp out of its arguments", async () => {
      const call = jest.fn().mockResolvedValue({ text: "ok", isError: false });
      server.dispose();
      server = createCopilotMcpServer(() => true, [lookupTool(call)]);
      const chat = fakeChat();
      const findChat = jest.fn(() => chat);
      const channel = await server.connect("opencode:/vault", "claude", findChat);

      await post(
        channel,
        rpc(3, "tools/call", {
          name: "lookup",
          arguments: { query: "sourdough", caller_session_id: "ses_caller" },
        })
      );

      expect(findChat).toHaveBeenCalledWith("ses_caller");
      expect(call).toHaveBeenCalledWith({ query: "sourdough" }, chat);
    });

    it("hands a hosted tool no chat when the call can't be traced to one", async () => {
      const call = jest.fn().mockResolvedValue({ text: "ok", isError: false });
      server.dispose();
      server = createCopilotMcpServer(() => true, [lookupTool(call)]);
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      await post(channel, rpc(3, "tools/call", { name: "lookup", arguments: {} }));

      expect(call).toHaveBeenCalledWith({}, null);
    });

    it(`https://github.com/Brevilabs/obsidian-copilot-private/issues/672 keeps the caller stamp out of a connected service's tool arguments`, async () => {
      server.dispose();
      const provider = connectorProvider();
      server = createCopilotMcpServer(() => true, [], provider);
      const channel = await server.connect("opencode:/vault", "claude", NO_CHAT);

      await post(
        channel,
        rpc(3, "tools/call", {
          name: "notion_search",
          arguments: { query: "plans", caller_session_id: "ses_caller" },
        })
      );

      expect(provider.call).toHaveBeenCalledWith("notion_search", { query: "plans" });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/787 returns a hosted tool's image after its text", async () => {
      server.dispose();
      server = createCopilotMcpServer(
        () => true,
        [
          lookupTool(
            jest.fn().mockResolvedValue({
              text: "Rendered Flow.excalidraw.md.",
              isError: false,
              image: { data: "iVBORw0KGgo=", mimeType: "image/png" },
            })
          ),
        ]
      );
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, rpc(3, "tools/call", { name: "lookup", arguments: {} }));

      expect(result.body).toMatchObject({
        result: {
          content: [
            { type: "text", text: "Rendered Flow.excalidraw.md." },
            { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          ],
          isError: false,
        },
      });
    });

    it("marks a hosted tool's failed call as an error result", async () => {
      server.dispose();
      server = createCopilotMcpServer(
        () => true,
        [lookupTool(jest.fn().mockResolvedValue({ text: "Lookup failed.", isError: true }))]
      );
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "lookup", arguments: { query: "x" } })
      );

      expect(result.body).toMatchObject({
        result: { content: [{ text: "Lookup failed." }], isError: true },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/733 answers a call to a switched-off hosted tool with its turned-off text and does not run it", async () => {
      const call = jest.fn();
      server.dispose();
      server = createCopilotMcpServer(
        (toolName) => toolName === "send_feedback",
        [lookupTool(call)]
      );
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "lookup", arguments: { query: "x" } })
      );

      expect(call).not.toHaveBeenCalled();
      expect(result.body).toMatchObject({
        result: { content: [{ text: "lookup is off. Don't call it again." }], isError: false },
      });
    });

    it("lists no tools while send_feedback is switched off", async () => {
      server.dispose();
      server = createCopilotMcpServer(() => false, []);
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, rpc(2, "tools/list"));

      expect(result.body).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
    });

    it("raises a send_feedback call's card in its own session's chat and tells the agent the card was shown", async () => {
      const own = fakeChat();
      const other = fakeChat();
      const channel = await server.connect("session-a", "claude", () => own);
      await server.connect("session-b", "claude", () => other);

      const result = await post(
        channel,
        rpc(3, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(offerIn(own)).toMatchObject({
        trigger: "agent",
        draft: COMPLAINT_DRAFT,
        status: "open",
      });
      expect(offerIn(other)).toBeNull();
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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 tells the agent to stop when its chat already offered a report, and keeps the earlier card", async () => {
      const chat = fakeChat();
      const channel = await server.connect("session-a", "claude", () => chat);
      await post(channel, rpc(3, "tools/call", { name: "send_feedback", arguments: COMPLAINT }));
      const first = offerIn(chat);

      const result = await post(
        channel,
        rpc(4, "tools/call", {
          name: "send_feedback",
          arguments: { ...COMPLAINT, title: "A second complaint" },
        })
      );

      expect(offerIn(chat)).toBe(first);
      expect(result.body).toMatchObject({
        result: {
          content: [{ text: "Already offered this session. Don't call send_feedback again." }],
          isError: false,
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 tells the agent nothing was shown when a send_feedback call can't be traced to a chat", async () => {
      const channel = await server.connect("opencode:/vault", "claude", NO_CHAT);

      const result = await post(
        channel,
        rpc(4, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(result.body).toMatchObject({
        result: {
          content: [
            {
              text: "Copilot couldn't tell which chat this came from, so nothing was shown. Don't call send_feedback again.",
            },
          ],
          isError: false,
        },
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/733 answers a call to a switched-off send_feedback with the turned-off result and raises no card", async () => {
      let on = true;
      server.dispose();
      server = createCopilotMcpServer(() => on, []);
      const chat = fakeChat();
      const channel = await server.connect("session-a", "claude", () => chat);

      on = false;
      const result = await post(
        channel,
        rpc(4, "tools/call", { name: "send_feedback", arguments: COMPLAINT })
      );

      expect(offerIn(chat)).toBeNull();
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
      const chat = fakeChat();
      const channel = await server.connect("session-a", "claude", () => chat);

      await post(
        channel,
        rpc(5, "tools/call", {
          name: "send_feedback",
          arguments: { title: "  Retracted answer  ", what_happened: "x", repro: "y" },
        })
      );

      expect(offerIn(chat)?.draft).toEqual({
        title: "Retracted answer",
        whatHappened: "x",
        userSaid: "",
        repro: "y",
      });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 raises the card in the chat found by the caller session an agent stamped on the call, and keeps the stamp out of the draft", async () => {
      const chat = fakeChat();
      const findChat = jest.fn(() => chat);
      const channel = await server.connect("opencode:/vault", "claude", findChat);

      await post(
        channel,
        rpc(6, "tools/call", {
          name: "send_feedback",
          arguments: { ...COMPLAINT, caller_session_id: "ses_caller" },
        })
      );

      expect(findChat).toHaveBeenCalledWith("ses_caller");
      expect(offerIn(chat)?.draft).toEqual(COMPLAINT_DRAFT);
    });

    it("rejects a call missing a required field without raising a card", async () => {
      const chat = fakeChat();
      const channel = await server.connect("session-a", "claude", () => chat);

      const result = await post(
        channel,
        rpc(6, "tools/call", { name: "send_feedback", arguments: { title: "Only a title" } })
      );

      expect(offerIn(chat)).toBeNull();
      expect(result.body).toMatchObject({ result: { isError: true } });
    });

    it("reports an unknown tool or method as an error", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const tool = await post(channel, rpc(7, "tools/call", { name: "delete_vault" }));
      const method = await post(channel, rpc(8, "resources/list"));

      expect(tool.body).toMatchObject({ result: { isError: true } });
      expect(method.body).toMatchObject({ error: { code: -32601 } });
    });

    it("acknowledges notifications with 202 and no body", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, { jsonrpc: "2.0", method: "notifications/initialized" });

      expect(result).toEqual({ status: 202, body: null });
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 refuses a request without a session's token, so nothing else on the machine can raise a card", async () => {
      const findChat = jest.fn(() => fakeChat());
      const channel = await server.connect("session-a", "claude", findChat);

      const result = await post(
        channel,
        rpc(9, "tools/call", { name: "send_feedback", arguments: COMPLAINT }),
        { headers: { Authorization: "Bearer forged" } }
      );

      expect(result.status).toBe(401);
      expect(findChat).not.toHaveBeenCalled();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 declines the optional SSE stream with 405", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

      const result = await post(channel, "", { method: "GET" });

      expect(result.status).toBe(405);
    });

    it("rejects a request body over 16 MiB of UTF-8 without raising a card, even when it has fewer characters", async () => {
      const findChat = jest.fn(() => fakeChat());
      const channel = await server.connect("session-a", "claude", findChat);

      const result = await post(
        channel,
        rpc(5, "tools/call", {
          name: "send_feedback",
          arguments: { ...COMPLAINT, repro: "界".repeat(6_000_000) },
        })
      );

      expect(result).toMatchObject({ status: 400, body: { error: { code: -32700 } } });
      expect(findChat).not.toHaveBeenCalled();
    });

    it("answers other paths with 404, malformed JSON with a parse error and a non-object or batch with an invalid request", async () => {
      const channel = await server.connect("session-a", "claude", NO_CHAT);

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

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 hands a reconnected key its existing token and sends its calls to the newest chat lookup", async () => {
      const replaced = fakeChat();
      const current = fakeChat();
      const first = await server.connect("opencode:/vault", "claude", () => replaced);

      const again = await server.connect("opencode:/vault", "claude", () => current);
      await post(first, rpc(1, "tools/call", { name: "send_feedback", arguments: COMPLAINT }));

      expect(again).toEqual(first);
      expect(offerIn(current)).not.toBeNull();
      expect(offerIn(replaced)).toBeNull();
    });

    it("revokes a session's token on disconnect and leaves other sessions working", async () => {
      const kept = await server.connect("session-a", "claude", NO_CHAT);
      const revoked = await server.connect("session-b", "claude", NO_CHAT);

      server.disconnect("session-b");

      expect((await post(kept, rpc(1, "ping"))).status).toBe(200);
      expect((await post(revoked, rpc(1, "ping"))).status).toBe(401);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 fails a connect still waiting for the server to start when it is disposed", async () => {
      const pending = server.connect("session-a", "claude", NO_CHAT);

      server.dispose();

      await expect(pending).rejects.toThrow("The Copilot MCP server is closed.");
    });

    it("refuses new sessions after dispose", async () => {
      server.dispose();

      await expect(server.connect("session-a", "claude", NO_CHAT)).rejects.toThrow(
        "The Copilot MCP server is closed."
      );
    });
  });
});
