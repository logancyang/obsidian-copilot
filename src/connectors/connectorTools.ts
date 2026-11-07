import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from "@/connectors/catalog";
import type { ConnectionManager, ConnectionState } from "@/connectors/connectionManager";
import { SUGGEST_CONNECTOR_TOOL_NAME } from "@/connectors/connectorCards";
import type { CustomConnectors } from "@/connectors/custom/customConnectors";
import { maskSecretValues } from "@/connectors/maskSecretValues";
import { nodeFetch } from "@/connectors/nodeFetch";
import { ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import { err2String } from "@/errorFormat";
import { logWarn } from "@/logger";
import { withTimeout } from "@/utils";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const NAME_HASH_LENGTH = 8;
const SERVICE_TIMEOUT_MS = 10_000;

export const MCP_INITIALIZE_PARAMS = Object.freeze({
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "Copilot for Obsidian", version: "1.0.0" },
});

export interface ConnectorToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: { readonly title?: string; readonly readOnlyHint?: boolean };
}

export interface ConnectorToolResult {
  content: readonly unknown[];
  isError: boolean;
}

const EMPTY_TOOLS: readonly ConnectorToolDefinition[] = Object.freeze([]);

export interface ConnectorToolDescription {
  readonly serviceName: string;
  readonly toolName: string;
}

// A name shortened to fit agents' length cap can't be read back, so the chat looks up the names Copilot listed, and reads a restored chat's not-yet-listed name by its catalog prefix.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
const listedToolNames = new Map<string, ConnectorToolDescription>();

export function describeConnectorTool(agentName: string): ConnectorToolDescription | null {
  const listed = listedToolNames.get(agentName);
  if (listed) return listed;
  const service = CONNECTOR_CATALOG.find(({ id }) => agentName.startsWith(`${id}_`));
  return service
    ? { serviceName: service.name, toolName: agentName.slice(service.id.length + 1) }
    : null;
}

export interface ServiceToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: ConnectorToolDefinition["annotations"];
}

export interface McpRequester {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ListedTools {
  readonly toolNames: ReadonlyMap<string, string>;
  readonly definitions: readonly ConnectorToolDefinition[];
  readonly tools: readonly ServiceToolInfo[];
}

interface LoadedService extends ListedTools {
  readonly connectionId: string;
  readonly service: ConnectorCatalogEntry;
  readonly session: ServiceSession;
}

interface JsonRpcReply {
  id?: unknown;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export interface ConnectorToolsDeps {
  manager: Pick<
    ConnectionManager,
    "getSnapshot" | "subscribe" | "checkStatus" | "accessToken" | "reportFailure"
  >;
  catalog: readonly ConnectorCatalogEntry[];
  isEnabled: () => boolean;
  subscribeToEnabledChange: (listener: () => void) => () => void;
  maxToolNameLength: number;
  fetch?: FetchLike;
  custom?: Pick<CustomConnectors, "subscribe" | "getSnapshot" | "refresh" | "listed" | "call">;
}

export class NeedsLoginError extends Error {}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`HTTP ${status} ${body}`);
  }
}

class SessionEndedError extends Error {}

export class ConnectorTools {
  private readonly services: ReadonlyMap<string, ConnectorCatalogEntry>;
  private readonly loaded = new Map<string, LoadedService>();
  private readonly listings = new Map<string, { backendId: string; ids: ReadonlySet<string> }>();
  private readonly listeners = new Set<() => void>();
  private toolsByConnection: ReadonlyMap<string, readonly ServiceToolInfo[]> = new Map();

  constructor(private readonly deps: ConnectorToolsDeps) {
    this.services = new Map(deps.catalog.map((service) => [service.id, service]));
  }

