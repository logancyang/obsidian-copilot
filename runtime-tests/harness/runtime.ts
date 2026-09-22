import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { App as ObsidianApp } from "obsidian";

import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import { OpencodeBackend } from "@/agentMode/backends/opencode/OpencodeBackend";
import { OpencodeBackendDescriptor } from "@/agentMode/backends/opencode/descriptor";
import { BackendConfigRegistry, ConfiguredModelRegistry } from "@/modelManagement";
import type { ProviderRegistry } from "@/modelManagement";
import type {
  BackendState,
  PermissionDecision,
  PermissionPrompt,
  SessionEvent,
  StopReason,
} from "@/agentMode/session/types";
import {
  getSettings,
  resetSettings,
  setSettings,
  updateAgentModeBackendFields,
} from "@/settings/model";
import { App } from "./obsidianApp";
import { ScriptedProvider } from "./scriptedProvider";

// `AcpProcessManager.shutdown` schedules its SIGTERM grace period with
// `window.setTimeout`, so teardown hangs in a bare Node process without this.
(globalThis as { window?: unknown }).window ??= globalThis;

const PROVIDER_ID = "scripted";
const CLIENT_VERSION = "runtime-tests";

/** The assistant text of one completed turn, plus why it ended. */
export interface Turn {
  text: string;
  stopReason: StopReason;
}

export interface RuntimeOptions {
  /** Absolute path to the pinned opencode binary. */
  binaryPath: string;
  /** Model ids the scripted provider serves, enrolled for the opencode backend. */
  models: readonly string[];
}

/**
 * A live opencode runtime driven through production Copilot code.
 *
 * Owns the temp vault, the scripted provider, and the backend subprocess, and
 * hands out {@link Conversation} handles. Deliberately free of any test-runner
 * vocabulary so the same harness can be driven from any test format.
 */
export class Runtime {
  readonly provider = new ScriptedProvider();
  readonly permissionPrompts: PermissionPrompt[] = [];

  #process: AcpBackendProcess | null = null;
  #tempRoot = "";
  #vaultPath = "";
  #agentHome = "";
  #permissionAnswer: "allow" | "deny" | null = null;

  /** Absolute path of the temp vault the agent runs in. */
  get vaultPath(): string {
    return this.#vaultPath;
  }

