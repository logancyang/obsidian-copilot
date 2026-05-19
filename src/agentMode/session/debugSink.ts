import { FileSystemAdapter } from "obsidian";

/**
 * Sidecar logger and payload formatter shared by every backend's debug tap.
 * The ACP runtime (`acp/debugTap.ts`) and the SDK adapter
 * (`sdk/sdkDebugTap.ts`) both feed `frameSink` so JSON-RPC and SDK turns
 * land in the same NDJSON file. `tag` distinguishes the source.
 */

export interface FrameRecord {
  ts: string;
  dir: "→" | "←";
  tag: string;
  kind: "request" | "notif" | "result" | "error" | "raw";
  method: string;
  id: string | null;
  payload: unknown;
}

const LOG_FILE_NAME = "acp-frames.ndjson";
const ROTATED_FILE_NAME = "acp-frames.old.ndjson";
const DESKTOP_UNAVAILABLE_PATH = "(Agent Mode frame logs are desktop-only)";
const LOG_DIR_PREFIX = ["obsidian-copilot", "acp-frames"] as const;
const ROTATE_BYTES = 50 * 1024 * 1024;
// Per-frame cap. Some backends (notably codex) re-emit the full cumulative
// tool output on every `tool_call_update`, so a single frame can exceed 1 MB.
// We replace the payload with a `__truncated` stub above this threshold.
const MAX_LINE_BYTES = 64 * 1024;
// Bound the in-flight write queue. Without this, a 160 fps frame storm pins
// hundreds of MB of stringified lines as closures in `writeChain`.
const MAX_QUEUE_FRAMES = 32;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
// Stat-based rotation check every N writes. With MAX_LINE_BYTES capped at
// 64 KB, the worst-case overshoot per check window is ~1.6 MB — well under
// any reasonable disk budget.
const ROTATE_CHECK_EVERY = 25;
const MAX_PAYLOAD_CHARS = 400;

export interface FrameLogPaths {
  dirPath: string;
  logPath: string;
  rotatedPath: string;
}

export interface NodeRuntime {
  tmpdir: () => string;
  join: (...parts: string[]) => string;
  dirname: (path: string) => string;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  appendFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
  writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
  rm: (path: string, opts: { force: boolean; recursive?: boolean }) => Promise<void>;
  stat: (path: string) => Promise<{ size: number }>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  openPath?: (path: string) => Promise<string | void>;
  showItemInFolder?: (path: string) => void;
}

export interface FrameSinkOptions {
  vaultBasePath?: string | null;
  runtime?: NodeRuntime | null;
}

/**
 * Sidecar logger for full backend frames. Writes are append-only NDJSON to
 * keep the file grep/jq-friendly. Writes are serialized through a single
 * promise chain so concurrent calls don't interleave partial lines.
 *
 * Rotation: every ROTATE_CHECK_EVERY writes, stat the file; if it exceeds
 * ROTATE_BYTES, rename to `.old.ndjson` (overwriting any prior `.old`) and
 * start a fresh file. Bounds disk use without losing the most recent session.
 */
export class FrameSink {
  private writeChain: Promise<void> = Promise.resolve();
  private ensuredDirPath: string | null = null;
  private writeCount = 0;
  private pendingFrames = 0;
  private pendingBytes = 0;
  private droppedSinceLastWrite = 0;

  constructor(private readonly options: FrameSinkOptions = {}) {}

  /** Return the current NDJSON log path, or a desktop-unavailable placeholder. */
  getPath(): string {
    return this.resolvePaths()?.logPath ?? DESKTOP_UNAVAILABLE_PATH;
  }

  /** Schedule a write. Returns immediately; failures are swallowed. */
  append(record: FrameRecord): void {
    const paths = this.resolvePaths();
    if (!paths) return;

    const line = this.toLine(record);

    // Backpressure: drop new frames when the queue is saturated. Without
    // this, bursty backends (codex emitting cumulative content at 160 fps)
    // pin hundreds of MB of stringified lines while the vault adapter
    // catches up.
    if (
      this.pendingFrames >= MAX_QUEUE_FRAMES ||
      this.pendingBytes + line.length > MAX_QUEUE_BYTES
    ) {
      this.droppedSinceLastWrite++;
      return;
    }

    const lineBytes = line.length;
    this.pendingFrames++;
    this.pendingBytes += lineBytes;

    this.writeChain = this.writeChain
      .then(() => this.doAppend(paths, line))
      .then(
        () => {
          this.pendingFrames--;
          this.pendingBytes -= lineBytes;
        },
        () => {
          this.pendingFrames--;
          this.pendingBytes -= lineBytes;
        }
      );
  }