  async refresh(): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const custom = this.deps.custom?.refresh();
    // A service that never answers would otherwise hold every new chat at its start.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
    await withTimeout(
      () => this.deps.manager.checkStatus(),
      SERVICE_TIMEOUT_MS,
      "Checking connector logins"
    );
    await Promise.all([this.loadConnected(), custom]);
  }

  // Settings counts each connected service's tools, which nothing lists before a chat starts.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/878
  async loadConnected(): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const { connections } = this.deps.manager.getSnapshot();
    const gone = [...this.loaded.keys()].filter((id) => !connections.some((c) => c.id === id));
    if (gone.length > 0) this.updateLoaded(() => gone.forEach((id) => this.loaded.delete(id)));
    await Promise.all(
      connections
        .filter(({ id, status }) => status === "connected" && !this.loaded.has(id))
        .map((connection) => this.load(connection))
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReadonlyMap<string, readonly ServiceToolInfo[]> =>
    this.toolsByConnection;

  // A stored login can be valid while the service is down, so only a real tool listing shows it is reachable again.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/858
  async checkAgain(connectionId: string): Promise<void> {
    const connection = this.deps.manager
      .getSnapshot()
      .connections.find(({ id }) => id === connectionId);
    if (!connection) return;
    this.updateLoaded(() => this.loaded.delete(connectionId));
    await this.load(connection);
  }

  tools(listedBy?: { sessionKey: string; backendId: string }): readonly ConnectorToolDefinition[] {
    const listed = this.deps.isEnabled()
      ? [
          ...this.deps.manager
            .getSnapshot()
            .connections.filter(({ status }) => status === "connected")
            .flatMap(({ id }) => {
              const loaded = this.loaded.get(id);
              return loaded ? [{ id, definitions: loaded.definitions }] : [];
            }),
          ...(this.deps.custom?.listed() ?? []),
        ]
      : [];
    if (listedBy) {
      const ids = new Set(listed.map(({ id }) => id));
      this.listings.set(listedBy.sessionKey, { backendId: listedBy.backendId, ids });
    }
    const definitions = listed.flatMap(({ definitions }) => definitions);
    return definitions.length > 0 ? definitions : EMPTY_TOOLS;
  }

  forget(sessionKey: string): void {
    this.listings.delete(sessionKey);
  }

  call(name: string, args: unknown): Promise<ConnectorToolResult> | null {
    if (!this.deps.isEnabled()) return null;
    const loaded = this.deps.manager
      .getSnapshot()
      .connections.map(({ id }) => this.loaded.get(id))
      .find((entry) => entry?.toolNames.has(name));
    if (loaded) return this.forward(loaded, loaded.toolNames.get(name) ?? name, args);
    return this.deps.custom?.call(name, args) ?? null;
  }

  subscribeToToolSetChange(
    listener: (affectsBackend: (backendId: string) => boolean) => void
  ): () => void {
    let last = this.toolSet();
    const onChange = (): void => {
      const next = this.toolSet();
      const gained = [...next.connected].filter((id) => !last.connected.has(id));
      const idsChanged = next.connectionIds !== last.connectionIds;
      last = next;
      if (idsChanged) return listener(() => true);
      // A chat that started while a service needed a login never listed its tools, so that service logging in again needs a Reload where some chat didn't list it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
      const lacking = new Set(
        [...this.listings.values()]
          .filter(({ ids }) => gained.some((id) => !ids.has(id)))
          .map(({ backendId }) => backendId)
      );
      if (lacking.size > 0) listener((backendId) => lacking.has(backendId));
    };
    const unsubscribers = [
      this.deps.manager.subscribe(onChange),
      this.deps.subscribeToEnabledChange(onChange),
      ...(this.deps.custom ? [this.deps.custom.subscribe(onChange)] : []),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  private updateLoaded(update: () => void): void {
    update();
    this.toolsByConnection = new Map([...this.loaded].map(([id, { tools }]) => [id, tools]));
    this.listeners.forEach((listener) => listener());
  }

  private toolSet(): { connectionIds: string; connected: ReadonlySet<string> } {
    const enabled = this.deps.isEnabled();
    const connections = enabled ? this.deps.manager.getSnapshot().connections : [];
    const custom = (enabled && this.deps.custom?.getSnapshot().connectors) || [];
    // A custom connector's tools come and go with its config, its keys on this device and its turned-off switch, all of which open chats only pick up through Reload.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    const runnable = custom.filter(
      ({ status }) => status.kind !== "off" && status.kind !== "needs-key"
    );
    return {
      connectionIds: [
        ...connections.map(({ id }) => id),
        ...runnable.map(({ config }) => JSON.stringify(config)),
      ].join("\n"),
      connected: new Set([
        ...connections.filter(({ status }) => status === "connected").map(({ id }) => id),
        ...custom
          .filter(({ status }) => status.kind === "connected")
          .map(({ config }) => config.id),
      ]),
    };
  }

  private async load(connection: ConnectionState): Promise<void> {
    const service = this.services.get(connection.serviceId);
    if (!service) return;
    const session = new ServiceSession(
      service.serverUrl,
      async (forceRefresh) => {
        const token = await this.deps.manager.accessToken(connection.id, { forceRefresh });
        if (token.status === "needs-login") throw new NeedsLoginError();
        if (token.status === "unreachable") {
          throw new ServiceUnreachableError(service.serverUrl, token);
        }
        return { authorization: `Bearer ${token.accessToken}` };
      },
      this.deps.fetch ?? nodeFetch
    );
    try {
      const tools = await withTimeout(
        () => listTools(session),
        SERVICE_TIMEOUT_MS,
        `Listing ${service.name} tools`
      );
      const listed = defineTools(service, tools, this.deps.maxToolNameLength);
      this.updateLoaded(() =>
        this.loaded.set(connection.id, { connectionId: connection.id, service, session, ...listed })
      );
    } catch (error) {
      logWarn(
        `[Connectors] Couldn't list ${service.name} tools`,
        session.mask(err2String(error, true))
      );
      this.deps.manager.reportFailure(
        connection.id,
        error instanceof NeedsLoginError ? "needs-login" : "unreachable"
      );
    }
  }

  private async forward(
    loaded: LoadedService,
    toolName: string,
    args: unknown
  ): Promise<ConnectorToolResult> {
    const { name } = loaded.service;
    try {
      const result = await loaded.session.request("tools/call", {
        name: toolName,
        arguments: args ?? {},
      });
      return toToolResult(result);
    } catch (error) {
      if (error instanceof NeedsLoginError) {
        this.deps.manager.reportFailure(loaded.connectionId, "needs-login");
        // Agents offer a Copilot bug report for an obsidian-copilot tool that fails, or stops working mid-chat even without isError, but an expired login only needs the user to reconnect.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
        // The agent raises the Reconnect card itself, so the card lands in the chat that hit the failure.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/860
        return toolText(
          `${name} needs a new login because the login expired or was revoked, which isn't a Copilot failure. Call ${SUGGEST_CONNECTOR_TOOL_NAME} with service "${loaded.service.id}" so the user can reconnect it.`,
          false
        );
      }
      if (error instanceof ServiceUnreachableError) {
        this.deps.manager.reportFailure(loaded.connectionId, "unreachable");
        return toolText(`Couldn't reach ${name}, which isn't a Copilot failure. Try again later.`);
      }
      const message = error instanceof Error ? error.message : String(error);
      return toolText(`${name} returned an error: ${loaded.session.mask(message)}`);
    }
  }
}

export class ServiceSession implements McpRequester {
  private sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private initialized: Promise<void> | null = null;
  private nextId = 0;
  private readonly sentAuthValues = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly authHeaders: (forceRefresh: boolean) => Promise<Record<string, string>>,
    private readonly fetch: FetchLike
  ) {}

  async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      await this.initialize();
      return await this.send(method, params);
    } catch (error) {
      // A service may end its MCP session at any time, and the protocol has the client start a new one.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
      if (!(error instanceof SessionEndedError)) throw error;
      this.initialized = null;
      await this.initialize();
      return this.send(method, params);
    }
  }

  // A service's error body can echo the request, auth header values included, into the log or the agent's chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
  mask(text: string): string {
    return maskSecretValues(text, [...this.sentAuthValues]);
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      this.sessionId = null;
      const result = await this.send("initialize", MCP_INITIALIZE_PARAMS);
      if (typeof result.protocolVersion === "string") this.protocolVersion = result.protocolVersion;
      await this.send("notifications/initialized");
    })().catch((error: unknown) => {
      this.initialized = null;
      throw error;
    });
    return this.initialized;
  }

  private async send(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const id = method.startsWith("notifications/") ? undefined : ++this.nextId;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    let response = await this.post(body, false);
    // A service can revoke a token before its stated expiry, so a 401 earns one refreshed token.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
    if (response.status === 401) response = await this.post(body, true);
    if (response.status === 401) throw new NeedsLoginError();
    if (response.status === 404 && this.sessionId) throw new SessionEndedError();
    if (response.status >= 500) {
      throw new ServiceUnreachableError(this.url, new Error(`HTTP ${response.status}`));
    }
    if (!response.ok) throw new HttpStatusError(response.status, await response.text());
    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    return id === undefined ? {} : readReply(response, id);
  }

  private async post(body: string, forceRefresh: boolean): Promise<Response> {
    const authHeaders = await this.authHeaders(forceRefresh);
    Object.values(authHeaders).forEach((value) => this.sentAuthValues.add(value));
    return this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...authHeaders,
        "mcp-protocol-version": this.protocolVersion,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body,
    });
  }
}