  /**
   * Seed settings the way Copilot's own configuration flows would, spawn the
   * real binary, and complete the ACP handshake.
   */
  async start(options: RuntimeOptions): Promise<void> {
    this.#tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-runtime-"));
    this.#vaultPath = path.join(this.#tempRoot, "vault");
    this.#agentHome = path.join(this.#tempRoot, "home");
    await fs.promises.mkdir(this.#vaultPath, { recursive: true });
    await fs.promises.mkdir(this.#agentHome, { recursive: true });

    await this.provider.start();
    this.#seedSettings(options);

    const providerRegistry = {
      // The provider row takes no key, so production never reaches the
      // keychain; this stands in for the Electron-backed registry.
      getApiKey: async () => null,
      get: (id: string) => getSettings().providers[id],
    } as unknown as ProviderRegistry;

    const backend = new OpencodeBackend({
      providerRegistry,
      backendConfigRegistry: new BackendConfigRegistry(
        providerRegistry,
        new ConfiguredModelRegistry()
      ),
      clientVersion: CLIENT_VERSION,
    });

    const proc = new AcpBackendProcess(
      new App(this.#vaultPath) as unknown as ObsidianApp,
      backend,
      CLIENT_VERSION,
      OpencodeBackendDescriptor
    );
    proc.setPermissionPrompter((prompt) => this.#answerPermission(prompt));
    await proc.start();
    this.#process = proc;
  }

  /**
   * Open a conversation (an ACP session) rooted at the temp vault, on the given
   * model. The model is always pinned: opencode otherwise starts every session
   * on one of its own hosted free models, which would send the turn to a real
   * remote service.
   */
  async openConversation(modelId: string): Promise<Conversation> {
    const proc = this.#require();
    const { sessionId, state } = await proc.newSession({ cwd: this.#vaultPath });
    const conversation = new Conversation(proc, sessionId, state);
    await conversation.selectModel(modelId);
    return conversation;
  }

  /**
   * Decide every permission request this way. Unset by default so a request no
   * scenario expected surfaces as a failure instead of a silent auto-deny.
   */
  answerPermissionsWith(answer: "allow" | "deny"): void {
    this.#permissionAnswer = answer;
  }

  /** Read a vault file, or `null` when it does not exist. */
  async readVaultFile(relativePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(path.join(this.#vaultPath, relativePath), "utf-8");
    } catch {
      return null;
    }
  }

  /** Write a vault file, creating parent directories. */
  async writeVaultFile(relativePath: string, content: string): Promise<void> {
    const full = path.join(this.#vaultPath, relativePath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, content, "utf-8");
  }

  /** Kill the subprocess and the provider, and discard the temp dirs. Safe to call twice. */
  async stop(): Promise<void> {
    const proc = this.#process;
    this.#process = null;
    if (proc) await proc.shutdown();
    await this.provider.stop();
    resetSettings();
    if (this.#tempRoot) {
      await fs.promises.rm(this.#tempRoot, { recursive: true, force: true });
      this.#tempRoot = "";
    }
  }

  #require(): AcpBackendProcess {
    if (!this.#process) throw new Error("Runtime.start() has not completed");
    return this.#process;
  }

  async #answerPermission(prompt: PermissionPrompt): Promise<PermissionDecision> {
    this.permissionPrompts.push(prompt);
    const answer = this.#permissionAnswer;
    if (!answer) {
      throw new Error(
        `unexpected permission request for tool "${prompt.toolCall.title}"; ` +
          "call answerPermissionsWith() if the scenario expects one"
      );
    }
    const kinds =
      answer === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const option = prompt.options.find((o) => kinds.includes(o.kind));
    if (!option) {
      throw new Error(
        `no ${answer} option offered; got ${prompt.options.map((o) => o.kind).join(", ")}`
      );
    }
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  #seedSettings(options: RuntimeOptions): void {
    resetSettings();
    setSettings({
      providers: {
        [PROVIDER_ID]: {
          providerId: PROVIDER_ID,
          providerType: "openai-compatible",
          displayName: "Scripted",
          baseUrl: this.provider.baseUrl,
          requiresApiKey: false,
          apiKeyKeychainId: null,
          origin: { kind: "byok" },
          addedAt: 0,
        },
      },
      configuredModels: options.models.map((id) => ({
        configuredModelId: `cm-${id}`,
        providerId: PROVIDER_ID,
        info: { id, displayName: id },
        configuredAt: 0,
      })),
      backends: { opencode: { enabledModels: options.models.map((id) => `cm-${id}`) } },
    });
    updateAgentModeBackendFields("opencode", {
      binaryPath: options.binaryPath,
      binarySource: "managed",
      // Redirect every place opencode would otherwise write into the
      // developer's real home. These ride the production `envOverrides`
      // surface, which cannot touch `OPENCODE_CONFIG_CONTENT`.
      envOverrides: {
        HOME: this.#agentHome,
        XDG_CONFIG_HOME: path.join(this.#agentHome, "config"),
        XDG_DATA_HOME: path.join(this.#agentHome, "data"),
        XDG_CACHE_HOME: path.join(this.#agentHome, "cache"),
        XDG_STATE_HOME: path.join(this.#agentHome, "state"),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      },
    });
  }
}

/** One ACP session, with the assistant text of its most recent turn. */
export class Conversation {
  #chunks: string[] = [];
  #inFlight: Promise<{ stopReason: StopReason }> | null = null;

  constructor(
    private readonly proc: AcpBackendProcess,
    readonly sessionId: string,
    private state: BackendState
  ) {
    proc.registerSessionHandler(sessionId, (event: SessionEvent) => this.#collect(event));
  }

  /**
   * Switch the session to `modelId`, through whichever channel the backend
   * reported for its model picker. Refuses to guess: if opencode ever stops
   * exposing its catalog as a config option, that shows up here as a failure
   * naming what it reported instead.
   */
  async selectModel(modelId: string): Promise<void> {
    const apply = this.state.model?.apply;
    if (apply?.kind !== "setConfigOption" || !apply.configId) {
      throw new Error(
        `expected opencode to apply model selection via a config option, got ${JSON.stringify(apply)}`
      );
    }
    this.state = await this.proc.setSessionConfigOption({
      sessionId: this.sessionId,
      configId: apply.configId,
      value: modelId,
    });
  }

  /** Send a message and resolve once the turn ends. */
  async send(text: string): Promise<Turn> {
    this.sendWithoutWaiting(text);
    return this.awaitTurn();
  }

  /** Start a turn and return immediately, so it can be cancelled mid-stream. */
  sendWithoutWaiting(text: string): void {
    if (this.#inFlight) throw new Error("a turn is already in flight");
    this.#chunks = [];
    this.#inFlight = this.proc.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /** Resolve the in-flight turn into its assistant text. */
  async awaitTurn(): Promise<Turn> {
    const inFlight = this.#inFlight;
    if (!inFlight) throw new Error("no turn is in flight");
    try {
      const { stopReason } = await inFlight;
      return { text: this.#chunks.join(""), stopReason };
    } finally {
      this.#inFlight = null;
    }
  }

  /** Cancel the in-flight turn through the production cancel path. */
  async cancel(): Promise<void> {
    await this.proc.cancel({ sessionId: this.sessionId });
  }

  /** Wait until the turn's assistant text contains `needle`, or throw. */
  async waitForText(needle: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.#chunks.join("").includes(needle)) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for "${needle}"; saw "${this.#chunks.join("")}"`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  #collect(event: SessionEvent): void {
    const update = event.update;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      this.#chunks.push(update.content.text);
    }
  }
}
