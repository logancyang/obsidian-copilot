import {
  defineTools,
  HttpStatusError,
  toToolResult,
  listTools,
  NeedsLoginError,
  ServiceSession,
  TOOL_CALL_OPTIONS,
  toolText,
  type ConnectorToolDefinition,
  type ConnectorToolResult,
  type ListedTools,
  type McpRequester,
} from "@/connectors/connectorTools";
import {
  parseCustomConnectors,
  type CustomConnectorConfig,
  type CustomConnectorParse,
  type ParsedCustomConnector,
} from "@/connectors/custom/customConnectorConfig";
import {
  START_TIMEOUT_MS,
  StdioServer,
  type StdioServerOptions,
} from "@/connectors/custom/stdioServer";
import { maskSecretValues } from "@/connectors/maskSecretValues";
import { nodeFetch } from "@/connectors/nodeFetch";
import { ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import { err2String } from "@/errorFormat";
import { logWarn } from "@/logger";
import type { KeychainService } from "@/services/keychainService";
import { getSettings, updateSetting } from "@/settings/model";
import { withTimeout } from "@/utils";
import { augmentPathForDetection } from "@/utils/binaryPath";
import { loginShellPathDirs } from "@/utils/loginShellPath";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export type CustomConnectorStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "connected"; readonly toolCount: number }
  | { readonly kind: "couldnt-start"; readonly reason: string }
  | { readonly kind: "unreachable"; readonly reason: string }
  | { readonly kind: "key-not-accepted" }
  | { readonly kind: "needs-key" }
  | { readonly kind: "off" };

export interface CustomConnectorState {
  readonly config: CustomConnectorConfig;
  readonly status: CustomConnectorStatus;
}

export interface CustomConnectorsSnapshot {
  readonly connectors: readonly CustomConnectorState[];
  readonly needsAttention: boolean;
}

export interface CustomServerProcess extends McpRequester {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CustomConnectorsDeps {
  keychain: Pick<
    KeychainService,
    "getVaultId" | "getSecretById" | "setSecretById" | "deleteSecretById"
  >;
  deviceStorage: { load(key: string): unknown; save(key: string, value: unknown): void };
  catalogIds: readonly string[];
  isEnabled: () => boolean;
  maxToolNameLength: number;
  cwd?: string;
  fetch?: FetchLike;
  startProcess?: (
    options: StdioServerOptions,
    onCrash: (reason: string) => void
  ) => CustomServerProcess;
}

interface Run {
  readonly config: CustomConnectorConfig;
  readonly restarts: number;
  status: CustomConnectorStatus;
  started: Promise<void>;
  session: McpRequester | null;
  process: CustomServerProcess | null;
  tools: ListedTools | null;
  restartTimer?: number;
}

// Turning a connector off is a choice for one device, so it lives in this vault's local storage on that device rather than in synced settings.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/862
const OFF_STORAGE_KEY = "copilot-custom-connectors-off";
const CHAT_WAIT_MS = 10_000;
const RESTART_DELAY_MS = 1_000;
const MAX_RESTARTS = 3;
const IDLE: CustomConnectorStatus = Object.freeze({ kind: "idle" });
const STARTING: CustomConnectorStatus = Object.freeze({ kind: "starting" });
const KEY_NOT_ACCEPTED: CustomConnectorStatus = Object.freeze({ kind: "key-not-accepted" });
const NEEDS_KEY: CustomConnectorStatus = Object.freeze({ kind: "needs-key" });
const OFF: CustomConnectorStatus = Object.freeze({ kind: "off" });
const ATTENTION_KINDS: ReadonlySet<CustomConnectorStatus["kind"]> = new Set([
  "couldnt-start",
  "key-not-accepted",
  "needs-key",
]);
const EMPTY_CUSTOM_CONNECTORS: readonly CustomConnectorState[] = Object.freeze([]);

export class CustomConnectors {
  private readonly runs = new Map<string, Run>();
  private readonly listeners = new Set<() => void>();
  private snapshot: CustomConnectorsSnapshot;

