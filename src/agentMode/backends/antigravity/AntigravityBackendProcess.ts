import { v4 as uuidv4 } from "uuid";

import type {
  BackendProcess,
  BackendState,
  CancelInput,
  ListSessionsInput,
  ListSessionsOutput,
  LoadSessionInput,
  LoadSessionOutput,
  OpenSessionInput,
  OpenSessionOutput,
  PermissionDecision,
  PermissionPrompt,
  PromptInput,
  PromptOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionEvent,
  SessionId,
  SessionUpdateHandler,
  StopReason,
} from "@/agentMode/session/types";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { requireNodeModule } from "@/utils/desktopRuntime";

import { parseAntigravityModels, parseAntigravityStreamLine } from "./antigravityCli";

export interface AntigravityChildProcess {
  stdin: { write(chunk: string): void; end(): void };
  stdout: { on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown };
  on(event: "close", listener: (code: number | null, signal?: string | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: string): boolean;
}

interface AntigravitySpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  stdio: ["pipe", "pipe", "pipe"];
}

type SpawnProcess = (args: string[], options: AntigravitySpawnOptions) => AntigravityChildProcess;
type RunModels = () => Promise<string>;

export interface AntigravityBackendProcessOptions {
  binaryPath: string;
  defaultModel?: string;
  env?: Record<string, string>;
  runModels?: RunModels;
  spawnProcess?: SpawnProcess;
}

interface SessionState {
  cwd: string;
  modelId: string;
  conversationId?: string;
  active?: ActiveTurn;
  cancelRequested: boolean;
}

interface ActiveTurn {
  child: AntigravityChildProcess;
  finish: (error: Error | null, stopReason: StopReason) => void;
}

/** BackendProcess adapter for the official Antigravity 2.x `agy` CLI. */
export class AntigravityBackendProcess implements BackendProcess {
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  private readonly sessions = new Map<SessionId, SessionState>();
  private readonly exitListeners = new Set<() => void>();
  private readonly options: AntigravityBackendProcessOptions;
  private readonly runModels: RunModels;
  private readonly spawnProcess: SpawnProcess;
  private modelCatalog: ReturnType<typeof parseAntigravityModels> | null = null;
  private modelCatalogPromise: Promise<ReturnType<typeof parseAntigravityModels>> | null = null;
  private shuttingDown = false;

  constructor(options: AntigravityBackendProcessOptions) {
    this.options = options;
    this.runModels =
      options.runModels ?? (() => runAntigravityModels(options.binaryPath, options.env));
    this.spawnProcess =
      options.spawnProcess ??
      ((args, spawnOptions) => spawnAntigravity(options.binaryPath, args, spawnOptions));
  }

  async start(): Promise<void> {
    if (this.shuttingDown) throw new Error("Antigravity backend has been shut down.");
  }

  isRunning(): boolean {
    return !this.shuttingDown;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  setPermissionPrompter(_fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void {
    // Headless `agy` applies its own request-review policy. It never asks the
    // Obsidian Agent UI for an ACP permission decision.
  }

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) this.sessionHandlers.delete(sessionId);
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    this.assertRunning();
    const models = await this.ensureModelCatalog();
    if (models.length === 0) {
      throw new Error("Antigravity did not report any models. Sign in with `agy` and try again.");
    }
    const preferred = models.find((model) => model.modelId === this.options.defaultModel);
    const sessionId = uuidv4();
    const modelId = preferred?.modelId ?? models[0].modelId;
    this.sessions.set(sessionId, {
      cwd: params.cwd,
      modelId,
      cancelRequested: false,
    });
    return { sessionId, state: this.stateFor(modelId) };
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    this.assertRunning();
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown Antigravity session ${params.sessionId}`);
    if (session.active)
      throw new Error(`Antigravity session ${params.sessionId} is already running`);

    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      session.modelId,
    ];
    if (session.conversationId) args.push("--conversation", session.conversationId);

    const child = this.spawnProcess(args, {
      cwd: session.cwd,
      env: { ...process.env, ...(this.options.env ?? {}) },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new Promise<PromptOutput>((resolve, reject) => {
      let lineBuffer = "";
      let stderr = "";
      let sawText = false;
      let resultError: Error | null = null;
      let resultStopReason: StopReason = "end_turn";
      let resultConversationId: string | undefined;
      let settled = false;

      const finish = (error: Error | null, stopReason: StopReason): void => {
        if (settled) return;
        settled = true;
        if (session.active?.child === child) session.active = undefined;
        if (resultConversationId) session.conversationId = resultConversationId;
        if (error) reject(error);
        else resolve({ stopReason });
      };
      session.cancelRequested = false;
      session.active = { child, finish };

      const handleLine = (line: string): void => {
        const event = parseAntigravityStreamLine(line);
        if (!event) return;
        if (event.kind === "init") {
          if (event.conversationId) session.conversationId = event.conversationId;
          return;
        }
        if (event.kind === "step_update") {
          if (event.textDelta) {
            sawText = true;
            this.dispatchText(params.sessionId, event.textDelta);
          }
          return;
        }
        if (event.kind !== "result") return;
        if (event.conversationId) resultConversationId = event.conversationId;
        if (event.response && !sawText) {
          sawText = true;
          this.dispatchText(params.sessionId, event.response);
        }
        resultStopReason = stopReasonFor(event.status);
        if (isErrorStatus(event.status)) {
          resultError = new Error(event.response || `Antigravity request failed (${event.status})`);
        }
      };

      child.stdout.on("data", (chunk) => {
        lineBuffer += toText(chunk);
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      });
      child.stderr.on("data", (chunk) => {
        stderr += toText(chunk);
      });
      child.on("error", (error) => finish(error, "cancelled"));
      child.on("close", (code) => {
        if (lineBuffer) handleLine(lineBuffer);
        if (session.cancelRequested) {
          finish(null, "cancelled");
        } else if (resultError) {
          finish(resultError, resultStopReason);
        } else if (code !== null && code !== 0) {
          finish(
            new Error(stderr.trim() || `Antigravity exited with code ${String(code)}.`),
            "cancelled"
          );
        } else {
          finish(null, resultStopReason);
        }
      });

      try {
        child.stdin.write(
          `${JSON.stringify({ event: "user", message: { content: promptText(params.prompt) } })}\n`
        );
        // `agy --input-format stream-json` stays alive waiting for another
        // prompt. Quick Chat owns one request per child, so closing stdin
        // tells the CLI to finish this turn and exit after emitting `result`.
        child.stdin.end();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)), "cancelled");
      }
    });
  }

  async cancel(params: CancelInput): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session?.active) return;
    session.cancelRequested = true;
    session.active.child.kill();
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown Antigravity session ${params.sessionId}`);
    session.modelId = params.modelId;
    const state = this.stateFor(params.modelId);
    this.dispatch({
      sessionId: params.sessionId,
      update: { sessionUpdate: "state_changed", state },
    });
    return state;
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  async setSessionMode(_params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
    throw new MethodUnsupportedError("session/set_mode");
  }

