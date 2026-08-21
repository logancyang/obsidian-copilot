/**
 * Sidecar logger and payload formatter shared by every backend's debug tap.
 * The ACP runtime (`acp/debugTap.ts`) and the SDK adapter
 * (`sdk/sdkDebugTap.ts`) both feed `frameSink` so JSON-RPC and SDK turns
 * land in the same NDJSON file. `tag` distinguishes the source.
 */

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

/** `lstat` result reduced to the fields the sink's path validation needs. */
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
  /** Current effective uid; absent on platforms without POSIX ownership (win32). */
  getuid?: () => number;
  openPath?: (path: string) => Promise<string | void>;
  showItemInFolder?: (path: string) => void;
}

export interface FrameSinkOptions {
  vaultBasePath?: string | null;
  runtime?: NodeRuntime | null;
}

/**
 * Vault base path seeded once at plugin load (see main.ts). The module-level
 * `frameSink` singleton can't take `app` at construction, so this provides the
 * base path it needs without reaching for the global `app`.
 */
let seededVaultBasePath: string | null = null;

/** Seed the vault base path used by the module-level `frameSink` singleton. */
export function setFrameSinkVaultBasePath(basePath: string | null): void {
  seededVaultBasePath = basePath;
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

  /** Ensure the log exists and open it with the desktop file handler. */
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

  /** Wait for all queued writes to settle. Intended for tests and tooling. */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  /**
   * Narrow logs an earlier build left readable by other local accounts, for
   * the one case ordinary logging never reaches.
   *
   * The narrowing inside `ensureFolder()` only runs from `append()`, `open()`,
   * or `clear()`, and `append()` is gated on the `debugFullFrames` toggle at
   * its call sites. Someone who logged under an older build and then turned
   * the toggle off would otherwise keep `0644` plaintext prompts on a shared
   * temp root indefinitely, since nothing would ever look at them again.
   * Deliberately does not create the directory chain: someone who never logs
   * must not get a temp directory made for them. Best effort — a log that
   * cannot be narrowed is left as the older build wrote it.
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
   * Establish the owner-only log location before any write or delete touches
   * it. Validates every level of the predictable temp-path chain top-down —
   * the sticky-bit parent only protects the first level, so an attacker who
   * pre-created an upper level would control everything beneath it — and
   * narrows both log generations left behind by older builds. Throws when the
   * location cannot be made safe; callers drop the operation.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/250
   */
  private async ensureFolder(runtime: NodeRuntime, paths: FrameLogPaths): Promise<void> {
    // DESIGN NOTE — the cache trusts "parents are 0700 and ours ⇒ contents
    // stay ours": replacing a validated level afterwards requires write access
    // inside an owner-only directory, or unlinking our entry under the
    // sticky-bit temp root, neither of which another local account has. A
    // first validation that finds a previously world-writable directory still
    // has an lstat-to-chmod window; closing it needs a held descriptor
    // (O_NOFOLLOW plus fchmod) rather than path-based calls, which this sink
    // deliberately does not use.
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

    // Cache only after the temp root and the complete directory chain pass validation.

    this.ensuredDirPath = paths.dirPath;
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
 * Create the log file owner-only when Open is used before anything has been
 * logged. A failure other than "not found" is rethrown rather than treated as
 * a missing file, so an unreadable path cannot be answered with a fresh file
 * at a location the caller never validated.
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
 * The uid every validated path must be owned by, or `null` where POSIX
 * ownership does not exist (win32) and the mode/owner narrowing is skipped —
 * per-user %TEMP% already isolates there, and losing the log to an
 * unenforceable check would be worse. A POSIX runtime that cannot report its
 * uid fails closed instead.
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
 * Validate the OS temp root before caching any derived frame-log path.
 *
 * Frame log security model (best-effort):
 *
 * Protects against:
 * - Symlink squatting at any path level
 * - Direct file replacement (TOCTOU mitigated by caching after validation)
 * - Accidental leaks in standard temp directories (Linux /tmp 1777, macOS per-user)
 *
 * Does NOT protect against:
 * - Non-standard TMPDIR in shared writable parent without sticky bit
 * - Anything the same account can do, including planting a FIFO at the log
 *   path so an append blocks (visible as a stalled log; delete it to recover)
 * - NFS/FUSE uid spoofing
 * - Kernel-level attacks
 *
 * Rationale: This is a debug log for developer troubleshooting. The attack
 * requires local multi-user access, non-standard temp config, vault hash knowledge,
 * and precise timing. Standard deployments (single-user desktop, container with
 * per-user temp) are not affected.
 *
 * If absolute security is required, disable frame logging via Settings → Advanced.
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
 * Make one level of the log path a real, owner-only directory. A symlink
 * squatting the level is unlinked and replaced rather than refused: it is the
 * redirect vector this validation exists to stop, deleting it loses no
 * content, and at the sticky-bit temp root the unlink of a foreign entry fails
 * and correctly aborts. Anything else occupying the path — a plain file, FIFO,
 * or a real directory owned by someone else — aborts instead, because it may
 * be content its owner still needs.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 */
async function ensurePrivateDirectory(
  runtime: NodeRuntime,
  path: string,
  ownerUid: number | null
): Promise<void> {
  // Inspect before creating: recursive mkdir throws EEXIST when a plain file
  // or dangling symlink squats the path, which would make the branches below
  // unreachable.
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
  // Creation mode only applies to new directories; existing ones from older
  // builds may be wide open, so narrow any permissions or special bits.
  if ((entry.mode & 0o7777) !== LOG_DIR_MODE) {
    await runtime.chmod(path, LOG_DIR_MODE);
  }
}

/**
 * Narrow a log file left behind by an older build to owner-only, unlinking a
 * planted symlink (the append that follows recreates a private regular file)
 * and refusing a file owned by someone else.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/250
 *
 * DESIGN NOTE — chmod stops future opens but cannot revoke a descriptor
 * another account opened while the file was still world-readable. Revoking
 * that would need a fresh inode, which either discards or copies the existing
 * diagnostic log, so the narrowing accepts it.
 *
 * DESIGN NOTE — this function does not check whether the target is a regular
 * file before chmod. A FIFO pre-planted by the current UID would pass the
 * owner check and block appendFile() waiting for a reader. Cross-UID planting
 * is prevented by the 0700 directory chain validated in ensureFolder(). Same-
 * UID processes are not part of the threat model: they can already read vault
 * files directly. Adding isFile() would complete the leaf regular-file
 * invariant but does not close a privilege-escalation path. The current
 * fire-and-forget append calling pattern limits the blast radius to stalled
 * frame writes, not session-wide hangs.
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