  constructor(private readonly deps: CustomConnectorsDeps) {
    this.snapshot = this.buildSnapshot();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): CustomConnectorsSnapshot => this.snapshot;

  parse(text: string): CustomConnectorParse {
    const taken = [...this.deps.catalogIds, ...configs().map(({ id }) => id)];
    return parseCustomConnectors(text, new Set(taken));
  }

  add(connectors: readonly ParsedCustomConnector[]): void {
    for (const { config, secrets } of connectors) this.saveSecrets(config.id, secrets);
    updateSetting("customConnectors", [...configs(), ...connectors.map(({ config }) => config)]);
    this.publish();
    for (const { config } of connectors) this.startIfRunnable(config.id);
  }

  edit(id: string, text: string): CustomConnectorParse {
    const parsed = parseCustomConnectors(text, new Set());
    if (!parsed.ok) return parsed;
    if (parsed.connectors.length !== 1) {
      return { ok: false, error: "Paste one server to edit this connector." };
    }
    const [{ config, secrets }] = parsed.connectors;
    const edited = { ...config, id };
    const stored = this.secretsOf(id);
    // Edit shows each value blank because values never leave the keychain, so a value left blank keeps the stored one.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    this.saveSecrets(
      id,
      Object.fromEntries(secretNames(edited).map((name) => [name, secrets[name] || stored[name]]))
    );
    updateSetting(
      "customConnectors",
      configs().map((existing) => (existing.id === id ? edited : existing))
    );
    this.restart(id);
    return { ok: true, connectors: [{ config: edited, secrets }] };
  }

  remove(id: string): void {
    this.stopRun(id);
    this.deps.keychain.deleteSecretById(this.keychainId(id));
    this.saveOffIds([...this.offIds()].filter((offId) => offId !== id));
    updateSetting(
      "customConnectors",
      configs().filter((config) => config.id !== id)
    );
    this.publish();
  }

  setTurnedOff(id: string, off: boolean): void {
    const offIds = this.offIds();
    if (off) offIds.add(id);
    else offIds.delete(id);
    this.saveOffIds([...offIds]);
    this.restart(id);
  }

