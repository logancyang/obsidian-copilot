import { requireNodeModule } from "@/utils/desktopRuntime";

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
// Owner-only modes: the log holds full prompt/tool/note content in plaintext,
// and on Linux os.tmpdir() can be a world-readable shared /tmp.
// https://github.com/logancyang/obsidian-copilot-preview/issues/250
const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;
const ROTATE_BYTES = 50 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_QUEUE_FRAMES = 32;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const ROTATE_CHECK_EVERY = 25;
const MAX_PAYLOAD_CHARS = 400;

export interface FrameLogPaths {
  dirPath: string;
  logPath: string;
  rotatedPath: string;
}

export interface RuntimeLstat {
  uid: number;
  mode: number;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface NodeRuntime {
  tmpdir: () => string;
  join: (...parts: string[]) => string;
  dirname: (path: string) => string;
  mkdir: (path: string, opts: { recursive: boolean; mode: number }) => Promise<void>;
  appendFile: (
    path: string,
    data: string,
    opts: { encoding: "utf8"; mode: number }
  ) => Promise<void>;
  writeFile: (
    path: string,
    data: string,
    opts: { encoding: "utf8"; mode: number }
  ) => Promise<void>;
  rm: (path: string, opts: { force: boolean; recursive?: boolean }) => Promise<void>;
  stat: (path: string) => Promise<{ size: number }>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  lstat: (path: string) => Promise<RuntimeLstat>;
  getuid?: () => number;
  openPath?: (path: string) => Promise<string | void>;
  showItemInFolder?: (path: string) => void;
}

export interface FrameSinkOptions {
  vaultBasePath?: string | null;
  runtime?: NodeRuntime | null;
}

let seededVaultBasePath: string | null = null;

export function setFrameSinkVaultBasePath(basePath: string | null): void {
  seededVaultBasePath = basePath;
}

export class FrameSink {
  private writeChain: Promise<void> = Promise.resolve();
  private ensuredDirPath: string | null = null;
  private writeCount = 0;
  private pendingFrames = 0;
  private pendingBytes = 0;
  private droppedSinceLastWrite = 0;

  constructor(private readonly options: FrameSinkOptions = {}) {}

  getPath(): string {
    return this.resolvePaths()?.logPath ?? DESKTOP_UNAVAILABLE_PATH;
  }

  append(record: FrameRecord): void {
    const paths = this.resolvePaths();
    if (!paths) return;

    const line = this.toLine(record);

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

  async clear(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return;
      const runtime = this.getRuntime();
      if (!runtime) return;
      // Same safety gate as writes: a squatted directory must not let Clear
      // delete files at an attacker-chosen location.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/250
      await this.ensureFolder(runtime, paths);
      await removeIfExists(runtime, paths.logPath);
      await removeIfExists(runtime, paths.rotatedPath);
    });
    this.writeChain = task.catch(() => {});
    return task;
  }

  async open(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return;
      const runtime = this.getRuntime();
      if (!runtime) return;
      await this.ensureFolder(runtime, paths);
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

  async flush(): Promise<void> {
    await this.writeChain;
  }

  /**
   * Runs the owner and mode checks of `ensureFolder()` so a reader cannot be handed a path
   * another account planted on a shared temp root; null when the path cannot be vouched for.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/250
   */
  async getValidatedPath(): Promise<string | null> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return null;
      const runtime = this.getRuntime();
      if (!runtime) return null;
      await this.ensureFolder(runtime, paths);
      return paths.logPath;
    });
    const settled = task.catch(() => null);
    this.writeChain = settled.then(() => {});
    return settled;
  }

  /**
   * Narrows logs an older build left world-readable even when logging is now off, without
   * creating the directory chain for users who never log.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/250
   */
  async narrowLegacyLogs(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      const runtime = this.getRuntime();
      if (!paths || !runtime) return;
      for (const target of [paths.logPath, paths.rotatedPath]) {
        try {
          await narrowExistingFile(runtime, target, getPosixOwnerUid(runtime));
        } catch {
          // Each generation stands alone: one this sink must refuse, or a
          // runtime that cannot report its uid, says nothing about the other,
          // which may still hold the user's own plaintext. Startup must not
          // fail over a diagnostic log either, so nothing propagates.
        }
      }
    });
    this.writeChain = task;
    return task;
  }

  private resolvePaths(): FrameLogPaths | null {
    const runtime = this.getRuntime();
    if (!runtime) return null;
    const vaultBasePath = this.options.vaultBasePath ?? seededVaultBasePath;
    if (!vaultBasePath) return null;
    return getFrameLogPaths(vaultBasePath, runtime);
  }

  private getRuntime(): NodeRuntime | null {
    return this.options.runtime ?? getNodeRuntime();
  }

  /**
   * Validates every level of the temp-path chain top-down; the sticky-bit parent only protects
   * the first level. Throws when the location cannot be made safe.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/250
   */
  private async ensureFolder(runtime: NodeRuntime, paths: FrameLogPaths): Promise<void> {
    if (this.ensuredDirPath === paths.dirPath) return;

    await validateTempRoot(runtime);
    const framesRoot = runtime.dirname(paths.dirPath);
    const appRoot = runtime.dirname(framesRoot);
    const ownerUid = getPosixOwnerUid(runtime);
    for (const level of [appRoot, framesRoot, paths.dirPath]) {
      await ensurePrivateDirectory(runtime, level, ownerUid);
    }
    await narrowExistingFile(runtime, paths.logPath, ownerUid);
    await narrowExistingFile(runtime, paths.rotatedPath, ownerUid);

    this.ensuredDirPath = paths.dirPath;
  }

  private toLine(record: FrameRecord): string {
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
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
      await this.ensureFolder(runtime, paths);
      await runtime.appendFile(paths.logPath, payload, {
        encoding: "utf8",
        mode: LOG_FILE_MODE,
      });
    } catch {
      // Drop the frame and forget the validated directory, so the next frame
      // re-runs the full safety check (and recreates a deleted folder). A
      // recovery write here would bypass the validation that just failed and
      // could land the log outside the owner-only directory.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/250
      this.ensuredDirPath = null;
      return;
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

export function getFrameLogPaths(vaultBasePath: string, runtime: NodeRuntime): FrameLogPaths {
  const vaultHash = stableHash(vaultBasePath);
  const dirPath = runtime.join(runtime.tmpdir(), ...LOG_DIR_PREFIX, vaultHash);
  return {
    dirPath,
    logPath: runtime.join(dirPath, LOG_FILE_NAME),
    rotatedPath: runtime.join(dirPath, ROTATED_FILE_NAME),
  };
}

function getNodeRuntime(): NodeRuntime | null {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const os = requireNodeModule<typeof import("node:os")>("os");
    const path = requireNodeModule<typeof import("node:path")>("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell support is optional and resolved with the same lazy desktop boundary
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
      chmod: fs.chmod,
      lstat: async (p) => {
        const st = await fs.lstat(p);
        return {
          uid: st.uid,
          mode: st.mode,
          isDirectory: st.isDirectory(),
          isSymbolicLink: st.isSymbolicLink(),
        };
      },
      getuid: process.getuid ? () => process.getuid() : undefined,
      openPath: shell?.openPath?.bind(shell),
      showItemInFolder: shell?.showItemInFolder?.bind(shell),
    };
  } catch {
    return null;
  }
}

