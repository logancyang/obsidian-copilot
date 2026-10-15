import { logWarn } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface FrameRecord {
  ts: string;
  dir: "→" | "←";
  tag: string;
  kind: "request" | "notif" | "result" | "error" | "raw";
  method: string;
  id: string | null;
  payload: unknown;
  sessionId?: string | null;
}

const LEGACY_LOG_FILE_NAMES = ["acp-frames.ndjson", "acp-frames.old.ndjson"];
const SESSION_FILE_PREFIX = "session-";
const FILE_SUFFIX = ".ndjson";
const BACKGROUND_FILE_NAME = "background.ndjson";
const STATE_METHOD = "frameSink.state";
const MAX_CONVERSATIONS = 5;
const DESKTOP_UNAVAILABLE_PATH = "(Agent Mode frame logs are desktop-only)";
const LOG_DIR_PREFIX = ["obsidian-copilot", "acp-frames"] as const;
// Owner-only modes: the log holds full prompt/tool/note content in plaintext,
// and on Linux os.tmpdir() can be a world-readable shared /tmp.
// https://github.com/logancyang/obsidian-copilot-preview/issues/250
const LOG_DIR_MODE = 0o700;
const LOG_FILE_MODE = 0o600;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const KEEP_HEAD_BYTES = 1024 * 1024;
const KEEP_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_QUEUE_FRAMES = 32;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_CHARS = 400;

export interface FrameLogPaths {
  dirPath: string;
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
  private pendingFrames = 0;
  private pendingBytes = 0;
  private droppedSinceLastWrite = 0;
  private readonly fileBytes = new Map<string, number>();
  private readonly conversationState = new Map<string, ConversationState>();
  private readonly probeSessions = new Set<string>();
  private readonly pruned = new Set<string>();

  constructor(private readonly options: FrameSinkOptions = {}) {}

  getPath(): string {
    return this.resolvePaths()?.dirPath ?? DESKTOP_UNAVAILABLE_PATH;
  }

  /**
   * The model probe replays a stored session at every backend start; its frames go to the
   * background file so they never take a place among the newest conversations.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/658
   */
  markProbeSession(sessionId: string): void {
    this.probeSessions.add(sessionId);
    const paths = this.resolvePaths();
    const runtime = this.getRuntime();
    if (!paths || !runtime) return;
    const filePath = runtime.join(paths.dirPath, conversationFileName(sessionId));
    this.writeChain = this.writeChain.then(async () => {
      this.fileBytes.delete(filePath);
      await removeIfExists(runtime, filePath);
    });
  }

