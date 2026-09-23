import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { App as ObsidianApp } from "obsidian";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OPENCODE_PINNED_VERSION } from "@/agentMode/backends/opencode/ui/opencodeVersion";
import { backendRegistry } from "@/agentMode/backends/registry";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { withReadOnlyPreamble, type AgentSession } from "@/agentMode/session/AgentSession";
import { AgentModelPreloader } from "@/agentMode/session/AgentModelPreloader";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentAnswer } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage, PermissionPrompt, StopReason } from "@/agentMode/session/types";
import { createDefaultPermissionPrompter } from "@/agentMode/ui/permissionPrompter";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { err2String } from "@/errorFormat";
import { logFileManager } from "@/logFileManager";
import type CopilotPlugin from "@/main";
import { createModelManagement } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { getSettings, setSettings, updateAgentModeBackendFields } from "@/settings/model";
import { AI_SENDER, DEFAULT_SETTINGS, USER_SENDER } from "@/constants";

import { EgressProxy } from "./egressProxy";
import { App } from "./obsidianApp";
import { shownNotices } from "./obsidianShim";
import { ScriptedProvider, type Asker, type HeldStream } from "./scriptedProvider";

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
/** How long opencode may take to close a held answer's request once its turn is stopped. */
const HELD_CLOSE_TIMEOUT_MS = 10_000;

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
 * connection. Logged while a scenario deliberately restarts opencode, they are
 * expected; anywhere else they fail the scenario.
 */
const SHUTDOWN_WARNINGS: readonly RegExp[] = [
  / WARN \[AgentMode\] backend opencode exited$/,
  / WARN \[AgentMode\] session\/list title poll failed for \S+ ACP connection closed/,
];

/**
 * The first line of opencode's stderr report of a failed ACP request. The
 * error it names follows on INFO lines, so this line alone cannot say which
 * failure it reports.
 */
const OPENCODE_REQUEST_FAILED_LOG = " ERROR [AgentMode][opencode] Error handling request {";

/**
 * Copilot's answer to a request opencode made of it, such as
 * `fs/write_text_file`, failed. opencode only logs such a failure, so a turn
 * that depended on it can still look fine.
 */
