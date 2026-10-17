import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { byteLength } from "@/utils/logTail";
import { fitConversationFrames } from "@/utils/frameLogBudget";
import { MAX_REDACTABLE_LOG_BYTES } from "@/utils/issueReport";

export interface FrameRecord {
  ts: string;
  dir: "→" | "←";
  tag: string;
  kind: "request" | "notif" | "result" | "error" | "raw";
  method: string;
  id: string | null;
  payload: unknown;
  sessionId?: string | null;
  startsConversation?: true;
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
const SESSION_FILE_PREFIX = "session-";
const FILE_SUFFIX = ".ndjson";
const BACKGROUND_FILE_NAME = "background.ndjson";
const MAX_CONVERSATIONS = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const RETAINED_FILE_BYTES = 3 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_QUEUE_FRAMES = 32;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
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
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>;
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
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
  private readonly fileBytes = new Map<string, number>();
  private pendingFrames = 0;
  private pendingBytes = 0;
  private droppedSinceLastWrite = 0;

  constructor(private readonly options: FrameSinkOptions = {}) {}

  getPath(): string {
    return this.resolvePaths()?.dirPath ?? DESKTOP_UNAVAILABLE_PATH;
  }

  append(record: FrameRecord): void {
    const paths = this.resolvePaths();
    if (!paths) return;

    const line = this.toLine(record);

    if (
      this.pendingFrames >= MAX_QUEUE_FRAMES ||
      this.pendingBytes + byteLength(line) > MAX_QUEUE_BYTES
    ) {
      this.droppedSinceLastWrite++;
      return;
    }

    const lineBytes = byteLength(line);
    this.pendingFrames++;
    this.pendingBytes += lineBytes;

    this.writeChain = this.writeChain
      .then(() => this.doAppend(paths, line, record))
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
      const files = await listLogFiles(runtime, paths.dirPath);
      for (const name of [...files, LOG_FILE_NAME, ROTATED_FILE_NAME]) {
        await removeIfExists(runtime, runtime.join(paths.dirPath, name));
      }
      this.fileBytes.clear();
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
    });
    this.writeChain = task.catch(() => {});
    await task;
    const paths = this.resolvePaths();
    if (!paths) return;
    const runtime = this.getRuntime();
    if (!runtime) return;
    if (runtime.openPath) {
      const errorMessage = await runtime.openPath(paths.dirPath);
      if (typeof errorMessage === "string" && errorMessage.length > 0) {
        throw new Error(errorMessage);
      }
      return;
    }
    if (runtime.showItemInFolder) {
      runtime.showItemInFolder(paths.dirPath);
      return;
    }
    throw new Error("No OS file opener is available.");
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  // Whole snapshots let report redaction run before any frame is omitted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/658
  async readConversations(): Promise<string | null> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      const runtime = this.getRuntime();
      if (!paths || !runtime) return null;
      await this.ensureFolder(runtime, paths);
      const sessions = (await newestConversationFiles(runtime, paths.dirPath))
        .slice(0, MAX_CONVERSATIONS)
        .reverse();
      let names: string[];
      try {
        names = await runtime.readdir(paths.dirPath);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        names = [];
      }
      const sections: string[] = [];
      if (sessions.length === 0 && names.includes(LOG_FILE_NAME)) {
        await narrowExistingFile(runtime, paths.logPath, getPosixOwnerUid(runtime));
        const legacyStat = await runtime.stat(paths.logPath);
        const backgroundPath = runtime.join(paths.dirPath, BACKGROUND_FILE_NAME);
        let bgSize = 0;
        try {
          await narrowExistingFile(runtime, backgroundPath, getPosixOwnerUid(runtime));
          bgSize = (await runtime.stat(backgroundPath)).size;
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
        const headerBytes =
          byteLength(sectionHeader(LOG_FILE_NAME)) +
          (bgSize ? byteLength(sectionHeader(BACKGROUND_FILE_NAME)) + 1 : 0);
        if (
          legacyStat.size > 0 &&
          legacyStat.size + bgSize + headerBytes > MAX_REDACTABLE_LOG_BYTES
        ) {
          sections.push(
            sectionHeader(LOG_FILE_NAME) +
              JSON.stringify({
                frameSink: "omitted",
                reason: "legacy log exceeds the report read limit; available through Open",
              }) +
              "\n"
          );
        } else if (legacyStat.size > 0) {
          sections.push(
            sectionHeader(LOG_FILE_NAME) + (await runtime.readFile(paths.logPath, "utf8"))
          );
        }
      }
      for (const file of sessions) {
        const name = file.split(/[\\/]/).pop()!;
        await narrowExistingFile(runtime, file, getPosixOwnerUid(runtime));
        const text = await runtime.readFile(file, "utf8");
        if (text) sections.push(sectionHeader(name) + text);
      }
      const background = runtime.join(paths.dirPath, BACKGROUND_FILE_NAME);
      await narrowExistingFile(runtime, background, getPosixOwnerUid(runtime));
      try {
        const text = await runtime.readFile(background, "utf8");
        if (text) sections.push(sectionHeader(BACKGROUND_FILE_NAME) + text);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
      return sections.length
        ? sections
            .map((section, index) =>
              index < sections.length - 1 && !section.endsWith("\n") ? section + "\n" : section
            )
            .join("")
        : null;
    });
    const settled = task.catch(() => {
      this.ensuredDirPath = null;
      this.fileBytes.clear();
      return null;
    });
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
        } catch (error) {
          logWarn("[AgentMode] Could not narrow debug log permissions", error);
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

    if (byteLength(line) <= MAX_LINE_BYTES) return line;

    let payloadBytes = 0;
    try {
      payloadBytes = byteLength(JSON.stringify(record.payload));
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

  private async doAppend(paths: FrameLogPaths, line: string, record: FrameRecord): Promise<void> {
    const runtime = this.getRuntime();
    if (!runtime) return;
    try {
      await this.ensureFolder(runtime, paths);
      const sessionPath = record.sessionId
        ? runtime.join(paths.dirPath, conversationFileName(record.sessionId))
        : null;
      const startsConversation = !!sessionPath && record.startsConversation === true;
      let destination = runtime.join(paths.dirPath, BACKGROUND_FILE_NAME);
      let prelude = "";
      if (sessionPath) {
        await narrowExistingFile(runtime, sessionPath, getPosixOwnerUid(runtime));
        try {
          const stat = await runtime.stat(sessionPath);
          destination = sessionPath;
          this.fileBytes.set(sessionPath, stat.size);
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          if (startsConversation) {
            destination = sessionPath;
            const background = runtime.join(paths.dirPath, BACKGROUND_FILE_NAME);
            await narrowExistingFile(runtime, background, getPosixOwnerUid(runtime));
            try {
              prelude = matchingPrelude(await runtime.readFile(background, "utf8"), record);
            } catch (readError) {
              if (!isNotFoundError(readError)) throw readError;
            }
          }
        }
      }
      await narrowExistingFile(runtime, destination, getPosixOwnerUid(runtime));
      let size = this.fileBytes.get(destination);
      if (size === undefined) {
        try {
          size = (await runtime.stat(destination)).size;
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          size = 0;
        }
      }
      let payload = prelude;
      // Queue drops during a pending disk write must remain visible on the following record.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/658
      const dropped = this.droppedSinceLastWrite;
      if (dropped > 0) {
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
        payload += note;
      }
      payload += line;
      try {
        await runtime.appendFile(destination, payload, { encoding: "utf8", mode: LOG_FILE_MODE });
      } catch (error) {
        this.droppedSinceLastWrite += dropped;
        throw error;
      }
      size += byteLength(payload);
      this.fileBytes.set(destination, size);
      if (size > MAX_FILE_BYTES) await this.trimFile(runtime, destination);
      if (startsConversation) await pruneConversations(runtime, paths.dirPath, this.fileBytes);
    } catch {
      this.ensuredDirPath = null;
      this.fileBytes.clear();
    }
  }

  private async trimFile(runtime: NodeRuntime, filePath: string): Promise<void> {
    await narrowExistingFile(runtime, filePath, getPosixOwnerUid(runtime));
    const text = await runtime.readFile(filePath, "utf8");
    const compacted = fitConversationFrames(text, RETAINED_FILE_BYTES);
    await runtime.writeFile(filePath, compacted, { encoding: "utf8", mode: LOG_FILE_MODE });
    this.fileBytes.set(filePath, byteLength(compacted));
  }
}

function conversationFileName(sessionId: string): string {
  return `${SESSION_FILE_PREFIX}${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}${FILE_SUFFIX}`;
}

function sectionHeader(file: string): string {
  return JSON.stringify({ frameSink: "conversation", file }) + "\n";
}

function matchingPrelude(text: string, record: FrameRecord): string {
  return text
    .split("\n")
    .slice(0, -1)
    .filter((line) => {
      if (!line) return false;
      try {
        const parsed = JSON.parse(line) as { tag?: unknown; sessionId?: unknown };
        return parsed.tag === record.tag && parsed.sessionId === record.sessionId;
      } catch {
        return false;
      }
    })
    .map((line) => line + "\n")
    .join("");
}

async function listLogFiles(runtime: NodeRuntime, dirPath: string): Promise<string[]> {
  let names: string[];
  try {
    names = await runtime.readdir(dirPath);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  return names.filter(
    (name) =>
      name === BACKGROUND_FILE_NAME ||
      (name.startsWith(SESSION_FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
  );
}

async function newestConversationFiles(runtime: NodeRuntime, dirPath: string): Promise<string[]> {
  const files: { path: string; name: string; mtimeMs: number }[] = [];
  for (const name of await listLogFiles(runtime, dirPath)) {
    if (name === BACKGROUND_FILE_NAME) continue;
    const path = runtime.join(dirPath, name);
    await narrowExistingFile(runtime, path, getPosixOwnerUid(runtime));
    try {
      files.push({ path, name, mtimeMs: (await runtime.stat(path)).mtimeMs });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files.map((file) => file.path);
}

async function pruneConversations(
  runtime: NodeRuntime,
  dirPath: string,
  byteMap: Map<string, number>
): Promise<void> {
  for (const path of (await newestConversationFiles(runtime, dirPath)).slice(MAX_CONVERSATIONS)) {
    await narrowExistingFile(runtime, path, getPosixOwnerUid(runtime));
    await removeIfExists(runtime, path);
    byteMap.delete(path);
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
      stat: async (p) => {
        const st = await fs.stat(p);
        return { size: st.size, mtimeMs: st.mtimeMs };
      },
      readdir: fs.readdir,
      readFile: fs.readFile,
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
  } catch (error) {
    logWarn("[AgentMode] Could not remove a debug log file", error);
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