  isSetSessionModeSupported(): boolean | null {
    return false;
  }

  async setSessionConfigOption(_params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState> {
    throw new MethodUnsupportedError("session/set_config_option");
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return false;
  }

  async listSessions(_params: ListSessionsInput): Promise<ListSessionsOutput> {
    throw new MethodUnsupportedError("session/list");
  }

  async resumeSession(_params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    throw new MethodUnsupportedError("session/resume");
  }

  async loadSession(_params: LoadSessionInput): Promise<LoadSessionOutput> {
    throw new MethodUnsupportedError("session/load");
  }

  supportsAdditionalDirectories(): boolean {
    return false;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      if (session.active) {
        session.cancelRequested = true;
        session.active.child.kill();
        session.active.finish(null, "cancelled");
      }
    }
    this.sessions.clear();
    this.sessionHandlers.clear();
    for (const listener of this.exitListeners) listener();
    this.exitListeners.clear();
  }

  private assertRunning(): void {
    if (this.shuttingDown) throw new Error("Antigravity backend has been shut down.");
  }

  private async ensureModelCatalog(): Promise<ReturnType<typeof parseAntigravityModels>> {
    if (this.modelCatalog) return this.modelCatalog;
    if (!this.modelCatalogPromise) {
      this.modelCatalogPromise = this.runModels()
        .then((stdout) => {
          const models = parseAntigravityModels(stdout);
          this.modelCatalog = models;
          return models;
        })
        .catch((error) => {
          throw new Error(`Unable to query Antigravity models: ${errorMessage(error)}`);
        })
        .finally(() => {
          this.modelCatalogPromise = null;
        });
    }
    return this.modelCatalogPromise;
  }

  private stateFor(modelId: string): BackendState {
    const models = this.modelCatalog ?? [];
    return {
      model: {
        current: { baseModelId: modelId, effort: null },
        availableModels: models.map((model) => ({
          baseModelId: model.modelId,
          name: model.name,
          description: model.description,
          provider: null,
          effortOptions: [],
        })),
        apply: { kind: "setModel" },
      },
      mode: null,
    };
  }

  private dispatchText(sessionId: SessionId, text: string): void {
    this.dispatch({
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });
  }

  private dispatch(event: SessionEvent): void {
    try {
      this.sessionHandlers.get(event.sessionId)?.(event);
    } catch {
      // A Quick Chat consumer throwing must not break the CLI reader.
    }
  }
}

function promptText(prompt: PromptInput["prompt"]): string {
  return prompt
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "resource_link") return `[resource: ${part.name ?? part.uri}]`;
      return `[image: ${part.mimeType}]`;
    })
    .join("\n");
}

function stopReasonFor(status: string | undefined): StopReason {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("cancel") || normalized.includes("abort")) return "cancelled";
  if (normalized.includes("refus")) return "refusal";
  if (normalized.includes("max")) return "max_tokens";
  return "end_turn";
}

function isErrorStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase() ?? "";
  return normalized.includes("error") || normalized.includes("fail");
}

function toText(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runAntigravityModels(
  binaryPath: string,
  envOverrides?: Record<string, string>
): Promise<string> {
  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const result = await new Promise<{ stdout: string }>((resolve, reject) => {
    const child = execFile(
      binaryPath,
      ["models"],
      {
        env: { ...process.env, ...(envOverrides ?? {}) },
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout) });
      }
    );
    // `agy models` completes its output but keeps the piped stdin open. Close
    // it explicitly because execFile does not inherit a terminal EOF.
    child.stdin?.end();
  });
  return String(result.stdout);
}

function spawnAntigravity(
  binaryPath: string,
  args: string[],
  options: AntigravitySpawnOptions
): AntigravityChildProcess {
  const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
  return spawn(binaryPath, args, options) as unknown as AntigravityChildProcess;
}
