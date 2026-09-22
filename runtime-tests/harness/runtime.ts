import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { App as ObsidianApp } from "obsidian";

import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";
import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import { AgentModelPreloader } from "@/agentMode/session/AgentModelPreloader";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentChatMessage, StopReason } from "@/agentMode/session/types";
import { createDefaultPermissionPrompter } from "@/agentMode/ui/permissionPrompter";
import { err2String } from "@/errorFormat";
import { logFileManager } from "@/logFileManager";
import type CopilotPlugin from "@/main";
import { createModelManagement } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { getSettings, setSettings, updateAgentModeBackendFields } from "@/settings/model";
import { AI_SENDER, DEFAULT_SETTINGS } from "@/constants";

import { EgressProxy } from "./egressProxy";
import { App } from "./obsidianApp";
import { shownNotices } from "./obsidianShim";
import { ScriptedProvider } from "./scriptedProvider";

// Agent Mode schedules its timers on `window`, which a bare Node process lacks.
(globalThis as { window?: unknown }).window ??= globalThis;

/** Reported to opencode as the ACP client version. */
const CLIENT_VERSION = "runtime-tests";
/** Spawn, ACP `initialize`, `session/new`, and applying the default model. */
const STARTUP_TIMEOUT_MS = 30_000;
/** One scripted turn, from send until the session reports its stop reason. */
const TURN_TIMEOUT_MS = 20_000;
/** How long a streamed chunk may take to appear in the conversation. */
const CHUNK_VISIBLE_TIMEOUT_MS = 10_000;
/** How long opencode may take to confirm a picked model, effort, or mode. */
const SELECTION_TIMEOUT_MS = 10_000;

/**
 * The only credential the scripted provider accepts. It reaches opencode the
 * way a user's key does — keychain, then generated config — so a request
 * carrying it proves that path.
 */
const SYNTHETIC_API_KEY = "sk-runtime-tests-synthetic-0000000000";

/**
 * Destinations the runtime tries to reach even though nothing in a scenario
 * asks it to. The {@link EgressProxy} refuses them like any other; a
 * destination not listed here fails the scenario.
 */
const EXPECTED_REFUSED_EGRESS: ReadonlySet<string> = new Set([
  // opencode runs `npm install @opencode-ai/plugin` in every config directory
  // it loads, unconditionally and in the background; a failure only logs.
  "registry.npmjs.org:443",
]);

/**
 * Warnings Copilot logs when it stops opencode: the process exit itself and,
 * right after a turn, the title poll that turn started, cut off by the closing
 * connection. Logged while a scenario deliberately restarts or unloads, they
 * are expected; anywhere else they fail the scenario.
 */
const SHUTDOWN_WARNINGS: readonly RegExp[] = [
  / WARN \[AgentMode\] backend opencode exited$/,
  / WARN \[AgentMode\] session\/list title poll failed for \S+ ACP connection closed/,
];

/** One observed state of the conversation's latest assistant message. */
export interface AnswerSnapshot {
  text: string;
  /** Set once the session reports the turn finished. */
  stopReason: StopReason | null;
}

/** One model Copilot is configured with, served by the scripted endpoint of its provider. */
export interface ScriptedModel {
  /** The Copilot provider row it belongs to, which also names that row's endpoint. */
  provider: string;
  model: string;
  /** The model's declared reasoning capability, as the BYOK wizard records it. */
  reasoning: boolean;
}

export interface RuntimeOptions {
  /** Absolute path to the pinned opencode binary. */
  binaryPath: string;
  /** Configured as one OpenAI-compatible provider row per distinct `provider`. */
  models: readonly ScriptedModel[];
  /** Saved as opencode's default model before Copilot starts. */
  defaultModel: { model: string; effort: string | null };
}

/**
 * A Copilot Agent Mode session layer driving the real opencode runtime.
 *
 * Owns a temp vault and agent home, the scripted provider, the egress proxy,
 * and a production `AgentSessionManager`; opens the scenario's {@link Conversation}.
 * Carries no test-runner vocabulary so any test format can drive it.
 */
export class Runtime {
  readonly provider = new ScriptedProvider({
    apiKey: SYNTHETIC_API_KEY,
    sentText: () => this.#conversation?.sentText,
    pace: (sentSoFar) => this.#requireConversation().waitForAnswerText(sentSoFar),
  });
  readonly egress = new EgressProxy();

