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
import { getSettings, resetSettings, updateAgentModeBackendFields } from "@/settings/model";
import { AI_SENDER } from "@/constants";

import { EgressProxy } from "./egressProxy";
import { App } from "./obsidianApp";
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

/** One observed state of the conversation's latest assistant message. */
export interface AnswerSnapshot {
  text: string;
  /** Set once the session reports the turn finished. */
  stopReason: StopReason | null;
}

export interface RuntimeOptions {
  /** Absolute path to the pinned opencode binary. */
  binaryPath: string;
  /** The model id the scripted provider serves, made opencode's default model. */
  model: string;
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
  #manager: AgentSessionManager | null = null;
  #conversation: Conversation | null = null;
  /** Process startups the manager does not wait for on shutdown; see {@link stop}. */
  readonly #startups: Promise<unknown>[] = [];

  /**
   * Configure Copilot the way a user would — a BYOK OpenAI-compatible provider
   * with a key, its model enabled for opencode and picked as the default — then
   * construct the session layer and start the model probe plugin load starts.
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
    // The log buffer outlives a scenario; start each one with its own.
    await logFileManager.clear();
    await this.provider.start(options.model);
    await this.egress.start();
    this.#restoreEnvironment = this.#isolateEnvironment();

    resetSettings();
    const app = new App(this.#vaultPath) as unknown as ObsidianApp;
    const modelManagement = createModelManagement({ app });
    const plugin = {
      app,
      manifest: { version: CLIENT_VERSION },
      modelManagement,
    } as unknown as CopilotPlugin;

    const { configuredModelIds } = await modelManagement.setup.byok.setupProvider({
      providerType: "openai-compatible",
      displayName: "Scripted",
      baseUrl: this.provider.baseUrl,
      apiKey: SYNTHETIC_API_KEY,
      models: [{ id: options.model, displayName: options.model }],
      autoEnrollIn: ["opencode"],
    });
    updateAgentModeBackendFields("opencode", {
      binaryPath: options.binaryPath,
      binaryVersion: OPENCODE_PINNED_VERSION,
      binarySource: "managed",
      // Set through the production env-overrides setting: opencode skips its
      // models.dev catalog download, which the proxy would refuse anyway.
      envOverrides: { OPENCODE_DISABLE_MODELS_FETCH: "1" },
    });

    const manager: AgentSessionManager = new AgentSessionManager(app, plugin, {
      permissionPrompter: createDefaultPermissionPrompter(
        (id) => manager.getSessionByBackendId(id),
        (id) => manager.isReadOnlyFanoutSession(id)
      ),
      resolveDescriptor: (id) => backendRegistry[id],
      modelPreloader: new AgentModelPreloader(app, plugin, (id) => backendRegistry[id]),
    });
    this.#manager = manager;

    // The same write the Default model picker makes. Without a default,
    // opencode starts sessions on one of its own hosted models.
    const opencode = backendRegistry.opencode;
    const defaultEntry = opencode
      .getEnabledModelEntries?.(getSettings())
      ?.find(
        (entry) =>
          entry.baseModelId === opencode.getWireBaseId?.(configuredModelIds[0], getSettings())
      );
    if (!defaultEntry) {
      throw new Error(`"${options.model}" is not an enabled opencode model after setup`);
    }
    await manager.persistDefaultSelection("opencode", {
      baseModelId: defaultEntry.baseModelId,
      effort: null,
    });
    // The first chat adopts this probe's warm process, as after plugin load.
    const preload = manager.preloadModels("opencode");
    this.#startups.push(preload);
    manager.registerPreload("opencode", preload);
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
    resetSettings();
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