const CLIENT_ERROR_REPLY = / \[ACP →\]\[opencode\] \(error\) /;

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
    askerFor: (message) => this.#askers.findLast((asker) => asker.sentText === message),
  });
  readonly egress = new EgressProxy();

  #tempRoot = "";
  #vaultPath = "";
  #agentHome = "";
  #restoreEnvironment: (() => void) | null = null;
  #originalCwd = "";
  #modelManagement: ReturnType<typeof createModelManagement> | null = null;
  #preloader: AgentModelPreloader | null = null;
  /** Log lines a deliberate restart wrote that {@link problems} ignores. */
  readonly #expectedLogLines = new Set<string>();
  /** One fragment per log line the turns a scenario made fail are expected to write. */
  readonly #expectedFailureLogs: string[] = [];
  #manager: AgentSessionManager | null = null;
  /** Every chat opened and read-only question asked so far, oldest first. */
  #askers: SentAsker[] = [];
  /** Process startups the manager does not wait for on shutdown; see {@link stop}. */
  readonly #startups: Promise<unknown>[] = [];

  /**
   * Configure Copilot the way a user would — BYOK OpenAI-compatible providers
   * with a key, their models enabled for opencode and one picked as the
   * default — then construct the session layer and start the model probe
   * plugin load starts.
   */
  async start(options: RuntimeOptions): Promise<void> {
    // opencode resolves symlinks in its working directory. Under a linked temp
    // dir (macOS's /var → /private/var), a vault named through the link reads
    // as outside itself, and every edit first asks for an external directory.
    const tmp = await fs.promises.realpath(os.tmpdir());
    this.#tempRoot = await fs.promises.mkdtemp(path.join(tmp, "copilot-runtime-"));
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
    const app = new App(this.#vaultPath) as unknown as ObsidianApp;
    const modelManagement = createModelManagement({ app });
    this.#modelManagement = modelManagement;
    const plugin = {
      app,
      manifest: { version: CLIENT_VERSION },
      modelManagement,
    } as unknown as CopilotPlugin;

    for (const provider of providers) {
      await modelManagement.setup.byok.setupProvider({
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

    // The same write the Default model setting makes. Without a default,
    // opencode starts sessions on one of its own hosted models.
    await manager.persistDefaultSelection("opencode", {
      baseModelId: this.wireId(options.defaultModel.model),
      effort: options.defaultModel.effort,
    });
    // The first chat adopts this probe's warm process, as after plugin load.
    const preload = manager.preloadModels("opencode");
    this.#startups.push(preload);
    manager.registerPreload("opencode", preload);
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
    return this.#track(session.internalId);
  }

  /** The scenario's disposable vault, which opencode runs in. */
  get vaultPath(): string {
    return this.#vaultPath;
  }

  /**
   * A digest of every file under the scenario's temp root except the agent
   * home, keyed by its path from the root: the vault, and anything a tool
   * wrote beside it. opencode's own state in the agent home is left out.
   */
  fileDigests(): Map<string, string> {
    const digests = new Map<string, string>();
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (file === this.#agentHome) continue;
        if (entry.isDirectory()) visit(file);
        else digests.set(path.relative(this.#tempRoot, file), digestOf(file));
      }
    };
    visit(this.#tempRoot);
    return digests;
  }

  /**
   * Ask opencode `question` the way a chat asks an @-mentioned agent in a
   * multi-agent turn: the manager's fan-out runs it in an ephemeral read-only
   * session, behind the read-only preamble the chat prepends. Resolves with
   * opencode's answer once it settles.
   */
  async askReadOnly(question: string): Promise<AgentAnswer> {
    const prompt = withReadOnlyPreamble([{ type: "text", text: question }]);
    const answer = new ReadOnlyAnswer(prompt[0].type === "text" ? prompt[0].text : question);
    this.#askers.push(answer);
    const turn = this.#requireManager().runFanoutTurn({
      agents: ["opencode"],
      // The chat's own agent. With one answerer it writes no summary, so it never starts.
      mainAgent: "claude",
      prompt,
      originalPromptText: question,
      signal: new AbortController().signal,
      onChange: (update) => answer.update(update.answers.opencode),
    });
    const settled = await within(
      TURN_TIMEOUT_MS,
      turn,
      () =>
        `the read-only answer did not settle; it reads ${JSON.stringify(answer.text)}; the provider ${this.#describeProvider()}`
    );
    return settled.answers.opencode;
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
   * Report a spawn-time setting change with no chat open, as Copilot's settings
   * subscriptions do: opencode's warm probe restarts on the new config at once.
   * Resolves once the old probe has exited and the new one is warm.
   *
   * @param reason The reason the subscription reports, carried into the log.
   */
  async noteSpawnConfigChanged(reason: string): Promise<void> {
    const manager = this.#requireManager();
    const restart = this.#expectingShutdown(async () => {
      // A probe still starting would take the change itself and exit later.
      await Promise.allSettled(this.#startups.splice(0));
      // The refresh stops the old probe without waiting for it to exit; its
      // exit warning belongs to this restart all the same.
      const exited = Promise.all(
        (this.#preloader?.getWarmProcs() ?? [])
          .filter(({ proc }) => proc.isRunning())
          .map(({ proc }) => new Promise<void>((resolve) => proc.onExit(resolve)))
      );
      await manager.noteSpawnConfigChanged("opencode", reason);
      await exited;
      // Deduplicated onto the new probe the change started.
      await manager.preloadModels("opencode");
    });
    await within(
      STARTUP_TIMEOUT_MS,
      restart,
      () =>
        "opencode's warm probe did not restart: the old probe had not exited or the new one was still starting"
    );
  }

  /**
   * Restart opencode the way the chat's Reload action does. A spawn-time
   * setting change is held while a chat is open; Reload applies it, replacing
   * every open chat with its resumed conversation. Returns the chat now shown,
   * once it can take a message.
   */
  async restartAgent(): Promise<Conversation> {
    const manager = this.#requireManager();
    const restart = async (): Promise<AgentSession> => {
      await this.#expectingShutdown(async () => {
        await manager.noteSpawnConfigChanged("opencode", "runtime scenario");
        await manager.applyHeldConfigChange("opencode");
      });
      const session = manager.getActiveSession();
      if (!session) throw new Error("no chat is shown after the restart");
      await session.ready;
      return session;
    };
    const session = await within(
      STARTUP_TIMEOUT_MS,
      restart(),
      () => `the chat was not resumed (last error: ${manager.getLastError() ?? "none"})`
    );
    return this.#track(session.internalId);
  }

  /** Show `conversation` in the chat view, as clicking its tab does. */
  show(conversation: Conversation): void {
    this.#requireManager().setActiveSession(conversation.id);
  }

  /**
   * Wait for a promise the scripted provider settles, such as {@link
   * ScriptedProvider.hold}, within a turn's time.
   *
   * @param event What the provider is expected to do, for the failure message.
   */
  waitForProvider<T>(promise: Promise<T>, event: string): Promise<T> {
    return within(
      TURN_TIMEOUT_MS,
      promise,
      () => `timed out waiting for the provider to ${event}; it has ${this.#describeProvider()}`
    );
  }

  /** Resolve once opencode closes `held`'s request, as it does when the turn is stopped. */
  async requestClosed(held: HeldStream): Promise<void> {
    await within(
      HELD_CLOSE_TIMEOUT_MS,
      held.closedByAgent,
      () =>
        `opencode did not close the held answer to ${JSON.stringify(held.question)}; it is ${held.state}`
    );
  }

  /**
   * What the provider has done so far, for a failure message: it tells an
   * answer held on purpose from a request that never arrived.
   */
  #describeProvider(): string {
    const turns = this.provider.requests.filter((r) => r.kind === "turn").length;
    const held =
      this.provider.held.map((h) => `${JSON.stringify(h.question)} (${h.state})`).join(", ") ||
      "none";
    const refused = this.provider.failures.join("; ") || "nothing";
    return `received ${turns} agent turn(s), held answers to ${held}, and refused ${refused}`;
  }

  /**
   * Record that the scenario is making one turn fail on a provider error, so
   * the three lines that failure logs do not fail the scenario: opencode's
   * report of the failed request, the session's warning, and the chat view's
   * error. Any other warning, or a second failure, still fails it.
   *
   * @param message The provider's error message, which the two Copilot lines name.
   */
  expectTurnToFail(message: string): void {
    // Copilot writes the error's stack after a literal "\n", which ends the message.
    const error = `Internal error: ${message}\\n`;
    this.#expectedFailureLogs.push(
      OPENCODE_REQUEST_FAILED_LOG,
      ` WARN [AgentMode] prompt failed ${error}`,
      ` ERROR [AgentMode] turn failed ${error}`
    );
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
    const failureLogs = [...this.#expectedFailureLogs];
    const lines = logFileManager.exportLogText().split("\n");
    const failedReplies = lines
      .filter((line) => CLIENT_ERROR_REPLY.test(line))
      .map((line) => `Copilot answered opencode with an error: ${line}`);
    const loggedProblems = lines
      .filter((line) => ["WARN", "ERROR"].includes(line.split(" ")[1]))
      .filter((line) => !this.#expectedLogLines.has(line))
      .filter((line) => {
        // opencode's stderr and its ACP reply arrive on separate pipes, so its
        // report may be logged after the turn has already ended.
        const expected = failureLogs.findIndex((fragment) => line.includes(fragment));
        if (expected === -1) return true;
        failureLogs.splice(expected, 1);
        return false;
      })
      .map((line) => `Copilot logged: ${line}`);
    return [...this.provider.failures, ...unexpectedEgress, ...failedReplies, ...loggedProblems];
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
    this.#askers = [];
    this.#modelManagement = null;
    this.#preloader = null;
    this.#expectedLogLines.clear();
    this.#expectedFailureLogs.length = 0;
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
   * Run a deliberate restart, recording the {@link SHUTDOWN_WARNINGS} it logs
   * as expected. Any other warning it logs still fails the scenario.
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

  /** Wrap the chat `internalId` names as a {@link Conversation} the provider can pace. */
  #track(internalId: string): Conversation {
    const ui = this.#requireManager().getChatUIState(internalId);
    if (!ui) throw new Error("the new session has no chat UI state");
    const conversation = new Conversation(internalId, ui, () => this.#describeProvider());
    this.#askers.push(conversation);
    return conversation;
  }
}

/** Something that sent the provider a question and shows the answer: a chat or a read-only question. */
interface SentAsker extends Asker {
  /** The user message the provider sees as the question. */
  readonly sentText: string | undefined;
}

/**
 * One Agent Mode chat, observed through the same `AgentChatUIState` the chat
 * view renders from. Records every distinct state of the latest assistant
 * message so a scenario can assert how an answer arrived, not just its end,
 * and every permission card the chat showed.
 */
export class Conversation implements SentAsker {
  #timeline: AnswerSnapshot[] = [];
  #sentText: string | undefined;
  #turn: Promise<void> | null = null;
  #turnEnded = false;
  readonly #permissionsShown: PermissionPrompt[] = [];

  /**
   * @param id The chat's session id, which the chat view's tabs switch by.
   * @param ui The state the chat view renders this chat from.
   * @param describeProvider What the provider has done, for a stalled turn's failure message.
   */
  constructor(
    readonly id: string,
    private readonly ui: AgentChatUIState,
    private readonly describeProvider: () => string
  ) {
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

  /** Every permission card the chat has shown, oldest first. */
  get permissionsShown(): readonly PermissionPrompt[] {
    return this.#permissionsShown;
  }

  /** The permission card the chat shows now, if any. */
  get shownPermission(): PermissionPrompt | undefined {
    return this.ui.getPendingToolPermissions()[0];
  }

  /** Pick `optionId` on the card now shown, as its button does. */
  answerPermission(optionId: string): void {
    const request = this.shownPermission;
    if (!request) throw new Error("the chat shows no permission card");
    this.ui.resolveToolPermission(request.toolCall.toolCallId, optionId);
  }

  /** Resolve once the chat shows a permission card, or the turn has ended without one. */
  untilPermissionOrEnd(): Promise<void> {
    const turn = this.#turn;
    if (!turn) throw new Error("no message has been sent");
    return waitUntil(
      () => this.#turnEnded || this.shownPermission !== undefined,
      (listener) => {
        void turn.then(listener);
        return this.ui.subscribe(listener);
      },
      TURN_TIMEOUT_MS,
      () =>
        `a permission card or the end of the turn; the answer went ${formatTimeline(this.#timeline)}; the provider ${this.describeProvider()}`
    );
  }

  /** Send a message through the chat input's path and wait for the turn to end. */
  async send(text: string): Promise<void> {
    this.start(text);
    await this.finish();
  }

  /** Send a message through the chat input's path without waiting for the turn to end. */
  start(text: string): void {
    this.#timeline = [];
    this.#sentText = text;
    this.#turnEnded = false;
    const turn = this.ui.sendMessage(text).turn;
    this.#turn = turn;
    void turn.then(() => {
      if (this.#turn === turn) this.#turnEnded = true;
    });
  }

  /** Wait for the turn the last message started to end, as the chat input does before it unlocks. */
  async finish(): Promise<void> {
    if (!this.#turn) throw new Error("no message has been sent");
    await within(
      TURN_TIMEOUT_MS,
      this.#turn,
      () =>
        `the turn did not finish; the answer went ${formatTimeline(this.#timeline)}; the provider ${this.describeProvider()}`
    );
    this.#record();
  }

  /** Stop the answer being written, as the chat input's stop button does. */
  stop(): Promise<void> {
    return this.ui.cancel();
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
    for (const request of this.ui.getPendingToolPermissions()) {
      const id = request.toolCall.toolCallId;
      if (!this.#permissionsShown.some((shown) => shown.toolCall.toolCallId === id)) {
        this.#permissionsShown.push(request);
      }
    }
    const answer = this.ui.getMessages().findLast((m) => m.sender === AI_SENDER);
    if (!answer) return;
    const next = { text: drawnText(answer), stopReason: answer.turnStopReason ?? null };
    const last = this.#timeline.at(-1);
    if (last?.text === next.text && last.stopReason === next.stopReason) return;
    this.#timeline.push(next);
  }
}

/**
 * The text the chat view draws for `message`. `AgentChatMessages.tsx` renders
 * an assistant message that has parts as its trail, whose prose is its text
 * parts, and ignores `message.message`, where a failed turn's error is written:
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/388
 */
export function drawnText(message: AgentChatMessage): string {
  if (message.sender === USER_SENDER || !message.parts?.length) return message.message;
  return message.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n\n");
}

/**
 * An @-mentioned agent's answer to a read-only question, as the multi-agent
 * turn streams it. Paces the provider the way a chat does.
 */
class ReadOnlyAnswer implements SentAsker {
  #answer: AgentAnswer | undefined;
  readonly #listeners = new Set<() => void>();

  /** @param sentText The prompt as sent, read-only preamble included. */
  constructor(readonly sentText: string) {}

  get text(): string {
    return this.#answer?.text ?? "";
  }

  /** Take the latest state of the answer, as the multi-agent turn reports it. */
  update(answer: AgentAnswer | undefined): void {
    this.#answer = answer;
    for (const listener of this.#listeners) listener();
  }

  waitForAnswerText(text: string): Promise<void> {
    return waitUntil(
      () => this.text === text,
      (listener) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
      },
      CHUNK_VISIBLE_TIMEOUT_MS,
      () => `the read-only answer to show "${text}"; it shows ${JSON.stringify(this.text)}`
    );
  }
}

/**
 * Each tool call in `message` as the chat's trail draws its row: the summary
 * line `ActionCard` shows, and the status its badge stands for.
 *
 * @param vaultBase The vault root, which the row's paths are shown relative to.
 */
export function drawnToolCalls(message: AgentChatMessage, vaultBase: string): string[][] {
  return (message.parts ?? []).flatMap((part) =>
    part.kind === "tool_call"
      ? [[lookupToolSummary(part).collapsedLine(part, { vaultBase }), part.status]]
      : []
  );
}

/**
 * The lines the chat's `ToolPermissionCard` draws for `request`, rendered by
 * the component itself: its heading, what the agent wants to run, the tool's
 * kind, each diff's path and lines, and one line per button.
 */
export function drawnPermissionCard(request: PermissionPrompt): string[] {
  const html = renderToStaticMarkup(
    createElement(ToolPermissionCard, { request, onResolve: () => {} })
  );
  return html
    .replace(/<\/(div|p|pre|button)>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|quot|#x27|amp);/g, (_, entity: string) => HTML_ENTITIES[entity])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const HTML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  "#x27": "'",
  amp: "&",
};

/**
 * What `FanoutTurnView` draws for one agent's answer to a read-only question
 * once it has settled: its text, or the line it shows in place of none.
 */
export function drawnReadOnlyAnswer(answer: AgentAnswer): string {
  if (answer.status === "error") return answer.error?.trim() || "This agent failed to answer.";
  if (answer.status === "cancelled") return answer.text || "Cancelled";
  return answer.text || "This agent did not answer.";
}

function formatTimeline(timeline: readonly AnswerSnapshot[]): string {
  if (timeline.length === 0) return "unshown";
  return timeline
    .map((s) =>
      s.stopReason ? `${JSON.stringify(s.text)} (${s.stopReason})` : JSON.stringify(s.text)
    )
    .join(" → ");
}

function digestOf(file: string): string {
  return createHash("sha256")
    .update(new Uint8Array(fs.readFileSync(file)))
    .digest("hex");
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