  #tempRoot = "";
  #vaultPath = "";
  #agentHome = "";
  #restoreEnvironment: (() => void) | null = null;
  #originalCwd = "";
  #app: ObsidianApp | null = null;
  #modelManagement: ReturnType<typeof createModelManagement> | null = null;
  #preloader: AgentModelPreloader | null = null;
  /** Log lines a deliberate restart or unload wrote that {@link problems} ignores. */
  readonly #expectedLogLines = new Set<string>();
  #manager: AgentSessionManager | null = null;
  #conversation: Conversation | null = null;
  /** Process startups the manager does not wait for on shutdown; see {@link stop}. */
  readonly #startups: Promise<unknown>[] = [];

  /**
   * Configure Copilot the way a user would — BYOK OpenAI-compatible providers
   * with a key, their models enabled for opencode and one picked as the
   * default — then construct the session layer and start the model probe
   * plugin load starts.
   */
  async start(options: RuntimeOptions): Promise<void> {
    this.#tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "copilot-runtime-"));
    this.#vaultPath = path.join(this.#tempRoot, "vault");
    this.#agentHome = path.join(this.#tempRoot, "agent-home");
    await fs.promises.mkdir(this.#vaultPath, { recursive: true });
    await fs.promises.mkdir(this.#agentHome, { recursive: true });
    // opencode inherits this process's working directory and bootstraps an
    // instance there, reading any project config it finds; Obsidian never runs
    // from a repository checkout, so neither should the scenario.
    this.#originalCwd = process.cwd();
    process.chdir(this.#tempRoot);
    // The log buffer and the notices outlive a scenario; start each one with its own.
    await logFileManager.clear();
    shownNotices.length = 0;
    const providers = [...new Set(options.models.map((m) => m.provider))];
    await this.provider.start(
      providers.map((name) => ({
        name,
        models: options.models.filter((m) => m.provider === name).map((m) => m.model),
      }))
    );
    await this.egress.start();
    this.#restoreEnvironment = this.#isolateEnvironment();

    // A fresh install's settings. The settings tab's reset (`resetSettings`)
    // keeps every provider that has a key, so it would carry one scenario's
    // providers into the next.
    setSettings(DEFAULT_SETTINGS);
    this.#app = new App(this.#vaultPath) as unknown as ObsidianApp;
    const manager = this.#startCopilot();
    for (const provider of providers) {
      await this.modelManagement.setup.byok.setupProvider({
        providerType: "openai-compatible",
        displayName: provider,
        baseUrl: this.provider.baseUrl(provider),
        apiKey: SYNTHETIC_API_KEY,
        models: options.models
          .filter((m) => m.provider === provider)
          .map((m) => ({ id: m.model, displayName: m.model, reasoning: m.reasoning })),
        autoEnrollIn: ["opencode"],
      });
    }
    updateAgentModeBackendFields("opencode", {
      binaryPath: options.binaryPath,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "managed",
      // Set through the production env-overrides setting: opencode skips its
      // models.dev catalog download, which the proxy would refuse anyway.
      envOverrides: { OPENCODE_DISABLE_MODELS_FETCH: "1" },
    });
    // The same write the Default model setting makes. Without a default,
    // opencode starts sessions on one of its own hosted models.
    await manager.persistDefaultSelection("opencode", {
      baseModelId: this.wireId(options.defaultModel.model),
      effort: options.defaultModel.effort,
    });
    this.#preload(manager);
  }

  /** opencode's id for a configured model, as the picker and saved selections name it. */
  wireId(model: string): string {
    const settings = getSettings();
    const configured = settings.configuredModels.find((m) => m.info.id === model);
    const wireId =
      configured &&
      backendRegistry.opencode.getWireBaseId?.(configured.configuredModelId, settings);
    if (!wireId) throw new Error(`"${model}" is not a configured opencode model`);
    return wireId;
  }

  /**
   * Open a new chat the way the Agent Chat view does, and wait until it can
   * take a message. The first one spawns opencode.
   */
  async openConversation(): Promise<Conversation> {
    const manager = this.#requireManager();
    const opening = manager.createSession("opencode").then(async (created) => {
      await created.ready;
      return created;
    });
    this.#startups.push(opening);
    let session: AgentSession;
    try {
      session = await within(
        STARTUP_TIMEOUT_MS,
        opening,
        () => `still starting (last error: ${manager.getLastError() ?? "none"})`
      );
    } catch (error) {
      throw new Error(`opencode did not start a conversation: ${err2String(error)}`);
    }
    const ui = manager.getChatUIState(session.internalId);
    if (!ui) throw new Error("the new session has no chat UI state");
    this.#conversation = new Conversation(ui);
    return this.#conversation;
  }

  /** The production session manager, for the selection and restart APIs the chat view calls. */
  get manager(): AgentSessionManager {
    return this.#requireManager();
  }

  /** The running plugin's model registries, which the settings tab edits. */
  get modelManagement(): ReturnType<typeof createModelManagement> {
    if (!this.#modelManagement) throw new Error("Runtime.start() has not completed");
    return this.#modelManagement;
  }

  /**
   * Unload and load Copilot again, as disabling and enabling the plugin or
   * restarting Obsidian does: the manager shuts down with its processes, and a
   * new plugin lifecycle builds a new one and starts its model probe. Settings,
   * the keychain, the vault, and opencode's own data persist, as on disk.
   */
  async reloadCopilot(): Promise<void> {
    const previous = this.#requireManager();
    this.#conversation = null;
    const unload = async (): Promise<void> => {
      // A probe still starting would outlive the unload, as at teardown.
      await Promise.allSettled(this.#startups.splice(0));
      // Unload stops a warm probe without waiting for it to exit; its exit
      // warning belongs to the unload all the same.
      const running = [
        previous.getBackendProcess("opencode"),
        ...(this.#preloader?.getWarmProcs().map((warm) => warm.proc) ?? []),
      ].filter((proc) => proc?.isRunning());
      const exited = Promise.all(
        running.map((proc) => new Promise<void>((resolve) => proc?.onExit(resolve)))
      );
      await previous.shutdown();
      await exited;
    };
    await within(
      STARTUP_TIMEOUT_MS,
      this.#expectingShutdown(unload),
      () => "Copilot was still unloading: opencode was starting or had not exited"
    );
    this.#preload(this.#startCopilot());
  }

  /**
   * Restart opencode the way the chat's Reload action does. A spawn-time
   * setting change is held while a chat is open; Reload applies it, replacing
   * every open chat with its resumed conversation. Returns the chat now shown,
   * once it can take a message.
   */
  async restartAgent(): Promise<Conversation> {
    const manager = this.#requireManager();
    const restart = async (): Promise<AgentChatUIState> => {
      await this.#expectingShutdown(async () => {
        await manager.noteSpawnConfigChanged("opencode", "runtime scenario");
        await manager.applyHeldConfigChange("opencode");
      });
      const session = manager.getActiveSession();
      const ui = session && manager.getChatUIState(session.internalId);
      if (!ui) throw new Error("no chat is shown after the restart");
      await session.ready;
      return ui;
    };
    const ui = await within(
      STARTUP_TIMEOUT_MS,
      restart(),
      () => `the chat was not resumed (last error: ${manager.getLastError() ?? "none"})`
    );
    this.#conversation = new Conversation(ui);
    return this.#conversation;
  }

  /**
   * Everything that should fail a scenario even when its own steps passed:
   * requests the scripted provider refused, network destinations the runtime
   * tried to reach that are not {@link EXPECTED_REFUSED_EGRESS}, and warnings or
   * errors in Copilot's log, which is where the session layer reports a failure
   * it swallows.
   */
  problems(): string[] {
    const unexpectedEgress = [...new Set(this.egress.attempts)]
      .filter((target) => !EXPECTED_REFUSED_EGRESS.has(target))
      .map((target) => `the runtime tried to reach ${target}`);
    const loggedProblems = logFileManager
      .exportLogText()
      .split("\n")
      .filter((line) => ["WARN", "ERROR"].includes(line.split(" ")[1]))
      .filter((line) => !this.#expectedLogLines.has(line))
      .map((line) => `Copilot logged: ${line}`);
    return [...this.provider.failures, ...unexpectedEgress, ...loggedProblems];
  }

  /**
   * Logs worth attaching to a failure report: Copilot's own log buffer (which
   * carries opencode's stderr), opencode's log files, provider traffic, and
   * refused network attempts. Unredacted; the caller redacts.
   */
  async diagnostics(): Promise<string> {
    const sections = [
      ["copilot log", logFileManager.exportLogText()],
      ["provider requests", JSON.stringify(this.provider.requests, null, 2)],
      ["provider failures", this.provider.failures.join("\n")],
      ["refused egress", this.egress.attempts.join("\n")],
    ];
    const logDir = path.join(this.#agentHome, "data", "opencode", "log");
    for (const name of await fs.promises.readdir(logDir).catch(() => [])) {
      sections.push([
        `opencode ${name}`,
        await fs.promises.readFile(path.join(logDir, name), "utf-8"),
      ]);
    }
    return sections.map(([title, body]) => `===== ${title}\n${body}`).join("\n");
  }

  /**
   * Shut the session layer down, then make sure nothing it spawned survived,
   * then stop the servers and delete the temp dirs. Every step runs even if an
   * earlier one fails. Returns what went wrong: a failed shutdown, and any
   * opencode process that outlived it (which is killed).
   */
  async stop(): Promise<string[]> {
    const manager = this.#manager;
    this.#manager = null;
    this.#conversation = null;
    this.#app = null;
    this.#modelManagement = null;
    this.#preloader = null;
    this.#expectedLogLines.clear();
    const problems: string[] = [];
    // `shutdown()` stops the processes it owns but not one still starting: a
    // probe that finishes afterwards shuts its own process down, too late for
    // the sweep below. A scenario that ends early must not leave one behind.
    await within(
      STARTUP_TIMEOUT_MS,
      Promise.allSettled(this.#startups.splice(0)),
      () => "opencode was still starting at teardown"
    ).catch(() => {});
    await manager?.shutdown().catch((error: unknown) => {
      problems.push(`the session shutdown failed: ${err2String(error)}`);
    });
    if (this.#vaultPath) {
      for (const survivor of killProcessesMentioning(this.#vaultPath)) {
        problems.push(`opencode outlived the session shutdown (${survivor})`);
      }
    }
    await this.provider.stop();
    await this.egress.stop();
    KeychainService.resetInstance();
    setSettings(DEFAULT_SETTINGS);
    this.#restoreEnvironment?.();
    this.#restoreEnvironment = null;
    if (this.#originalCwd) process.chdir(this.#originalCwd);
    if (this.#tempRoot) {
      await fs.promises.rm(this.#tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
    this.#tempRoot = "";
    return problems;
  }

  /**
   * Run a deliberate restart or unload, recording the {@link SHUTDOWN_WARNINGS}
   * it logs as expected. Any other warning it logs still fails the scenario.
   */
  async #expectingShutdown(stop: () => Promise<void>): Promise<void> {
    const before = new Set(logFileManager.exportLogText().split("\n"));
    await stop();
    for (const line of logFileManager.exportLogText().split("\n")) {
      if (!before.has(line) && SHUTDOWN_WARNINGS.some((warning) => warning.test(line))) {
        this.#expectedLogLines.add(line);
      }
    }
  }

  /**
   * Construct what plugin load constructs for opencode: the model registries,
   * a plugin object carrying them, and a session manager with the default
   * permission prompter and the model preloader.
   */
  #startCopilot(): AgentSessionManager {
    const app = this.#requireApp();
    const modelManagement = createModelManagement({ app });
    this.#modelManagement = modelManagement;
    const plugin = {
      app,
      manifest: { version: CLIENT_VERSION },
      modelManagement,
    } as unknown as CopilotPlugin;
    const preloader = new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]);
    this.#preloader = preloader;
    const manager: AgentSessionManager = new AgentSessionManager(app, plugin, {
      permissionPrompter: createDefaultPermissionPrompter(
        (id) => manager.getSessionByBackendId(id),
        (id) => manager.isReadOnlyFanoutSession(id)
      ),
      resolveDescriptor: (id) => backendRegistry[id],
      modelPreloader: preloader,
    });
    this.#manager = manager;
    return manager;
  }

  /** Start the model probe plugin load starts; the first chat adopts its warm process. */
  #preload(manager: AgentSessionManager): void {
    const preload = manager.preloadModels("opencode");
    this.#startups.push(preload);
    manager.registerPreload("opencode", preload);
  }

  #requireApp(): ObsidianApp {
    if (!this.#app) throw new Error("Runtime.start() has not run");
    return this.#app;
  }

  /**
   * Stand in for a fresh machine account for the rest of the scenario: a
   * private home and XDG roots, so neither Copilot nor any opencode it runs
   * (including the `--version` probe that runs before every spawn) reads or
   * writes the developer's state; and the egress proxy for all but loopback.
   * Returns a function that restores the previous values.
   */
  #isolateEnvironment(): () => void {
    const home = this.#agentHome;
    const proxy = this.egress.url;
    const isolated: Record<string, string> = {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      http_proxy: proxy,
      https_proxy: proxy,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      // opencode's plugin install honors a registry set in the developer's npm
      // config, which would name a destination the allow-list does not expect.
      npm_config_registry: "https://registry.npmjs.org/",
    };
    const previous = Object.keys(isolated).map((key) => [key, process.env[key]] as const);
    Object.assign(process.env, isolated);
    return () => {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
  }

  #requireManager(): AgentSessionManager {
    if (!this.#manager) throw new Error("Runtime.start() has not completed");
    return this.#manager;
  }

  #requireConversation(): Conversation {
    if (!this.#conversation) throw new Error("no conversation has been opened");
    return this.#conversation;
  }
}

/**
 * One Agent Mode chat, observed through the same `AgentChatUIState` the chat
 * view renders from. Records every distinct state of the latest assistant
 * message so a scenario can assert how an answer arrived, not just its end.
 */
export class Conversation {
  #timeline: AnswerSnapshot[] = [];
  #sentText: string | undefined;

  constructor(private readonly ui: AgentChatUIState) {
    ui.subscribe(() => this.#record());
  }

  /** The last message sent, as typed. */
  get sentText(): string | undefined {
    return this.#sentText;
  }

  /** Every message the conversation shows, in order. */
  get messages(): readonly AgentChatMessage[] {
    return this.ui.getMessages();
  }

  /** Every distinct state of the answer to the last message sent, in order. */
  get timeline(): readonly AnswerSnapshot[] {
    return this.#timeline;
  }

  /** Send a message through the chat input's path and wait for the turn to end. */
  async send(text: string): Promise<void> {
    this.#timeline = [];
    this.#sentText = text;
    const { turn } = this.ui.sendMessage(text);
    await within(
      TURN_TIMEOUT_MS,
      turn,
      () => `the turn did not finish; the answer went ${formatTimeline(this.#timeline)}`
    );
    this.#record();
  }

  /**
   * Resolve once `check()` holds, re-checking whenever the chat view would
   * re-render, as it does when opencode confirms a picked model, effort, or mode.
   */
  waitFor(check: () => boolean, waitingFor: () => string): Promise<void> {
    return waitUntil(
      check,
      (listener) => this.ui.subscribe(listener),
      SELECTION_TIMEOUT_MS,
      waitingFor
    );
  }

  /** Resolve once the answer being streamed reads exactly `text`. */
  waitForAnswerText(text: string): Promise<void> {
    return waitUntil(
      () => this.#timeline.at(-1)?.text === text,
      (listener) => this.ui.subscribe(listener),
      CHUNK_VISIBLE_TIMEOUT_MS,
      () => `the conversation to show "${text}"; the answer went ${formatTimeline(this.#timeline)}`
    );
  }

  #record(): void {
    const answer = this.ui.getMessages().findLast((m) => m.sender === AI_SENDER);
    if (!answer) return;
    const next = { text: answer.message, stopReason: answer.turnStopReason ?? null };
    const last = this.#timeline.at(-1);
    if (last?.text === next.text && last.stopReason === next.stopReason) return;
    this.#timeline.push(next);
  }
}

function formatTimeline(timeline: readonly AnswerSnapshot[]): string {
  if (timeline.length === 0) return "unshown";
  return timeline
    .map((s) =>
      s.stopReason ? `${JSON.stringify(s.text)} (${s.stopReason})` : JSON.stringify(s.text)
    )
    .join(" → ");
}

/** Reject with `explain()` if `promise` has not settled within `ms`. */
async function within<T>(ms: number, promise: Promise<T>, explain: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`after ${ms}ms: ${explain()}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve when `check()` holds, re-checking on every notification; bounded by `ms`. */
function waitUntil(
  check: () => boolean,
  subscribe: (listener: () => void) => () => void,
  ms: number,
  waitingFor: () => string
): Promise<void> {
  if (check()) return Promise.resolve();
  let unsubscribe = (): void => {};
  const satisfied = new Promise<void>((resolve) => {
    unsubscribe = subscribe(() => {
      if (check()) resolve();
    });
  });
  return within(ms, satisfied, () => `timed out waiting for ${waitingFor()}`).finally(() =>
    unsubscribe()
  );
}

/**
 * Kill any process whose command line mentions `needle` (the scenario's temp
 * vault, which every opencode it spawned received as `--cwd`), returning a
 * description of each. The production shutdown should leave none.
 */
function killProcessesMentioning(needle: string): string[] {
  const listing = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf-8" });
  const killed: string[] = [];
  for (const line of listing.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match || !match[2].includes(needle) || Number(match[1]) === process.pid) continue;
    try {
      process.kill(Number(match[1]), "SIGKILL");
      killed.push(`pid ${match[1]}: ${match[2]}`);
    } catch {
      // Exited between the listing and the kill.
    }
  }
  return killed;
}
