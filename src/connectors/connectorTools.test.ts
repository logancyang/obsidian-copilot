/**
 * @jest-environment node
 */
import { MAX_PROVIDED_TOOL_NAME_LENGTH } from "@/agentMode/session/copilotMcpServer";
import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectionManager, type ConnectorAuthPort } from "@/connectors/connectionManager";
import { ConnectorTools, describeConnectorTool } from "@/connectors/connectorTools";
import { CustomConnectors } from "@/connectors/custom/customConnectors";
import { FakeProcess } from "@/connectors/custom/testing/fakeCustomProcess";
import { fakeKeychain } from "@/connectors/custom/testing/fakeKeychain";
import type { AccessTokenResult } from "@/connectors/oauth/connectorAuth";
import { FakeMcpService } from "@/connectors/testing/fakeMcpService";
import { logWarn } from "@/logger";
import { setSettings } from "@/settings/model";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/857";
const CUSTOM_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";
const TOOLS_PAGE_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/878";
const ECHO_JSON = JSON.stringify({ name: "Echo", command: "echo", env: { FAKE_KEY: "k" } });

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
  setSettings({
    connectors: options.connections ?? [{ id: "c-notion", serviceId: "notion" }],
    customConnectors: [],
  });
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
  const processes: FakeProcess[] = [];
  const custom = new CustomConnectors({
    keychain: fakeKeychain().keychain,
    deviceStorage: { load: () => null, save: () => {} },
    catalogIds: [NOTION.id, ATLASSIAN.id, LINEAR.id],
    isEnabled: () => enabled,
    maxToolNameLength: MAX_PROVIDED_TOOL_NAME_LENGTH,
    startProcess: (processOptions, crash) => {
      const process = new FakeProcess(processOptions, crash);
      processes.push(process);
      return process;
    },
  });
  const addCustom = (text: string) => {
    const parsed = custom.parse(text);
    if (parsed.ok) custom.add(parsed.connectors);
  };
  const tools = new ConnectorTools({
    custom,
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
  return {
    auth,
    logins,
    refreshed,
    manager,
    notion,
    atlassian,
    tools,
    setEnabled,
    statusOf,
    custom,
    addCustom,
    processes,
  };
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

      it("drops a disconnected service's tools and closes its connections", async () => {
        const fake = setUp();
        await fake.tools.refresh();

        await fake.manager.disconnect("c-notion");
        await fake.tools.refresh();

        expect(fake.tools.tools()).toEqual([]);
        expect(fake.tools.call("notion_search_notes", {})).toBeNull();
        expect(fake.notion.requests.every(({ signal }) => signal?.aborted)).toBe(true);
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

        expect(loggedText()).toContain("HTTP 400 rejected ***");
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

        fake.addCustom(ECHO_JSON);
        await fake.tools.refresh();

        expect(fake.auth.accessToken).not.toHaveBeenCalled();
        expect(fake.notion.requests).toEqual([]);
        expect(fake.processes).toEqual([]);
      });

      it(`starts custom connectors added on this device alongside the catalog services: ${CUSTOM_ISSUE}`, async () => {
        const fake = setUp();
        setSettings({
          customConnectors: [{ id: "echo", name: "Echo", command: "echo", args: [], envNames: [] }],
        });

        await fake.tools.refresh();

        expect(fake.processes).toHaveLength(1);
        expect(fake.notion.callsOf("tools/list")).toHaveLength(1);
      });
    });

    describe("loadConnected()", () => {
      it(`${TOOLS_PAGE_ISSUE} lists each connected service's tools, with their titles and read-only hints, without waiting for a chat`, async () => {
        const fake = setUp({
          connections: [
            { id: "c-notion", serviceId: "notion" },
            { id: "c-linear", serviceId: "linear" },
          ],
        });
        fake.notion.tools = [{ ...SEARCH_NOTES, title: "Search notes" }, CREATE_NOTE];
        await fake.manager.checkStatus();

        await fake.tools.loadConnected();

        expect(fake.tools.getSnapshot().get("c-notion")).toEqual([
          expect.objectContaining({
            name: "search_notes",
            title: "Search notes",
            description: "Search notes by keyword.",
            annotations: { readOnlyHint: true, openWorldHint: false },
          }),
          expect.objectContaining({ name: "create_note", annotations: CREATE_NOTE.annotations }),
        ]);
        expect(fake.tools.getSnapshot().has("c-linear")).toBe(false);
      });

      it("lists a service only once, however often Settings opens", async () => {
        const fake = setUp();

        await fake.tools.loadConnected();
        await fake.tools.loadConnected();
        await fake.tools.refresh();

        expect(fake.notion.callsOf("tools/list")).toHaveLength(1);
      });

      it("drops a disconnected service's tools", async () => {
        const fake = setUp();
        await fake.tools.loadConnected();

        await fake.manager.disconnect("c-notion");
        await fake.tools.loadConnected();

        expect(fake.tools.getSnapshot().size).toBe(0);
      });

      it("contacts no service while the connectors entitlement is off", async () => {
        const fake = setUp({ enabled: false });

        await fake.tools.loadConnected();

        expect(fake.notion.requests).toEqual([]);
      });
    });

    describe("subscribe()", () => {
      it("tells the listener when a service's tools are listed or dropped, until it unsubscribes", async () => {
        const fake = setUp();
        const listener = jest.fn();
        const unsubscribe = fake.tools.subscribe(listener);

        await fake.tools.loadConnected();
        expect(listener).toHaveBeenCalledTimes(1);
        fake.notion.unreachable = true;
        await fake.tools.checkAgain("c-notion");
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        fake.notion.unreachable = false;
        await fake.tools.checkAgain("c-notion");
        expect(listener).toHaveBeenCalledTimes(2);
      });
    });

    describe("getSnapshot()", () => {
      it("returns the same snapshot until the listed tools change", async () => {
        const fake = setUp();
        const empty = fake.tools.getSnapshot();
        expect(fake.tools.getSnapshot()).toBe(empty);

        await fake.tools.loadConnected();

        const listed = fake.tools.getSnapshot();
        expect(listed).not.toBe(empty);
        expect(fake.tools.getSnapshot()).toBe(listed);
      });
    });

    describe("checkAgain()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 lists a couldn't-reach service's tools again and shows it connected once it answers", async () => {
        const fake = setUp();
        fake.notion.unreachable = true;
        await fake.tools.refresh();
        expect(fake.statusOf("c-notion")).toBe("unreachable");
        fake.notion.unreachable = false;

        await fake.tools.checkAgain("c-notion");

        expect(fake.statusOf("c-notion")).toBe("connected");
        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 keeps a service that is still down as couldn't reach, though its login is still valid", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.unreachable = true;
        fake.manager.reportFailure("c-notion", "unreachable");

        await fake.tools.checkAgain("c-notion");

        expect(fake.statusOf("c-notion")).toBe("unreachable");
        expect(fake.tools.tools()).toEqual([]);
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
        expect(fake.atlassian.callsOf("tools/call")[0].params).toMatchObject({
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

      it(`lists a connected custom connector's tools after the catalog services' tools, as <connector>_<tool>: ${CUSTOM_ISSUE}`, async () => {
        const fake = setUp();
        fake.addCustom(ECHO_JSON);
        await fake.tools.refresh();

        expect(fake.tools.tools().map(({ name }) => name)).toEqual([
          "notion_search_notes",
          "notion_create_note",
          "echo_echo",
          "echo_remember",
        ]);
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

    describe("dispose()", () => {
      it("closes every connected service's connections as it is called and stops offering their tools", async () => {
        const fake = setUp({
          connections: [
            { id: "c-notion", serviceId: "notion" },
            { id: "c-atlassian", serviceId: "atlassian" },
          ],
        });
        fake.atlassian.tools = [{ name: "search", inputSchema: { type: "object" } }];
        await fake.tools.refresh();

        void fake.tools.dispose();

        expect(fake.tools.tools()).toEqual([]);
        const requests = [...fake.notion.requests, ...fake.atlassian.requests];
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every(({ signal }) => signal?.aborted)).toBe(true);
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

      it(`${ISSUE} https://github.com/Brevilabs/obsidian-copilot-private/issues/860 tells the agent, without flagging a tool failure that would raise a Copilot bug report, to show the user a Reconnect card, and shows the service as needs login, when its login can't be refreshed`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.notion.validTokens.clear();
        fake.refreshed.set("c-notion", { status: "needs-login" });

        const result = await fake.tools.call("notion_search_notes", {});

        expect(result).toEqual({
          content: [
            {
              type: "text",
              text: 'Notion needs a new login because the login expired or was revoked, which isn\'t a Copilot failure. Call suggest_connector with service "notion" so the user can reconnect it.',
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

        expect(textOf(result!)).toContain('Call suggest_connector with service "notion"');
        expect(fake.statusOf("c-notion")).toBe("needs-login");
      });

      it("answers with the reconnect message without contacting a service whose login already needs reconnecting", async () => {
        const fake = setUp();
        await fake.tools.refresh();
        fake.logins.delete("c-notion");

        const result = await fake.tools.call("notion_search_notes", {});

        expect(textOf(result!)).toContain('Call suggest_connector with service "notion"');
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
          content: [
            { type: "text", text: "Notion returned an error: MCP error -32602: Unknown tool" },
          ],
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

      it(`${ISSUE} waits 5 minutes for a call the service hasn't answered or reported progress on, then tells the agent it timed out`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        jest.useFakeTimers();
        fake.notion.holdsCalls = true;
        let settled = false;

        const calling = fake.tools.call("notion_search_notes", {})!.finally(() => (settled = true));
        await jest.advanceTimersByTimeAsync(5 * 60_000 - 1);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        await expect(calling).resolves.toEqual({
          content: [
            { type: "text", text: "Notion returned an error: MCP error -32001: Request timed out" },
          ],
          isError: true,
        });
      });

      it(`${ISSUE} keeps waiting past 5 minutes on a call while the service reports progress`, async () => {
        const fake = setUp();
        await fake.tools.refresh();
        jest.useFakeTimers();
        fake.notion.holdsCalls = true;

        const calling = fake.tools.call("notion_search_notes", {})!;
        await jest.advanceTimersByTimeAsync(4 * 60_000);
        fake.notion.heldCalls[0].reportProgress();
        await jest.advanceTimersByTimeAsync(4 * 60_000);
        fake.notion.heldCalls[0].finish();

        await expect(calling).resolves.toEqual({
          content: [{ type: "text", text: "ran search_notes" }],
          isError: false,
        });
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

      it(`forwards a custom connector's tool to its server: ${CUSTOM_ISSUE}`, async () => {
        const fake = setUp();
        fake.addCustom(ECHO_JSON);
        await fake.tools.refresh();

        const result = await fake.tools.call("echo_echo", { text: "hi" });

        expect(textOf(result!)).toBe("k: hi");
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

      it(`tells every backend when a custom connector is added, edited, turned off or removed: ${CUSTOM_ISSUE}`, async () => {
        const fake = setUp();
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);

        fake.addCustom(ECHO_JSON);
        await fake.custom.refresh();
        fake.custom.edit("echo", JSON.stringify({ name: "Echo", command: "echo2" }));
        await fake.custom.refresh();
        fake.custom.setTurnedOff("echo", true);
        fake.custom.remove("echo");

        expect(listener).toHaveBeenCalledTimes(3);
        expect(listener.mock.calls.every(([affects]) => affects("opencode"))).toBe(true);
      });

      it(`tells only the backend of a chat that listed no tools of a custom connector that couldn't start, once it starts in a later chat: ${CUSTOM_ISSUE}`, async () => {
        const fake = setUp();
        fake.addCustom(JSON.stringify({ name: "Echo", command: "echo" }));
        await fake.tools.refresh();
        expect(fake.custom.getSnapshot().connectors[0].status.kind).toBe("couldnt-start");
        fake.tools.tools({ sessionKey: "chat-a", backendId: "codex" });
        const listener = jest.fn();
        fake.tools.subscribeToToolSetChange(listener);
        process.env.FAKE_KEY = "from-shell";

        try {
          await fake.tools.refresh();
        } finally {
          delete process.env.FAKE_KEY;
        }

        expect(fake.custom.getSnapshot().connectors[0].status.kind).toBe("connected");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]("codex")).toBe(true);
        expect(listener.mock.calls[0][0]("claude")).toBe(false);
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

  describe("describeConnectorTool()", () => {
    it(`${ISSUE} names the service and the service's own tool for a name agents see, even one shortened with a hash`, async () => {
      const fake = setUp({ connections: [{ id: "c-atlassian", serviceId: "atlassian" }] });
      fake.atlassian.tools = [
        { name: "getConfluencePageDescendantsWithReplies" },
        { name: "getConfluencePageDescendantsWithLabels" },
      ];
      await fake.tools.refresh();
      const [replies, labels] = fake.tools.tools().map(({ name }) => name);

      expect(describeConnectorTool(replies)).toEqual({
        serviceName: "Atlassian",
        toolName: "getConfluencePageDescendantsWithReplies",
      });
      expect(describeConnectorTool(labels)).toEqual({
        serviceName: "Atlassian",
        toolName: "getConfluencePageDescendantsWithLabels",
      });
    });

    it(`${ISSUE} names a catalog service's tool that no chat has listed since Obsidian started, as in a restored chat`, () => {
      expect(describeConnectorTool("notion_search_pages")).toEqual({
        serviceName: "Notion",
        toolName: "search_pages",
      });
    });

    it.each(["send_feedback", "suggest_connector", "miyo_search", "notion"])(
      "returns null for %s, which names no catalog service's tool",
      (name) => {
        expect(describeConnectorTool(name)).toBeNull();
      }
    );
  });
});