  /** Delete the active and rotated log files after queued writes finish. */
  async clear(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return;
      const runtime = this.getRuntime();
      if (!runtime) return;
      await removeIfExists(runtime, paths.logPath);
      await removeIfExists(runtime, paths.rotatedPath);
    });
    this.writeChain = task.catch(() => {});
    return task;
  }

  /** Ensure the log exists and open it with the desktop file handler. */
  async open(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return;
      const runtime = this.getRuntime();
      if (!runtime) return;
      await this.ensureFolder(runtime, paths.dirPath);
      await ensureFileExists(runtime, paths.logPath);
    });
    this.writeChain = task.catch(() => {});
    await task;
    const paths = this.resolvePaths();
    if (!paths) return;
    const runtime = this.getRuntime();
    if (!runtime) return;
    if (runtime.openPath) {
      const errorMessage = await runtime.openPath(paths.logPath);
      if (typeof errorMessage === "string" && errorMessage.length > 0) {
        throw new Error(errorMessage);
      }
      return;
    }
    if (runtime.showItemInFolder) {
      runtime.showItemInFolder(paths.logPath);
      return;
    }
    throw new Error("No OS file opener is available.");
  }

  /** Wait for all queued writes to settle. Intended for tests and tooling. */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  private resolvePaths(): FrameLogPaths | null {
    const runtime = this.getRuntime();
    if (!runtime) return null;
    const vaultBasePath = this.options.vaultBasePath ?? getVaultBasePath();
    if (!vaultBasePath) return null;
    return getFrameLogPaths(vaultBasePath, runtime);
  }

  private getRuntime(): NodeRuntime | null {
    return this.options.runtime ?? getNodeRuntime();
  }

  private async ensureFolder(runtime: NodeRuntime, dirPath: string): Promise<void> {
    if (this.ensuredDirPath === dirPath) return;
    await runtime.mkdir(dirPath, { recursive: true });
    this.ensuredDirPath = dirPath;
  }

  /**
   * Serialize a record to a single NDJSON line, replacing payloads that
   * exceed MAX_LINE_BYTES with a `__truncated` stub so a single huge frame
   * can't dominate the queue or the on-disk file.
   */
  private toLine(record: FrameRecord): string {
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      // Payload not serializable (e.g. circular). Fall back to a stub so the
      // frame still shows up in the log.
      return (
        JSON.stringify({
          ...record,
          payload: { __unserializable: true },
        }) + "\n"
      );
    }

    if (line.length <= MAX_LINE_BYTES) return line;

    let payloadBytes = 0;
    try {
      payloadBytes = JSON.stringify(record.payload).length;
    } catch {
      payloadBytes = 0;
    }
    return (
      JSON.stringify({
        ...record,
        payload: {
          __truncated: true,
          originalBytes: payloadBytes,
          summary: summarizePayload(record.payload),
        },
      }) + "\n"
    );
  }

  private async doAppend(paths: FrameLogPaths, line: string): Promise<void> {
    const runtime = this.getRuntime();
    if (!runtime) return;

    // Surface dropped-frame counts inline so debugging-the-debugger is
    // possible without code reading. Reset BEFORE writing so concurrent
    // drops accumulate into the next note.
    let payload = line;
    if (this.droppedSinceLastWrite > 0) {
      const dropped = this.droppedSinceLastWrite;
      this.droppedSinceLastWrite = 0;
      const note =
        JSON.stringify({
          ts: new Date().toISOString(),
          dir: "→",
          tag: "frameSink",
          kind: "raw",
          method: "frameSink.dropped",
          id: null,
          payload: { dropped },
        }) + "\n";
      payload = note + line;
    }

    try {
      await this.ensureFolder(runtime, paths.dirPath);
      await runtime.appendFile(paths.logPath, payload, "utf8");
    } catch {
      // appendFile can fail if the directory was removed while a write was
      // queued; recreate the folder and write the frame as a fresh file.
      try {
        await runtime.mkdir(runtime.dirname(paths.logPath), { recursive: true });
        await runtime.writeFile(paths.logPath, payload, "utf8");
      } catch {
        return;
      }
    }

    this.writeCount++;
    if (this.writeCount % ROTATE_CHECK_EVERY === 0) {
      await this.maybeRotate(runtime, paths);
    }
  }

  private async maybeRotate(runtime: NodeRuntime, paths: FrameLogPaths): Promise<void> {
    try {
      const stat = await runtime.stat(paths.logPath);
      if (stat.size < ROTATE_BYTES) return;
      await removeIfExists(runtime, paths.rotatedPath);
      await runtime.rename(paths.logPath, paths.rotatedPath);
    } catch {
      // ignore
    }
  }
}

