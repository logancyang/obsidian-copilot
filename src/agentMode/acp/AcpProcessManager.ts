import { logError, logInfo, logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { NdjsonLineSplitter } from "./debugTap";

type ChildProcessByStdio = import("node:child_process").ChildProcessByStdio<
  Writable,
  Readable,
  Readable
>;
type Readable = import("node:stream").Readable;
type Writable = import("node:stream").Writable;

const SIGTERM_GRACE_MS = 3_000;

export interface AcpProcessManagerOptions {
  /** Absolute path to the agent backend binary (e.g. opencode). */
  command: string;
  /** Process arguments. */
  args: string[];
  /** Environment for the child. Pass through `process.env` plus any overrides. */
  env: NodeJS.ProcessEnv;
  /** Tag used in stderr/log lines so multiple agents can be distinguished. */
  logTag?: string;
}

/**
 * Spawns and supervises the ACP-speaking agent backend subprocess. Exposes
 * the child's stdin/stdout as Web Streams (suitable for
 * `@agentclientprotocol/sdk`'s `ndJsonStream`) and pipes stderr line-by-line
 * into the Copilot logger.
 *
 * Single-shot: `start()` may only be called once. Use `shutdown()` for a
 * graceful SIGTERM→SIGKILL teardown.
 */
export class AcpProcessManager {
  private child: ChildProcessByStdio | null = null;
  private exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private hasExited = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  constructor(private readonly opts: AcpProcessManagerOptions) {}

  /**
   * Spawn the child and return its stdin/stdout as Web Streams. Stderr is
   * consumed internally and routed to the logger; callers don't see it.
   */
  start(): { stdin: WritableStream<Uint8Array>; stdout: ReadableStream<Uint8Array> } {
    if (this.child) {
      throw new Error("AcpProcessManager already started");
    }
    const tag = this.opts.logTag ?? "acp";
    const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
    const { Readable, Writable } = requireNodeModule<typeof import("node:stream")>("stream");
    logInfo(`[AgentMode] spawning ${this.opts.command} ${this.opts.args.join(" ")} (tag=${tag})`);
    const child = spawn(this.opts.command, this.opts.args, {
      env: this.opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.on("error", (err) => {
      logError(`[AgentMode] subprocess error (${tag})`, err);
    });
    child.on("exit", (code, signal) => {
      this.hasExited = true;
      this.exitCode = code;
      this.exitSignal = signal;
      logInfo(`[AgentMode] subprocess exit (${tag}) code=${code} signal=${signal}`);
      for (const fn of this.exitListeners) {
        try {
          fn(code, signal);
        } catch (e) {
          logWarn(`[AgentMode] exit listener threw`, e);
        }
      }
    });

    pipeStderrToLogger(child.stderr, tag);

    // Bridge Node streams → Web Streams for `@agentclientprotocol/sdk`'s
    // `ndJsonStream`. `toWeb` is Node ≥17 (Electron 27 ships Node 18), but
    // missing from the older `@types/node` this project pins, hence the
    // cast.
    const writableToWeb = (
      Writable as unknown as {
        toWeb: (s: NodeJS.WritableStream) => WritableStream<Uint8Array>;
      }
    ).toWeb;
    const readableToWeb = (
      Readable as unknown as {
        toWeb: (s: NodeJS.ReadableStream) => ReadableStream<Uint8Array>;
      }
    ).toWeb;
    return {
      stdin: writableToWeb(child.stdin),
      stdout: sanitizeAcpStdout(readableToWeb(child.stdout)),
    };
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    if (this.hasExited) {
      // Fire synchronously so callers don't miss the event when subscribing
      // after exit (e.g. crash before they wired up).
      try {
        listener(this.exitCode, this.exitSignal);
      } catch (e) {
        logWarn(`[AgentMode] exit listener threw`, e);
      }
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  isRunning(): boolean {
    return this.child !== null && !this.hasExited;
  }

  /**
   * Send SIGTERM, wait up to SIGTERM_GRACE_MS, then escalate to SIGKILL if
   * the child is still alive. Resolves once the child has exited (or
   * immediately if it already had).
   */
  async shutdown(): Promise<void> {
    if (!this.child || this.hasExited) return;
    const child = this.child;
    const tag = this.opts.logTag ?? "acp";

    const exited = new Promise<void>((resolve) => {
      this.onExit(() => resolve());
    });

    try {
      child.kill("SIGTERM");
    } catch (e) {
      logWarn(`[AgentMode] SIGTERM failed (${tag})`, e);
    }

    const timeout = new Promise<"timeout">((resolve) =>
      window.setTimeout(() => resolve("timeout"), SIGTERM_GRACE_MS)
    );
    const winner = await Promise.race([exited.then(() => "exited" as const), timeout]);
    if (winner === "timeout" && !this.hasExited) {
      logWarn(`[AgentMode] subprocess (${tag}) did not exit within ${SIGTERM_GRACE_MS}ms; SIGKILL`);
      try {
        child.kill("SIGKILL");
      } catch (e) {
        logWarn(`[AgentMode] SIGKILL failed (${tag})`, e);
      }
      await exited;
    }
  }
}

/**
 * CSI (colors, cursor moves) and OSC (window title) escape sequences. Agent
 * binaries and their plugins write these to stdout for a human terminal;
 * anything prefixed to a JSON-RPC envelope makes `JSON.parse` throw, and the
 * SDK's `ndJsonStream` drops such frames silently — which strands Agent Mode
 * when the decorated frame is the initialization response.
 * See https://github.com/logancyang/obsidian-copilot/issues/2876.
 *
 * The CSI parameter class spans the full `0x30`-`0x3f` range ECMA-48 allows,
 * not just digits and `;`: truecolor sequences such as `\x1b[38:2:255:0:0m`
 * use `:`, and private forms use `<`, `=`, `>`, `?`.
 */
// eslint-disable-next-line no-control-regex -- CSI/OSC sequences are defined by \x1b control bytes
const TERMINAL_ESCAPE_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Strip terminal escape sequences from an NDJSON byte stream so downstream
 * consumers see parseable JSON-RPC frames. Buffering to newline boundaries
 * also keeps a sequence intact when the child splits it across two chunks.
 *
 * @param inner The child's raw stdout as a Web stream.
 */
export function sanitizeAcpStdout(inner: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  // Hand-rolled instead of `pipeThrough(new TransformStream())`: `inner`
  // comes from Node's `Readable.toWeb()` and mixing it with a global-realm
  // stream throws `ERR_INVALID_ARG_TYPE`.
  const reader = inner.getReader();
  const encoder = new TextEncoder();
  let enqueued = 0;
  let splitter: NdjsonLineSplitter;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      splitter = new NdjsonLineSplitter((line) => {
        const cleaned = line.replace(TERMINAL_ESCAPE_SEQUENCE, "").trim();
        if (!cleaned) return;
        controller.enqueue(encoder.encode(`${cleaned}\n`));
        enqueued += 1;
      });
    },
    async pull(controller) {
      // Keep reading until a whole frame is ready: a chunk that ends
      // mid-frame would otherwise leave the consumer waiting forever.
      enqueued = 0;
      while (enqueued === 0) {
        const { value, done } = await reader.read();
        if (done) {
          splitter.flush();
          controller.close();
          return;
        }
        if (value) splitter.push(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function pipeStderrToLogger(stderr: Readable, tag: string): void {
  let buffer = "";
  stderr.setEncoding("utf-8");
  stderr.on("data", (chunk: string) => {
    buffer += chunk;
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nlIdx).trimEnd();
      buffer = buffer.slice(nlIdx + 1);
      if (line) emitStderrLine(line, tag);
    }
  });
  stderr.on("end", () => {
    if (buffer.trim()) emitStderrLine(buffer.trim(), tag);
  });
}

function emitStderrLine(line: string, tag: string): void {
  // Heuristic: lines starting with "error" / "ERROR" / "fatal" go to error,
  // everything else stays at info. We don't want to drown the user log in
  // opencode's noisy debug output, so warnings stay warnings.
  const lower = line.toLowerCase();
  if (lower.startsWith("error") || lower.startsWith("fatal")) {
    logError(`[AgentMode][${tag}] ${line}`);
  } else if (lower.startsWith("warn")) {
    logWarn(`[AgentMode][${tag}] ${line}`);
  } else {
    logInfo(`[AgentMode][${tag}] ${line}`);
  }
}
