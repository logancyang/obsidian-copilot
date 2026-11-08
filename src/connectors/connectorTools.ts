import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import type { ConnectionManager, ConnectionState } from "@/connectors/connectionManager";
import { maskSecretValues } from "@/connectors/maskSecretValues";
import type { AccessTokenResult } from "@/connectors/oauth/connectorAuth";
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

interface ConnectorToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

export interface ConnectorToolResult {
  content: readonly unknown[];
  isError: boolean;
}

const EMPTY_TOOLS: readonly ConnectorToolDefinition[] = Object.freeze([]);

interface ServiceToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: ConnectorToolDefinition["annotations"];
}

interface LoadedService {
  readonly connectionId: string;
  readonly service: ConnectorCatalogEntry;
  readonly session: ServiceSession;
  readonly toolNames: ReadonlyMap<string, string>;
  readonly definitions: readonly ConnectorToolDefinition[];
}

interface JsonRpcReply {
  id?: unknown;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export interface ConnectorToolsDeps {
  manager: Pick<ConnectionManager, "getSnapshot" | "subscribe" | "accessToken" | "reportFailure">;
  catalog: readonly ConnectorCatalogEntry[];
  isEnabled: () => boolean;
  subscribeToEnabledChange: (listener: () => void) => () => void;
  maxToolNameLength: number;
  fetch?: FetchLike;
}

class NeedsLoginError extends Error {}

class SessionEndedError extends Error {}

export class ConnectorTools {
  private readonly services: ReadonlyMap<string, ConnectorCatalogEntry>;
  private readonly loaded = new Map<string, LoadedService>();
  private readonly listings = new Map<string, { backendId: string; ids: ReadonlySet<string> }>();

  constructor(private readonly deps: ConnectorToolsDeps) {
    this.services = new Map(deps.catalog.map((service) => [service.id, service]));
  }

  async refresh(): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const { connections } = this.deps.manager.getSnapshot();
    for (const id of this.loaded.keys()) {
      if (!connections.some((connection) => connection.id === id)) this.loaded.delete(id);
    }
    await Promise.all(connections.map((connection) => this.load(connection)));
  }

  tools(listedBy?: { sessionKey: string; backendId: string }): readonly ConnectorToolDefinition[] {
    const listed = this.deps.isEnabled()
      ? this.deps.manager
          .getSnapshot()
          .connections.filter(({ status }) => status === "connected")
          .flatMap(({ id }) => this.loaded.get(id) ?? [])
      : [];
    if (listedBy) {
      const ids = new Set(listed.map(({ connectionId }) => connectionId));
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
    return loaded ? this.forward(loaded, loaded.toolNames.get(name) ?? name, args) : null;
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
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  private toolSet(): { connectionIds: string; connected: ReadonlySet<string> } {
    const connections = this.deps.isEnabled() ? this.deps.manager.getSnapshot().connections : [];
    return {
      connectionIds: connections.map(({ id }) => id).join("\n"),
      connected: new Set(
        connections.filter(({ status }) => status === "connected").map(({ id }) => id)
      ),
    };
  }

  private async load(connection: ConnectionState): Promise<void> {
    const service = this.services.get(connection.serviceId);
    if (!service) return;
    const session = new ServiceSession(
      service.serverUrl,
      (forceRefresh) => this.deps.manager.accessToken(connection.id, { forceRefresh }),
      this.deps.fetch ?? nodeFetch
    );
    try {
      // A service or login server that never answers would otherwise hold every new chat at its start, or keep the healthy services' tools from it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
      const tools = await withTimeout(
        async () => {
          const { status } = await this.deps.manager.accessToken(connection.id);
          return status === "connected" && !this.loaded.has(connection.id)
            ? listTools(session)
            : null;
        },
        SERVICE_TIMEOUT_MS,
        `Loading ${service.name} tools`
      );
      if (!tools) return;
      const definitions = tools.map((tool) =>
        toDefinition(service, tool, this.deps.maxToolNameLength)
      );
      this.loaded.set(connection.id, {
        connectionId: connection.id,
        service,
        session,
        toolNames: new Map(definitions.map((definition, i) => [definition.name, tools[i].name])),
        definitions,
      });
    } catch (error) {
      logWarn(
        `[Connectors] Couldn't load ${service.name} tools`,
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
        return toolText(
          `${name} needs a new login because the login expired or was revoked, which isn't a Copilot failure. Tell the user to reconnect ${name} in Settings → Connectors, then try again.`,
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

class ServiceSession {
  private sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private initialized: Promise<void> | null = null;
  private nextId = 0;
  private readonly sentTokens = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly accessToken: (forceRefresh: boolean) => Promise<AccessTokenResult>,
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

  // A service's error body can echo the request, bearer token included, into the log or the agent's chat.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/857
  mask(text: string): string {
    return maskSecretValues(text, [...this.sentTokens]);
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      this.sessionId = null;
      const result = await this.send("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Copilot for Obsidian", version: "1.0.0" },
      });
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
    if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    return id === undefined ? {} : readReply(response, id);
  }

  private async post(body: string, forceRefresh: boolean): Promise<Response> {
    const token = await this.accessToken(forceRefresh);
    if (token.status === "needs-login") throw new NeedsLoginError();
    if (token.status === "unreachable") throw new ServiceUnreachableError(this.url, token);
    this.sentTokens.add(token.accessToken);
    return this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token.accessToken}`,
        "mcp-protocol-version": this.protocolVersion,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body,
    });
  }
}

async function listTools(session: ServiceSession): Promise<ServiceToolInfo[]> {
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

function toDefinition(
  service: ConnectorCatalogEntry,
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

function toToolResult(result: Record<string, unknown>): ConnectorToolResult {
  return {
    content:
      Array.isArray(result.content) && result.content.length > 0
        ? (result.content as unknown[])
        : [{ type: "text", text: JSON.stringify(result.structuredContent ?? {}) }],
    isError: result.isError === true,
  };
}

function toolText(text: string, isError = true): ConnectorToolResult {
  return { content: [{ type: "text", text }], isError };
}