/** Build the per-vault temp NDJSON paths used by the full-frame sink. */
export function getFrameLogPaths(vaultBasePath: string, runtime: NodeRuntime): FrameLogPaths {
  const vaultHash = stableHash(vaultBasePath);
  const dirPath = runtime.join(runtime.tmpdir(), ...LOG_DIR_PREFIX, vaultHash);
  return {
    dirPath,
    logPath: runtime.join(dirPath, LOG_FILE_NAME),
    rotatedPath: runtime.join(dirPath, ROTATED_FILE_NAME),
  };
}

function getVaultBasePath(): string | null {
  if (typeof app === "undefined") return null;
  const adapter = app.vault?.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return adapter.getBasePath();
}

function getNodeRuntime(): NodeRuntime | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs/promises") as typeof import("node:fs/promises");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as {
      shell?: {
        openPath?: (path: string) => Promise<string>;
        showItemInFolder?: (path: string) => void;
      };
      remote?: {
        shell?: {
          openPath?: (path: string) => Promise<string>;
          showItemInFolder?: (path: string) => void;
        };
      };
    };
    const shell = electron.shell ?? electron.remote?.shell;
    return {
      tmpdir: () => os.tmpdir(),
      join: (...segs: string[]) => path.join(...segs),
      dirname: (p: string) => path.dirname(p),
      mkdir: async (dirPath, opts) => {
        await fs.mkdir(dirPath, opts);
      },
      appendFile: fs.appendFile,
      writeFile: fs.writeFile,
      rm: fs.rm,
      stat: fs.stat,
      rename: fs.rename,
      openPath: shell?.openPath?.bind(shell),
      showItemInFolder: shell?.showItemInFolder?.bind(shell),
    };
  } catch {
    return null;
  }
}

async function ensureFileExists(runtime: NodeRuntime, path: string): Promise<void> {
  try {
    await runtime.stat(path);
  } catch {
    await runtime.writeFile(path, "", "utf8");
  }
}

async function removeIfExists(runtime: NodeRuntime, path: string): Promise<void> {
  try {
    await runtime.rm(path, { force: true });
  } catch {
    // ignore — file already gone or adapter unavailable
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Best-effort one-line summary for a truncated payload. Keeps the most
 * useful identifying fields (`sessionUpdate`, `toolCallId`, `method`) so a
 * truncated frame still tells the reader which call it belonged to.
 */
function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload);
  const obj = payload as Record<string, unknown>;
  const update = obj.update as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (typeof obj.method === "string") parts.push(`method=${obj.method}`);
  if (update && typeof update.sessionUpdate === "string") {
    parts.push(`sessionUpdate=${update.sessionUpdate}`);
    if (typeof update.toolCallId === "string") parts.push(`toolCallId=${update.toolCallId}`);
  }
  return parts.join(" ") || "<no summary>";
}

export const frameSink = new FrameSink();

/**
 * Stringify a payload for the truncated console log. Returns "" for
 * undefined so the log line stays compact.
 */
export function formatPayload(value: unknown): string {
  if (value === undefined) return "";
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    s =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : Object.prototype.toString.call(value);
  }
  if (s.length <= MAX_PAYLOAD_CHARS) return s;
  return s.slice(0, MAX_PAYLOAD_CHARS) + `…(+${s.length - MAX_PAYLOAD_CHARS})`;
}