export async function listTools(session: McpRequester): Promise<ServiceToolInfo[]> {
  const tools: ServiceToolInfo[] = [];
  let cursor: unknown;
  do {
    const page = await session.request("tools/list", cursor === undefined ? {} : { cursor });
    tools.push(...((page.tools as ServiceToolInfo[] | undefined) ?? []));
    cursor = page.nextCursor;
  } while (typeof cursor === "string");
  return tools;
}

async function readReply(response: Response, id: number): Promise<Record<string, unknown>> {
  const reply = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? await readStreamedReply(response, id)
    : findReply(JSON.parse(await response.text()) as JsonRpcReply | JsonRpcReply[], id);
  if (!reply) throw new Error("The service sent no reply.");
  if (reply.error) throw new Error(reply.error.message ?? "Unknown error");
  return reply.result ?? {};
}

// A service may keep a reply's event stream open after the reply, so events are read as they arrive.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/857
async function readStreamedReply(
  response: Response,
  id: number
): Promise<JsonRpcReply | undefined> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : (events.pop() ?? "");
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        const reply = data
          ? findReply(JSON.parse(data) as JsonRpcReply | JsonRpcReply[], id)
          : undefined;
        if (reply) return reply;
      }
      if (done) return undefined;
    }
  } finally {
    void reader.cancel();
  }
}

