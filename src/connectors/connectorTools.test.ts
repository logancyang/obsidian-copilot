/**
 * @jest-environment node
 */
import { MAX_PROVIDED_TOOL_NAME_LENGTH } from "@/agentMode/session/copilotMcpServer";
import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectionManager, type ConnectorAuthPort } from "@/connectors/connectionManager";
import { ConnectorTools } from "@/connectors/connectorTools";
import type { AccessTokenResult } from "@/connectors/oauth/connectorAuth";
import { FakeMcpService } from "@/connectors/testing/fakeMcpService";
import { logWarn } from "@/logger";
import { setSettings } from "@/settings/model";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/857";

const NOTION: ConnectorCatalogEntry = {
  id: "notion",
  name: "Notion",
  description: "Pages and databases",
  category: "Notes & docs",
  serverUrl: "https://mcp.notion.test/mcp",
};
const ATLASSIAN: ConnectorCatalogEntry = {
  id: "atlassian",
  name: "Atlassian",
  description: "Jira issues and Confluence pages",
  category: "Tasks & projects",
  serverUrl: "https://mcp.atlassian.test/v2/mcp",
};
const LINEAR: ConnectorCatalogEntry = {
  id: "linear",
  name: "Linear",
  description: "Issues and projects",
  category: "Tasks & projects",
  serverUrl: "https://mcp.linear.test/mcp",
};

const SEARCH_NOTES = {
  name: "search_notes",
  description: "Search notes by keyword.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  outputSchema: { type: "object" },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const CREATE_NOTE = {
  name: "create_note",
  description: "Create a note.",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

const AGENT_PREFIX = "mcp__obsidian-copilot__";

function connected(accessToken: string): AccessTokenResult {
  return { status: "connected", accessToken };
}

function setUp(
  options: { connections?: Array<{ id: string; serviceId: string }>; enabled?: boolean } = {}
) {
  jest.mocked(logWarn).mockClear();
  setSettings({ connectors: options.connections ?? [{ id: "c-notion", serviceId: "notion" }] });
  const logins = new Map<string, AccessTokenResult>([
    ["c-notion", connected("notion-1")],
    ["c-atlassian", connected("atlassian-1")],
  ]);
  const refreshed = new Map<string, AccessTokenResult>();
  const auth = {
    hasLogin: (connectionId: string) => logins.has(connectionId),
    login: jest.fn((target: { connectionId: string; serviceName: string }) => {
      logins.set(target.connectionId, connected(`${target.connectionId}-token`));
      return {
        connectionId: target.connectionId,
        serviceName: target.serviceName,
        outcome: Promise.resolve({ status: "connected" as const }),
        loginUrl: () => null,
        cancel: () => {},
      };
    }),
    accessToken: jest.fn(async (connectionId: string, options?: { forceRefresh?: boolean }) => {
      if (options?.forceRefresh) logins.set(connectionId, refreshed.get(connectionId)!);
      return logins.get(connectionId) ?? { status: "needs-login" as const };
    }),
    disconnect: jest.fn(async (connectionId: string) => {
      logins.delete(connectionId);
    }),
  } satisfies ConnectorAuthPort;
  const manager = new ConnectionManager({ auth, catalog: [NOTION, ATLASSIAN, LINEAR] });

  const notion = new FakeMcpService(NOTION.serverUrl);
  notion.validTokens.add("notion-1");
  notion.tools = [SEARCH_NOTES, CREATE_NOTE];
  const atlassian = new FakeMcpService(ATLASSIAN.serverUrl);
  atlassian.validTokens.add("atlassian-1");
  const services = [notion, atlassian];
  const fetch: FetchLike = (url, init) =>
    services
      .find((service) => String(url).startsWith(new URL(service.url).origin))!
      .fetch(url, init);

  let enabled = options.enabled ?? true;
  const enabledListeners = new Set<() => void>();
  const tools = new ConnectorTools({
    manager,
    catalog: [NOTION, ATLASSIAN, LINEAR],
    isEnabled: () => enabled,
    maxToolNameLength: MAX_PROVIDED_TOOL_NAME_LENGTH,
    subscribeToEnabledChange: (listener) => {
      enabledListeners.add(listener);
      return () => enabledListeners.delete(listener);
    },
    fetch,
  });
  const setEnabled = (next: boolean) => {
    enabled = next;
    enabledListeners.forEach((listener) => listener());
  };
  const statusOf = (connectionId: string) =>
    manager.getSnapshot().connections.find(({ id }) => id === connectionId)?.status;
  return { auth, logins, refreshed, manager, notion, atlassian, tools, setEnabled, statusOf };
}

function loggedText(): string {
  return jest
    .mocked(logWarn)
    .mock.calls.flat()
    .map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg)))
    .join("\n");
}