  append(record: FrameRecord): void {
    const paths = this.resolvePaths();
    if (!paths) return;

    const sessionId =
      record.sessionId && !this.probeSessions.has(record.sessionId) ? record.sessionId : null;
    let line = this.toLine(record);
    if (sessionId) line += this.stateLine(sessionId, record);

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
      .then(() => this.doAppend(paths, sessionId, line, isPromptRequest(record)))
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
      for (const name of await listLogFiles(runtime, paths.dirPath)) {
        await removeIfExists(runtime, runtime.join(paths.dirPath, name));
      }
      this.fileBytes.clear();
      this.pruned.clear();
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

  /**
   * Runs the owner and mode checks of `ensureFolder()` so a reader cannot be handed files
   * another account planted on a shared temp root; null when the folder cannot be vouched for
   * or holds no conversation. The text is the retained conversations, oldest first.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/250
   */
  async readConversations(): Promise<string | null> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      if (!paths) return null;
      const runtime = this.getRuntime();
      if (!runtime) return null;
      await this.ensureFolder(runtime, paths);
      const names = await newestConversationFiles(runtime, paths.dirPath);
      const parts: string[] = [];
      for (const name of names.reverse()) {
        const text = await runtime.readFile(runtime.join(paths.dirPath, name), "utf8");
        if (text)
          parts.push(JSON.stringify({ frameSink: "conversation", file: name }) + "\n" + text);
      }
      return parts.length > 0 ? parts.join("") : null;
    });
    const settled = task.catch(() => null);
    this.writeChain = settled.then(() => {});
    return settled;
  }

  /**
   * Deletes the single-file logs an older build wrote; they hold every conversation in one
   * file and may be world-readable. Skipped when the folder is not a real directory of this user.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/658
   */
  async removeLegacyLogs(): Promise<void> {
    const task = this.writeChain.then(async () => {
      const paths = this.resolvePaths();
      const runtime = this.getRuntime();
      if (!paths || !runtime) return;
      try {
        const entry = await runtime.lstat(paths.dirPath);
        const ownerUid = getPosixOwnerUid(runtime);
        if (entry.isSymbolicLink || !entry.isDirectory) return;
        if (ownerUid !== null && entry.uid !== ownerUid) return;
        for (const name of LEGACY_LOG_FILE_NAMES) {
          await removeIfExists(runtime, runtime.join(paths.dirPath, name));
        }
      } catch (error) {
        if (!isNotFoundError(error))
          logWarn("[AgentMode] Could not remove legacy debug logs", error);
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

  private stateLine(sessionId: string, record: FrameRecord): string {
    const found = modelModeOf(record.payload);
    if (!found) return "";
    const prior = this.conversationState.get(sessionId);
    const next = { ...prior, ...found };
    if (prior?.model === next.model && prior?.mode === next.mode) return "";
    this.conversationState.set(sessionId, next);
    return this.toLine({
      ...record,
      dir: "→",
      tag: "frameSink",
      kind: "raw",
      method: STATE_METHOD,
      id: null,
      payload: next,
    });
  }

  private async doAppend(
    paths: FrameLogPaths,
    sessionId: string | null,
    line: string,
    isPrompt: boolean
  ): Promise<void> {
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

    const name = sessionId ? conversationFileName(sessionId) : BACKGROUND_FILE_NAME;
    const filePath = runtime.join(paths.dirPath, name);
    try {
      await this.ensureFolder(runtime, paths);
      await runtime.appendFile(filePath, payload, {
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

    try {
      const known = this.fileBytes.get(filePath);
      const size =
        known === undefined ? (await runtime.stat(filePath)).size : known + payload.length;
      this.fileBytes.set(filePath, size);
      if (size > MAX_FILE_BYTES) await this.trimFile(runtime, filePath);
      if (sessionId && isPrompt && !this.pruned.has(name)) {
        this.pruned.add(name);
        await this.pruneConversations(runtime, paths.dirPath);
      }
    } catch (error) {
      logWarn("[AgentMode] Could not trim the debug logs", error);
    }
  }

  /**
   * Keeps a conversation's first frames and its newest ones, plus every model and mode line
   * from the part cut out, so the file still says which model and mode the chat ran with.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/658
   */
  private async trimFile(runtime: NodeRuntime, filePath: string): Promise<void> {
    const lines = (await runtime.readFile(filePath, "utf8")).split("\n").filter(Boolean);
    let head = 0;
    for (let bytes = 0; head < lines.length && bytes < KEEP_HEAD_BYTES; head++) {
      bytes += lines[head].length + 1;
    }
    let tail = lines.length;
    for (let bytes = 0; tail > head && bytes < KEEP_TAIL_BYTES; ) {
      bytes += lines[--tail].length + 1;
    }
    const cut = lines.slice(head, tail);
    const kept = [
      ...lines.slice(0, head),
      JSON.stringify({ frameSink: "elided", frames: cut.length }),
      ...cut.filter((l) => l.includes(`"method":"${STATE_METHOD}"`)),
      ...lines.slice(tail),
    ];
    const text = kept.join("\n") + "\n";
    await runtime.writeFile(filePath, text, { encoding: "utf8", mode: LOG_FILE_MODE });
    this.fileBytes.set(filePath, text.length);
  }

  private async pruneConversations(runtime: NodeRuntime, dirPath: string): Promise<void> {
    const names = await newestConversationFiles(runtime, dirPath);
    for (const name of names.slice(MAX_CONVERSATIONS)) {
      const filePath = runtime.join(dirPath, name);
      this.fileBytes.delete(filePath);
      this.pruned.delete(name);
      await removeIfExists(runtime, filePath);
    }
  }
}

interface ConversationState {
  model?: string;
  mode?: string;
}

function conversationFileName(sessionId: string): string {
  return `${SESSION_FILE_PREFIX}${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}${FILE_SUFFIX}`;
}

function isPromptRequest(record: FrameRecord): boolean {
  return (
    record.dir === "→" && record.kind === "request" && /^(session\/)?prompt$/.test(record.method)
  );
}

async function listLogFiles(runtime: NodeRuntime, dirPath: string): Promise<string[]> {
  try {
    return (await runtime.readdir(dirPath)).filter(
      (name) =>
        name === BACKGROUND_FILE_NAME ||
        (name.startsWith(SESSION_FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
    );
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function newestConversationFiles(runtime: NodeRuntime, dirPath: string): Promise<string[]> {
  const names = (await listLogFiles(runtime, dirPath)).filter((n) => n !== BACKGROUND_FILE_NAME);
  const stamped = await Promise.all(
    names.map(async (name) => ({
      name,
      mtimeMs: (await runtime.stat(runtime.join(dirPath, name))).mtimeMs,
    }))
  );
  return stamped.sort((a, b) => b.mtimeMs - a.mtimeMs).map((f) => f.name);
}

function modelModeOf(payload: unknown): ConversationState | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const body = (root.update && typeof root.update === "object" ? root.update : root) as Record<
    string,
    unknown
  >;
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const nested = (key: string, field: string) => {
    const v = body[key];
    return v && typeof v === "object" ? text((v as Record<string, unknown>)[field]) : undefined;
  };
  let model = text(body.modelId) ?? text(body.currentModelId) ?? nested("models", "currentModelId");
  let mode = text(body.modeId) ?? text(body.currentModeId) ?? nested("modes", "currentModeId");
  if (Array.isArray(body.configOptions)) {
    for (const option of body.configOptions as Record<string, unknown>[]) {
      const kind = option?.category ?? option?.id;
      if (kind === "model") model = text(option.currentValue) ?? model;
      if (kind === "mode") mode = text(option.currentValue) ?? mode;
    }
  }
  if (!model && !mode) return null;
  return { ...(model && { model }), ...(mode && { mode }) };
}

export function getFrameLogPaths(vaultBasePath: string, runtime: NodeRuntime): FrameLogPaths {
  const vaultHash = stableHash(vaultBasePath);
  const dirPath = runtime.join(runtime.tmpdir(), ...LOG_DIR_PREFIX, vaultHash);
  return { dirPath };
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
