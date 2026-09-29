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
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  logTag?: string;
}

export class AcpProcessManager {
  private child: ChildProcessByStdio | null = null;
  private exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  private hasExited = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  constructor(private readonly opts: AcpProcessManagerOptions) {}

  start(): { stdin: WritableStream<Uint8Array>; stdout: ReadableStream<Uint8Array> } {
    if (this.child) {
      throw new Error("AcpProcessManager already started");
    }
    const tag = this.opts.logTag ?? "acp";
    const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
    const { Readable, Writable } = requireNodeModule<typeof import("node:stream")>("stream");
    logInfo(`[AgentMode] spawning ${this.opts.command} ${this.opts.args.join(" ")} (tag=${tag})`);
    const child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
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

// Escape sequences prefixed to a JSON-RPC line make the SDK drop the frame and strand
// initialization. The CSI parameter class spans `0x30`-`0x3f` (truecolor uses `:`). https://github.com/logancyang/obsidian-copilot/issues/2876
// eslint-disable-next-line no-control-regex -- CSI/OSC sequences are defined by \x1b control bytes
const TERMINAL_ESCAPE_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function sanitizeAcpStdout(inner: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
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
  const lower = line.toLowerCase();
  if (lower.startsWith("error") || lower.startsWith("fatal")) {
    logError(`[AgentMode][${tag}] ${line}`);
  } else if (lower.startsWith("warn")) {
    logWarn(`[AgentMode][${tag}] ${line}`);
  } else {
    logInfo(`[AgentMode][${tag}] ${line}`);
  }
}
