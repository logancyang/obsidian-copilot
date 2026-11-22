import { MCP_CLIENT_INFO } from "@/connectors/connectorTools";
import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ResultSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

type ChildProcess = import("node:child_process").ChildProcessWithoutNullStreams;

export interface StdioServerOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

// npx and uvx may download a server before it starts.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/862
export const START_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 3_000;
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;
const MAX_REASON_LENGTH = 200;

export class StdioServer {
  private readonly client = new Client(MCP_CLIENT_INFO);
  private readonly transport: ChildProcessTransport;
  private ready = false;

  constructor(options: StdioServerOptions, onCrash: (reason: string) => void) {
    this.transport = new ChildProcessTransport(options, (reason) => {
      if (this.ready) onCrash(reason);
    });
  }

  async start(): Promise<void> {
    // npx and uvx download a server before it answers, which can outlast the SDK's 60-second default.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    await this.withExitReason(() =>
      this.client.connect(this.transport, { timeout: START_TIMEOUT_MS })
    );
    this.ready = true;
  }

  request(
    method: string,
    params: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<Record<string, unknown>> {
    return this.withExitReason(() =>
      this.client.request({ method, params }, ResultSchema, options)
    );
  }

  stop(): Promise<void> {
    return this.transport.close();
  }

  private async withExitReason<T>(send: () => Promise<T>): Promise<T> {
    try {
      return await send();
    } catch (error) {
      // The SDK reports a server that exited as a closed connection, while its last stderr line says why.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
      const reason = this.transport.exitReason;
      throw reason === null ? error : new Error(reason);
    }
  }
}

class ChildProcessTransport implements Transport {
  onclose?: () => void;
  onmessage?: (message: JSONRPCMessage) => void;
  exitReason: string | null = null;
  private child: ChildProcess | null = null;
  private closed: Promise<void> = Promise.resolve();
  private readonly buffer = new ReadBuffer();
  private lastStderrLine = "";
  private stopping = false;

  constructor(
    private readonly options: StdioServerOptions,
    private readonly onExit: (reason: string) => void
  ) {}

  async start(): Promise<void> {
    const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
    const { command, args, env, cwd } = this.options;
    const file = process.platform === "win32" ? findWindowsCommand(command, env, cwd) : command;
    if (file === null) {
      const reason = `Couldn't find ${command}.`;
      this.finish(reason);
      throw new Error(reason);
    }
    // Windows starts .cmd shims such as npx.cmd only through cmd.exe, which would split and expand arguments that aren't quoted for it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    const viaCmd = /\.(?:cmd|bat)$/i.test(file);
    const child = spawn(
      viaCmd ? (process.env.ComSpec ?? "cmd.exe") : file,
      viaCmd ? cmdShellArgs(file, args) : [...args],
      {
        cwd,
        env,
        stdio: "pipe",
        windowsHide: true,
        windowsVerbatimArguments: viaCmd,
        // Servers started through npx or uvx run in child processes of their own, which only a process group lets Copilot stop together.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
        detached: process.platform !== "win32",
      }
    );
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk
        .toString("utf8")
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .pop();
      if (line) this.lastStderrLine = line.slice(0, MAX_REASON_LENGTH);
    });
    child.stdin.on("error", (error) => logWarn(`[Connectors] ${command} closed its input`, error));
    // A crashed server's own child processes would keep its output open, so they stop with it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    child.on("exit", () => {
      if (!this.stopping) killTree(child, "SIGTERM");
    });
    this.closed = new Promise((resolve) => {
      child.on("close", (code: number | null, signal: string | null) => {
        this.finish(code === null ? `It stopped (${signal}).` : `It exited with code ${code}.`);
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.on("error", (error: NodeJS.ErrnoException) => {
        const reason = error.code === "ENOENT" ? `Couldn't find ${command}.` : error.message;
        this.finish(reason);
        reject(new Error(reason));
      });
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.child?.stdin.write(serializeMessage(message));
  }

  close(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child && this.exitReason === null) {
      killTree(child, "SIGTERM");
      const forceStop = window.setTimeout(() => killTree(child, "SIGKILL"), STOP_GRACE_MS);
      void this.closed.then(() => window.clearTimeout(forceStop));
    }
    return this.closed;
  }

  private read(chunk: Buffer): void {
    try {
      this.buffer.append(chunk);
    } catch (error) {
      logWarn(`[Connectors] ${this.options.command} sent too much output at once`, error);
      return;
    }
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.buffer.readMessage();
      } catch {
        // Some servers log to stdout, and those lines carry no message.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
        continue;
      }
      if (!message) return;
      this.onmessage?.(message);
    }
  }

  private finish(fallbackReason: string): void {
    if (this.exitReason !== null) return;
    this.exitReason = this.lastStderrLine || fallbackReason;
    this.onclose?.();
    if (!this.stopping) this.onExit(this.exitReason);
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      requireNodeModule<typeof import("node:child_process")>("child_process").execFile(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        () => {}
      );
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      logWarn("[Connectors] Couldn't stop a connector's processes", error);
    }
  }
}

function findWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined
): string | null {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const extensions = (windowsEnvValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .toUpperCase()
    .split(";");
  const candidates = extensions.includes(path.extname(command).toUpperCase())
    ? [command]
    : extensions.map((extension) => command + extension);
  const dirs = /[\\/]/.test(command)
    ? [cwd ?? ""]
    : (windowsEnvValue(env, "PATH") ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const file = path.resolve(dir, candidate);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

function windowsEnvValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  // Windows names are case-insensitive, and Node passes the child the first match in sorted order.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
  const key = Object.keys(env)
    .sort()
    .find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function cmdShellArgs(file: string, args: readonly string[]): string[] {
  // A .cmd shim hands its arguments to a second command line, which strips one more round of ^ escapes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
  const line = [quoteForCmd(file, 1), ...args.map((arg) => quoteForCmd(arg, 2))].join(" ");
  return ["/d", "/s", "/c", `"${line}"`];
}

function quoteForCmd(value: string, rounds: number): string {
  let quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  for (let round = 0; round < rounds; round++) quoted = quoted.replace(CMD_METACHARACTERS, "^$1");
  return quoted;
}