function textOf(result: { content: readonly unknown[] }): string {
  return result.content.map((item) => (item as { text?: string }).text ?? "").join("");
}

describe("connectorTools", () => {
  describe("ConnectorTools", () => {
    afterEach(() => jest.useRealTimers());

    describe("refresh()", () => {
      it("checks every connection's login first, so a new chat starts from fresh statuses", async () => {
        const fake = setUp({
          connections: [
            { id: "c-notion", serviceId: "notion" },
            { id: "c-linear", serviceId: "linear" },
          ],
        });

        await fake.tools.refresh();

        expect(fake.auth.accessToken).toHaveBeenCalledWith("c-notion", undefined);
        expect(fake.auth.accessToken).toHaveBeenCalledWith("c-linear", undefined);
        expect(fake.statusOf("c-linear")).toBe("needs-login");
      });

      it("reads a service's tool list once, and a service connected since then at the next refresh", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        await fake.tools.refresh();
        expect(fake.notion.callsOf("tools/list")).toHaveLength(1);

        await fake.manager.connect("atlassian");
        fake.atlassian.validTokens.add(fake.manager.getSnapshot().connections[1].id + "-token");
        fake.atlassian.tools = [{ name: "search", inputSchema: { type: "object" } }];
        await fake.tools.refresh();

        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
          "atlassian_search",
        ]);
        expect(fake.notion.callsOf("tools/list")).toHaveLength(1);
      });

      it("drops a disconnected service's tools", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        await fake.manager.disconnect("c-notion");
        await fake.tools.refresh();

        expect(fake.tools.tools()).toEqual([]);
        expect(fake.tools.call("notion_search_notes", {})).toBeNull();
      });

      it("lists nothing for a service it couldn't reach and shows that service as couldn't reach", async () => {
        const fake = setUp({
          connections: [
            { id: "c-notion", serviceId: "notion" },
            { id: "c-atlassian", serviceId: "atlassian" },
          ],
        });
        fake.atlassian.unreachable = true;

        await fake.tools.refresh();

        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
        ]);
        expect(fake.statusOf("c-atlassian")).toBe("unreachable");
      });

      it(`${ISSUE} logs *** in place of the connection's access token when the service's tool-list error echoes it`, async () => {
        const fake = setUp();
        fake.notion.failWithStatus = 400;
        fake.notion.failBody = "rejected Bearer notion-1";

        await fake.tools.refresh();

        expect(loggedText()).toContain("rejected Bearer ***");
        expect(loggedText()).not.toContain("notion-1");
      });

      it(`${ISSUE} gives up on a service whose tool list hasn't arrived after 10 seconds, so one hanging service can't hold every new chat`, async () => {
        jest.useFakeTimers();
        const fake = setUp();
        fake.notion.hangs = true;

        const refreshing = fake.tools.refresh();
        await jest.advanceTimersByTimeAsync(10_000);
        await refreshing;

        expect(fake.tools.tools()).toEqual([]);
        expect(fake.statusOf("c-notion")).toBe("unreachable");
      });

      it(`${ISSUE} gives up on a login check that hasn't finished after 10 seconds, still listing the tools of every service whose login checked out`, async () => {
        jest.useFakeTimers();
        const fake = setUp({
          connections: [
            { id: "c-notion", serviceId: "notion" },
            { id: "c-atlassian", serviceId: "atlassian" },
          ],
        });
        const checkLogin = fake.auth.accessToken.getMockImplementation()!;
        fake.auth.accessToken.mockImplementation((connectionId, options) =>
          connectionId === "c-atlassian" ? new Promise(() => {}) : checkLogin(connectionId, options)
        );

        const refreshing = fake.tools.refresh();
        await jest.advanceTimersByTimeAsync(10_000);
        await refreshing;

        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
        ]);
        expect(fake.statusOf("c-atlassian")).toBe("unreachable");
        expect(fake.atlassian.requests).toEqual([]);
      });

      it("contacts no service while the connectors entitlement is off", async () => {
        const fake = setUp({ enabled: false });

        await fake.tools.refresh();

        expect(fake.auth.accessToken).not.toHaveBeenCalled();
        expect(fake.notion.requests).toEqual([]);
      });
    });

    describe("tools()", () => {
      it("lists each connected service's tools as <serviceId>_<tool>, named after the service in the description, with the service's annotations", async () => {
        const fake = setUp();

        await fake.tools.refresh();

        expect(fake.tools.tools()).toEqual([
          {
            name: "notion_search_notes",
            description: "Notion: Search notes by keyword.",
            inputSchema: SEARCH_NOTES.inputSchema,
            annotations: { readOnlyHint: true, openWorldHint: false },
          },
          {
            name: "notion_create_note",
            description: "Notion: Create a note.",
            inputSchema: CREATE_NOTE.inputSchema,
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
        ]);
      });

      it("reads every page of a service's tool list", async () => {
        const fake = setUp();
        fake.notion.tools = [SEARCH_NOTES, CREATE_NOTE, { name: "delete_note" }];

        await fake.tools.refresh();

        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
          "notion_delete_note",
        ]);
        expect(fake.tools.tools()[2]).toEqual({
          name: "notion_delete_note",
          description: "Notion",
          inputSchema: { type: "object" },
        });
      });

      it(`${ISSUE} shortens a name agents would see as over 64 characters to the same unique name every time, and still calls the service's own tool`, async () => {
        const longNames = [
          "getConfluencePageFooterComments",
          "getConfluencePageDescendantsWithReplies",
          "getConfluencePageDescendantsWithLabels",
        ];
        const fake = setUp({ connections: [{ id: "c-atlassian", serviceId: "atlassian" }] });
        fake.atlassian.tools = longNames.map((name) => ({ name }));
        await fake.tools.refresh();
        const names = fake.tools.tools().map(({ name }) => name);

        const again = setUp({ connections: [{ id: "c-atlassian", serviceId: "atlassian" }] });
        again.atlassian.tools = longNames.map((name) => ({ name }));
        await again.tools.refresh();

        expect(names[0]).toBe("atlassian_getConfluencePageFooterComments");
        expect(names[1]).toMatch(/^atlassian_getConfluencePageDesce_[0-9a-f]{8}$/);
        expect(new Set(names).size).toBe(3);
        for (const name of names) expect(`${AGENT_PREFIX}${name}`.length).toBeLessThanOrEqual(64);
        expect(again.tools.tools().map(({ name }) => name)).toEqual(names);
        await fake.tools.call(names[2], {});
        expect(fake.atlassian.callsOf("tools/call")[0].params).toEqual({
          name: "getConfluencePageDescendantsWithLabels",
          arguments: {},
        });
      });

      it("leaves out a service whose login needs reconnecting", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        fake.manager.reportFailure("c-notion", "needs-login");

        expect(fake.tools.tools()).toEqual([]);
      });

      it("lists nothing while the connectors entitlement is off", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        fake.setEnabled(false);

        expect(fake.tools.tools()).toEqual([]);
        expect(fake.tools.call("notion_search_notes", {})).toBeNull();
      });
    });

    describe("forget()", () => {
      it(`stops counting a closed chat's tool list, so a service logging in again leaves the chats that listed it quiet (${ISSUE})`, async () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);
        await fake.tools.refresh();
        fake.tools.tools({ sessionKey: "chat-a", backendId: "claude" });
        fake.logins.set("c-notion", { status: "needs-login" });
        await fake.tools.refresh();
        fake.tools.tools({ sessionKey: "chat-b", backendId: "claude" });

        fake.tools.forget("chat-b");
        await fake.manager.reconnect("c-notion");

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("call()", () => {
      it("forwards a call to the service's own tool with the connection's token and returns the service's result", async () => {
        const fake = setUp();
        fake.notion.answer = (name, args) => ({
          content: [{ type: "text", text: `${name} ${JSON.stringify(args)}` }],
        });
        await fake.tools.refresh();

        const result = await fake.tools.call("notion_search_notes", { query: "plans" });

        expect(result).toEqual({
          content: [{ type: "text", text: 'search_notes {"query":"plans"}' }],
          isError: false,
        });
        expect(fake.notion.callsOf("tools/call")[0]).toMatchObject({
          token: "notion-1",
          params: { name: "search_notes", arguments: { query: "plans" } },
        });
      });

      it("passes on a result the service marks as an error, and its structured content as text when it has no content", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        fake.notion.answer = () => ({
          content: [{ type: "text", text: "No access" }],
          isError: true,
        });
        const failed = await fake.tools.call("notion_search_notes", {});
        fake.notion.answer = () => ({ content: [], structuredContent: { hits: 2 } });
        const structured = await fake.tools.call("notion_search_notes", {});

        expect(failed).toEqual({ content: [{ type: "text", text: "No access" }], isError: true });
        expect(structured).toEqual({
          content: [{ type: "text", text: '{"hits":2}' }],
          isError: false,
        });
      });

      it(`${ISSUE} reads a reply the service streams as server-sent events after a notification, without waiting for the service to close the stream`, async () => {
        const fake = setUp();
        fake.notion.repliesWithEventStream = true;
        await fake.tools.refresh();

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toBe("ran search_notes");
      });

      it(`${ISSUE} retries once with a refreshed token when the service answers 401`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.validTokens.clear();
        fake.notion.validTokens.add("notion-2");
        fake.refreshed.set("c-notion", connected("notion-2"));

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toBe("ran search_notes");
        expect(fake.auth.accessToken).toHaveBeenCalledWith("c-notion", { forceRefresh: true });
        expect(fake.statusOf("c-notion")).toBe("connected");
      });

      it(`${ISSUE} tells the agent, without flagging a tool failure that would raise a Copilot bug report, that the user must reconnect the service, and shows it as needs login, when its login can't be refreshed`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.validTokens.clear();
        fake.refreshed.set("c-notion", { status: "needs-login" });

        const result = await fake.tools.call("notion_search_notes", {});

        expect(result).toEqual({
          content: [
            {
              type: "text",
              text: "Notion needs a new login because the login expired or was revoked, which isn't a Copilot failure. Tell the user to reconnect Notion in Settings → Connectors, then try again.",
            },
          ],
          isError: false,
        });
        expect(fake.statusOf("c-notion")).toBe("needs-login");
      });

      it("treats a freshly refreshed token the service still rejects as a login to reconnect", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.validTokens.clear();
        fake.refreshed.set("c-notion", connected("notion-2"));

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toContain("reconnect Notion in Settings → Connectors");
        expect(fake.statusOf("c-notion")).toBe("needs-login");
      });

      it("answers with the reconnect message without contacting a service whose login already needs reconnecting", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.logins.delete("c-notion");

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toContain("reconnect Notion in Settings → Connectors");
        expect(fake.notion.callsOf("tools/call")).toEqual([]);
      });

      it.each([
        ["is unreachable", (notion: FakeMcpService) => (notion.unreachable = true)],
        ["answers 503", (notion: FakeMcpService) => (notion.failWithStatus = 503)],
      ])(
        "says Copilot couldn't reach the service, which isn't a Copilot failure, and shows it as couldn't reach, when it %s",
        async (_condition, breakService) => {
          const fake = setUp();
          await fake.tools.refresh();
          breakService(fake.notion);

          const result = await fake.tools.call("notion_search_notes", {});

          expect(result).toEqual({
            content: [
              {
                type: "text",
                text: "Couldn't reach Notion, which isn't a Copilot failure. Try again later.",
              },
            ],
            isError: true,
          });
          expect(fake.statusOf("c-notion")).toBe("unreachable");
        }
      );

      it("returns the service's error for a call it rejects, keeping the connection connected", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.tools = [];

        const result = await fake.tools.call("notion_search_notes", {});

        expect(result).toEqual({
          content: [{ type: "text", text: "Notion returned an error: Unknown tool" }],
          isError: true,
        });
        expect(fake.statusOf("c-notion")).toBe("connected");
      });

      it(`${ISSUE} returns *** in place of the connection's access token when the service's error echoes it`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.failWithStatus = 400;
        fake.notion.failBody = "unknown token notion-1";

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toBe("Notion returned an error: HTTP 400 unknown token ***");
      });

      it(`${ISSUE} starts a new service session and retries when the service has ended the old one`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.expireSessions();

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toBe("ran search_notes");
        expect(fake.notion.callsOf("initialize")).toHaveLength(2);
      });

      it("returns a very large result whole, leaving its size to the agent", async () => {
        const content = [
          { type: "text", text: "a".repeat(400_000) },
          { type: "image", data: "aW1n", mimeType: "image/png" },
        ];
        const fake = setUp();
        fake.notion.answer = () => ({ content });
        await fake.tools.refresh();

        const result = await fake.tools.call("notion_search_notes", {});

        expect(result).toEqual({ content, isError: false });
      });

      it("returns null for a name no connected service lists, so Copilot's server answers it as unknown", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        expect(fake.tools.call("notion_unknown", {})).toBeNull();
      });
    });

    describe("subscribeToToolSetChange()", () => {
      it("tells the listener when a service is connected or disconnected, for every backend, until it unsubscribes", async () => {
        const fake = setUp();
        const listener = jest.fn();
        const unsubscribe = fake.tools.subscribeToToolSetChange(listener);

        await fake.manager.connect("atlassian");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]("claude")).toBe(true);
        await fake.manager.disconnect("c-notion");
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        await fake.manager.disconnect(fake.manager.getSnapshot().connections[0].id);

        expect(listener).toHaveBeenCalledTimes(2);
      });

      it("stays quiet when a listed service's login expires and comes back, since the chats that listed it keep its tools", async () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);
        await fake.tools.refresh();
        fake.tools.tools({ sessionKey: "chat-a", backendId: "claude" });

        fake.manager.reportFailure("c-notion", "needs-login");
        await fake.manager.reconnect("c-notion");

        expect(fake.statusOf("c-notion")).toBe("connected");
        expect(listener).not.toHaveBeenCalled();
      });

      it(`tells the listener about the backend of a chat that started while a service needed a login, once that service logs in again (${ISSUE})`, async () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);
        fake.logins.set("c-notion", { status: "needs-login" });
        await fake.tools.refresh();
        fake.tools.tools({ sessionKey: "chat-b", backendId: "codex" });
        expect(listener).not.toHaveBeenCalled();

        await fake.manager.reconnect("c-notion");

        expect(fake.statusOf("c-notion")).toBe("connected");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]("codex")).toBe(true);
        expect(listener.mock.calls[0][0]("claude")).toBe(false);
      });

      it(`tells the listener when a service logs in again that an earlier chat listed but a chat started while it needed a login did not (${ISSUE})`, async () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);
        await fake.tools.refresh();
        fake.tools.tools({ sessionKey: "chat-a", backendId: "claude" });
        fake.logins.set("c-notion", { status: "needs-login" });
        await fake.tools.refresh();
        expect(fake.tools.tools({ sessionKey: "chat-b", backendId: "claude" })).toEqual([]);

        await fake.manager.reconnect("c-notion");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]("claude")).toBe(true);
      });

      it("tells the listener when the connectors entitlement turns on or off", () => {
        const fake = setUp({ enabled: false });
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);

        fake.setEnabled(true);
        fake.setEnabled(true);
        fake.setEnabled(false);

        expect(listener).toHaveBeenCalledTimes(2);
      });
    });
  });
});