/**
 * A failure other than "not found" is rethrown so an unreadable path is not answered with
 * a fresh file at an unvalidated location.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
async function ensureFileExists(runtime: NodeRuntime, path: string): Promise<void> {
  try {
    await runtime.lstat(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await runtime.writeFile(path, "", { encoding: "utf8", mode: LOG_FILE_MODE });
  }
}

/**
 * `null` on win32, where per-user %TEMP% already isolates; a POSIX runtime that cannot
 * report its uid fails closed.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
function getPosixOwnerUid(runtime: NodeRuntime): number | null {
  if (process.platform === "win32") return null;
  const uid = runtime.getuid?.();
  if (uid === undefined) {
    throw new Error("Cannot verify frame-log directory ownership on this platform.");
  }
  return uid;
}

/**
 * Best-effort: protects against symlink squatting and world-readable temp roots, not against
 * the same account, a shared TMPDIR without sticky bit, or NFS/FUSE uid spoofing.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
async function validateTempRoot(runtime: NodeRuntime): Promise<void> {
  if (process.platform === "win32") return;

  const tmpRoot = runtime.tmpdir();
  const entry = await runtime.lstat(tmpRoot);
  if (entry.isSymbolicLink || !entry.isDirectory) {
    throw new Error("Frame log temp root must be a real directory.");
  }

  const ownerUid = getPosixOwnerUid(runtime);
  if (ownerUid !== null && entry.uid !== ownerUid && entry.uid !== 0) {
    throw new Error("Frame log temp root is owned by another user.");
  }

  const sharedWritable = (entry.mode & 0o022) !== 0;
  if (sharedWritable && (entry.mode & 0o1000) === 0) {
    throw new Error("Frame log temp root is group/world-writable without a sticky bit.");
  }
}

/**
 * A squatting symlink is unlinked and replaced (the redirect vector; no content lost). Any
 * other occupant aborts because its owner may still need it.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
async function ensurePrivateDirectory(
  runtime: NodeRuntime,
  path: string,
  ownerUid: number | null
): Promise<void> {
  let entry: RuntimeLstat | null;
  try {
    entry = await runtime.lstat(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    entry = null;
  }
  if (entry?.isSymbolicLink) {
    await runtime.rm(path, { force: true });
    entry = null;
  }
  if (entry && !entry.isDirectory) {
    throw new Error("Frame log path is occupied by a file.");
  }
  if (!entry) {
    await runtime.mkdir(path, { recursive: true, mode: LOG_DIR_MODE });
    entry = await runtime.lstat(path);
    if (entry.isSymbolicLink || !entry.isDirectory) {
      throw new Error("Frame log path could not be made a real directory.");
    }
  }
  if (ownerUid === null) return;
  // On a shared temp root, only the first local account to run the plugin gets
  // a frame log: it creates `<tmp>/obsidian-copilot` owner-only, and every
  // later account stops here. Frame logging is opt-in diagnostics, so those
  // accounts lose a debug aid rather than a feature.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/250
  if (entry.uid !== ownerUid) {
    throw new Error("Frame log directory is owned by another user.");
  }
  if ((entry.mode & 0o7777) !== LOG_DIR_MODE) {
    await runtime.chmod(path, LOG_DIR_MODE);
  }
}

/**
 * chmod cannot revoke descriptors opened while the file was world-readable, and there is no
 * isFile() check: cross-UID planting is blocked by the 0700 directory chain, and same-UID
 * processes are outside the threat model.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
async function narrowExistingFile(
  runtime: NodeRuntime,
  path: string,
  ownerUid: number | null
): Promise<void> {
  let entry: RuntimeLstat;
  try {
    entry = await runtime.lstat(path);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  if (entry.isSymbolicLink) {
    await runtime.rm(path, { force: true });
    return;
  }
  if (entry.isDirectory) {
    throw new Error("Frame log file path is a directory.");
  }
  if (ownerUid === null) return;
  if (entry.uid !== ownerUid) {
    throw new Error("Frame log file is owned by another user.");
  }
  await runtime.chmod(path, LOG_FILE_MODE);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
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