function findReply(message: JsonRpcReply | JsonRpcReply[], id: number): JsonRpcReply | undefined {
  return [message].flat().find((candidate) => candidate.id === id);
}

export function defineTools(
  service: { readonly id: string; readonly name: string },
  tools: readonly ServiceToolInfo[],
  maxNameLength: number
): ListedTools {
  const definitions = tools.map((tool) => toDefinition(service, tool, maxNameLength));
  definitions.forEach(({ name }, i) =>
    listedToolNames.set(name, { serviceName: service.name, toolName: tools[i].name })
  );
  return {
    toolNames: new Map(definitions.map((definition, i) => [definition.name, tools[i].name])),
    definitions,
    tools,
  };
}

function toDefinition(
  service: { readonly id: string; readonly name: string },
  tool: ServiceToolInfo,
  maxNameLength: number
): ConnectorToolDefinition {
  return {
    name: agentToolName(`${service.id}_${tool.name}`, maxNameLength),
    description: tool.description ? `${service.name}: ${tool.description}` : service.name,
    inputSchema: tool.inputSchema ?? { type: "object" },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

function agentToolName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  const hash = requireNodeModule<typeof import("node:crypto")>("crypto")
    .createHash("sha256")
    .update(name)
    .digest("hex")
    .slice(0, NAME_HASH_LENGTH);
  return `${name.slice(0, maxLength - NAME_HASH_LENGTH - 1)}_${hash}`;
}

export function toToolResult(result: Record<string, unknown>): ConnectorToolResult {
  return {
    content:
      Array.isArray(result.content) && result.content.length > 0
        ? (result.content as unknown[])
        : [{ type: "text", text: JSON.stringify(result.structuredContent ?? {}) }],
    isError: result.isError === true,
  };
}

export function toolText(text: string, isError = true): ConnectorToolResult {
  return { content: [{ type: "text", text }], isError };
}