  async refresh(): Promise<void> {
    this.publish();
    const runnable = this.runnableConfigs();
    // Obsidian's Keychain settings can delete a value while its server runs, and that server must not keep serving tools.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    for (const id of [...this.runs.keys()]) {
      if (!runnable.some((config) => config.id === id)) this.stopRun(id);
    }
    await Promise.all(
      runnable.map((config) => {
        const run = this.runs.get(config.id);
        const started =
          run?.status.kind === "starting" || run?.status.kind === "connected"
            ? run.started
            : this.start(config);
        // A server still starting, for example while npx downloads it, would otherwise hold the new chat at its start.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
        return withTimeout(() => started, CHAT_WAIT_MS, `Starting ${config.name}`).catch(() => {});
      })
    );
  }

  listed(): readonly { id: string; definitions: readonly ConnectorToolDefinition[] }[] {
    return [...this.runs.values()].flatMap(({ config, status, tools }) =>
      status.kind === "connected" && tools
        ? [{ id: config.id, definitions: tools.definitions }]
        : []
    );
  }

  call(name: string, args: unknown): Promise<ConnectorToolResult> | null {
    const run = [...this.runs.values()].find(({ tools }) => tools?.toolNames.has(name));
    const toolName = run?.tools?.toolNames.get(name);
    return run && toolName ? this.forward(run, toolName, args) : null;
  }

  dispose(): void {
    for (const id of [...this.runs.keys()]) this.stopRun(id);
    this.listeners.clear();
  }

  private start(config: CustomConnectorConfig, previous?: Run): Promise<void> {
    const run: Run = {
      config,
      restarts: previous ? previous.restarts + 1 : 0,
      status: STARTING,
      started: Promise.resolve(),
      session: null,
      process: null,
      tools: previous?.tools ?? null,
    };
    this.runs.set(config.id, run);
    run.started = withTimeout(() => this.open(run), START_TIMEOUT_MS, `Starting ${config.name}`)
      .then((tools) => {
        run.tools = tools;
        this.setRunStatus(run, { kind: "connected", toolCount: tools.definitions.length });
      })
      .catch((error: unknown) => {
        logWarn(
          `[Connectors] Couldn't start ${config.name}`,
          this.masked(config.id, err2String(error, true))
        );
        void run.process?.stop();
        if (run.session instanceof ServiceSession) void run.session.close();
        run.session = null;
        const reason = this.masked(
          config.id,
          error instanceof Error ? error.message : String(error)
        );
        this.setRunStatus(run, failureStatus(config, error, reason));
      });
    this.publish();
    return run.started;
  }

  private async open(run: Run): Promise<ListedTools> {
    const { config } = run;
    const loginDirs = "command" in config ? await loginShellPathDirs() : [];
    if (this.runs.get(config.id) !== run) throw new Error(`${config.name} was stopped.`);
    const secrets = this.secretsOf(config.id);
    if ("command" in config) {
      const startProcess =
        this.deps.startProcess ?? ((options, onCrash) => new StdioServer(options, onCrash));
      const server = startProcess(
        {
          command: config.command,
          args: config.args,
          cwd: this.deps.cwd,
          // Obsidian opened from the Dock has no shell PATH, so npx and uvx resolve the way they do for agent CLIs.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
          env: {
            ...process.env,
            PATH: augmentPathForDetection(loginDirs, process.env.PATH),
            ...pick(secrets, config.envNames),
          },
        },
        (reason) => this.onCrash(run, reason)
      );
      run.process = server;
      await server.start();
      run.session = server;
    } else {
      const headers = pick(secrets, config.headerNames);
      run.session = new ServiceSession(
        config.url,
        async () => headers,
        this.deps.fetch ?? nodeFetch
      );
    }
    return defineTools(config, await listTools(run.session), this.deps.maxToolNameLength);
  }

  private onCrash(run: Run, stderrReason: string): void {
    const reason = this.masked(run.config.id, stderrReason);
    logWarn(`[Connectors] ${run.config.name} stopped: ${reason}`);
    run.session = null;
    // A server that keeps crashing would otherwise restart forever.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    if (run.restarts >= MAX_RESTARTS) {
      this.setRunStatus(run, { kind: "couldnt-start", reason });
      return;
    }
    this.setRunStatus(run, STARTING);
    run.restartTimer = window.setTimeout(
      () => {
        if (this.runs.get(run.config.id) === run) void this.start(run.config, run);
      },
      RESTART_DELAY_MS * 2 ** run.restarts
    );
  }

  private async forward(run: Run, toolName: string, args: unknown): Promise<ConnectorToolResult> {
    const { name } = run.config;
    if (!run.session) return toolText(`${name} isn't running right now. Try again in a moment.`);
    try {
      const result = await run.session.request(
        "tools/call",
        { name: toolName, arguments: args ?? {} },
        // A custom server's tool can run as long as a catalog service's, which outlasts the SDK's 60-second default.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
        TOOL_CALL_OPTIONS
      );
      const toolResult = toToolResult(result);
      if (!toolResult.isError) return toolResult;
      // MCP servers report a failed tool as a result marked isError, and its text can echo the key like a thrown error's.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
      return {
        isError: true,
        content: toolResult.content.map((item) => {
          const { text } = item as { text?: unknown };
          return typeof text === "string"
            ? { ...(item as object), text: this.masked(run.config.id, text) }
            : item;
        }),
      };
    } catch (error) {
      if (isKeyRejection(error)) {
        this.setRunStatus(run, KEY_NOT_ACCEPTED);
        // Agents offer a Copilot bug report for an obsidian-copilot tool that fails, but a rejected key only needs the user to update it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
        return toolText(
          `${name} didn't accept its API key, which isn't a Copilot failure. The user can update the key in Settings → Connectors.`,
          false
        );
      }
      if (error instanceof ServiceUnreachableError) {
        this.setRunStatus(run, { kind: "unreachable", reason: error.message });
        return toolText(`Couldn't reach ${name}, which isn't a Copilot failure. Try again later.`);
      }
      const message = error instanceof Error ? error.message : String(error);
      return toolText(`${name} returned an error: ${this.masked(run.config.id, message)}`);
    }
  }

  private restart(id: string): void {
    this.stopRun(id);
    this.publish();
    this.startIfRunnable(id);
  }

  private startIfRunnable(id: string): void {
    if (!this.deps.isEnabled()) return;
    const config = this.runnableConfigs().find((runnable) => runnable.id === id);
    if (config) void this.start(config);
  }

  private stopRun(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    this.runs.delete(id);
    window.clearTimeout(run.restartTimer);
    void run.process?.stop();
    if (run.session instanceof ServiceSession) void run.session.close();
  }

  private setRunStatus(run: Run, status: CustomConnectorStatus): void {
    if (this.runs.get(run.config.id) !== run) return;
    run.status = status;
    this.publish();
  }

  private runnableConfigs(): CustomConnectorConfig[] {
    return this.snapshot.connectors
      .filter(({ status }) => status.kind !== "off" && status.kind !== "needs-key")
      .map(({ config }) => config);
  }

  private keychainId(id: string): string {
    return `copilot-v${this.deps.keychain.getVaultId()}-custom-connector-${id}`;
  }

  private secretsOf(id: string): Record<string, string> {
    try {
      const raw = this.deps.keychain.getSecretById(this.keychainId(id));
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      // A JSON parse error quotes the start of the unreadable entry, which can be a key.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
      logWarn(`[Connectors] Couldn't read the keychain values of ${id}`);
      return {};
    }
  }

  // Servers can echo their keys in errors and stderr, which reach the agent's chat and Copilot's log, and the log goes into bug reports.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
  private masked(id: string, text: string): string {
    return maskSecretValues(text, Object.values(this.secretsOf(id)));
  }

  private saveSecrets(id: string, secrets: Readonly<Record<string, string>>): void {
    const filled = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
    if (Object.keys(filled).length === 0) this.deps.keychain.deleteSecretById(this.keychainId(id));
    else this.deps.keychain.setSecretById(this.keychainId(id), JSON.stringify(filled));
  }

  private offIds(): Set<string> {
    const stored = this.deps.deviceStorage.load(OFF_STORAGE_KEY);
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
  }

  private saveOffIds(ids: readonly string[]): void {
    this.deps.deviceStorage.save(OFF_STORAGE_KEY, ids);
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): CustomConnectorsSnapshot {
    const offIds = this.offIds();
    const connectors = configs().map((config) => {
      const secrets = this.secretsOf(config.id);
      const status = offIds.has(config.id)
        ? OFF
        : secretNames(config).some((name) => !secrets[name])
          ? NEEDS_KEY
          : (this.runs.get(config.id)?.status ?? IDLE);
      return Object.freeze({ config, status });
    });
    return Object.freeze({
      connectors: connectors.length > 0 ? Object.freeze(connectors) : EMPTY_CUSTOM_CONNECTORS,
      needsAttention: connectors.some(({ status }) => ATTENTION_KINDS.has(status.kind)),
    });
  }
}

function configs(): readonly CustomConnectorConfig[] {
  return getSettings().customConnectors;
}

function secretNames(config: CustomConnectorConfig): readonly string[] {
  return "command" in config ? config.envNames : config.headerNames;
}

function pick(values: Record<string, string>, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.flatMap((name) => (values[name] ? [[name, values[name]]] : [])));
}

function isKeyRejection(error: unknown): boolean {
  return (
    error instanceof NeedsLoginError || (error instanceof HttpStatusError && error.status === 403)
  );
}

function failureStatus(
  config: CustomConnectorConfig,
  error: unknown,
  reason: string
): CustomConnectorStatus {
  if ("command" in config) return { kind: "couldnt-start", reason };
  return isKeyRejection(error) ? KEY_NOT_ACCEPTED : { kind: "unreachable", reason };
}
