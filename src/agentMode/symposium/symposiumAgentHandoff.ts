import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import * as path from "node:path";

import { SYMPOSIUM_AGENT_HANDOFF_DIR, SYMPOSIUM_MAX_HTML_BYTES } from "@/symposium/constants";

/** Signals that a filesystem-backed agent handoff cannot be read safely. */
class SymposiumAgentHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymposiumAgentHandoffError";
    Object.setPrototypeOf(this, SymposiumAgentHandoffError.prototype);
  }
}

interface ResolvedStagedFile {
  readonly stagedPath: string;
  readonly stats: Stats;
}

const UNSAFE_ROOT_MESSAGE =
  "The Symposium handoff folder must be an ordinary directory inside the current vault.";
const UNSAFE_FILE_MESSAGE =
  "Staged Symposium HTML must be an ordinary file inside the vault handoff folder.";

/**
 * Compares canonical paths using the owning platform's case semantics.
 *
 * @param left The first absolute path.
 * @param right The second absolute path.
 */
function isSamePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

/**
 * Reports whether a candidate is a strict descendant of an owning directory.
 *
 * @param owner The canonical owning directory.
 * @param candidate The canonical candidate path.
 */
function isStrictDescendant(owner: string, candidate: string): boolean {
  const relative = path.relative(owner, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Reports whether two stat results describe the same unchanged file.
 *
 * @param left The first stat result.
 * @param right The second stat result.
 */
function isSameFile(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs
  );
}

/**
 * Reports whether metadata describes one ordinary, single-link file.
 *
 * @param stats Metadata read for the staged entry or its pinned handle.
 */
function isOrdinaryFile(stats: Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1;
}

/**
 * Resolves one direct handoff file below the real vault root without following
 * linked handoff or final path components.
 *
 * @param vaultRootAbs The absolute desktop vault root.
 * @param stagedHtmlPath The vault-relative handoff path.
 */
async function resolveStagedFile(
  vaultRootAbs: string,
  stagedHtmlPath: string
): Promise<ResolvedStagedFile> {
  const prefix = `${SYMPOSIUM_AGENT_HANDOFF_DIR}/`;
  const fileName = stagedHtmlPath.startsWith(prefix) ? stagedHtmlPath.slice(prefix.length) : "";
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }

  let handoffRoot: string;
  try {
    const vaultRoot = await realpath(vaultRootAbs);
    handoffRoot = path.resolve(vaultRoot, ...SYMPOSIUM_AGENT_HANDOFF_DIR.split("/"));
    const rootStats = await lstat(handoffRoot);
    const realHandoffRoot = await realpath(handoffRoot);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !isSamePath(handoffRoot, realHandoffRoot) ||
      !isStrictDescendant(vaultRoot, handoffRoot)
    ) {
      throw new Error("unsafe handoff root");
    }
  } catch {
    throw new SymposiumAgentHandoffError(UNSAFE_ROOT_MESSAGE);
  }

  const stagedPath = path.join(handoffRoot, fileName);
  try {
    const stats = await lstat(stagedPath);
    const realStagedPath = await realpath(stagedPath);
    if (
      !isOrdinaryFile(stats) ||
      !isSamePath(stagedPath, realStagedPath) ||
      !isStrictDescendant(handoffRoot, stagedPath)
    ) {
      throw new Error("unsafe staged file");
    }
    return { stagedPath, stats };
  } catch {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }
}

/**
 * Reads exactly the already-bounded file size and verifies that no extra byte exists.
 *
 * @param handle The pinned staged file handle.
 * @param size The validated byte size to allocate and read.
 */
async function readExactBytes(handle: FileHandle, size: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  const probe = new Uint8Array(1);
  const extra = await handle.read(probe, 0, 1, size);
  if (offset !== size || extra.bytesRead !== 0) {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }
  return bytes;
}

/**
 * Decodes bytes without replacement or normalization and verifies the UTF-8 round trip.
 *
 * @param bytes The exact staged file bytes.
 */
function decodeExactUtf8(bytes: Uint8Array): string {
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SymposiumAgentHandoffError("Staged Symposium HTML must be valid UTF-8.");
  }
  const encoded = new TextEncoder().encode(html);
  if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) {
    throw new SymposiumAgentHandoffError("Staged Symposium HTML must be valid UTF-8.");
  }
  return html;
}

/**
 * Reads one bounded staged artifact through a pinned handle. The invoking
 * wrapper owns deletion so agent-created paths are never removed with host privileges.
 *
 * @param vaultRootAbs The absolute desktop vault root.
 * @param stagedHtmlPath The normalized vault-relative staging path.
 */
export async function consumeSymposiumAgentHandoff(
  vaultRootAbs: string,
  stagedHtmlPath: string
): Promise<string> {
  const resolved = await resolveStagedFile(vaultRootAbs, stagedHtmlPath);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle: FileHandle;
  try {
    handle = await open(resolved.stagedPath, constants.O_RDONLY | noFollow);
  } catch {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }

  try {
    const openedStats = await handle.stat();
    if (!isOrdinaryFile(openedStats) || !isSameFile(openedStats, resolved.stats)) {
      throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
    }
    if (openedStats.size > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumAgentHandoffError(
        `Symposium HTML is ${openedStats.size} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    }

    const bytes = await readExactBytes(handle, openedStats.size);
    const finalStats = await handle.stat();
    if (!isOrdinaryFile(finalStats) || !isSameFile(openedStats, finalStats)) {
      throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
    }
    return decodeExactUtf8(bytes);
  } finally {
    await handle.close();
  }
}
