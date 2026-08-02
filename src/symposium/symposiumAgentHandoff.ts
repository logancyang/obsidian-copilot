import { lstat, readFile, unlink } from "node:fs/promises";
import * as path from "node:path";

import { SYMPOSIUM_AGENT_HANDOFF_DIR, SYMPOSIUM_MAX_HTML_BYTES } from "@/symposium/constants";

/** Signals that a filesystem-backed agent handoff cannot be consumed safely. */
class SymposiumAgentHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SymposiumAgentHandoffError";
    Object.setPrototypeOf(this, SymposiumAgentHandoffError.prototype);
  }
}

const UNSAFE_ROOT_MESSAGE =
  "The Symposium handoff folder must be an ordinary directory inside the current vault.";
const UNSAFE_FILE_MESSAGE =
  "Staged Symposium HTML must be one ordinary .html file inside the vault handoff folder.";
const CLEANUP_FAILED_MESSAGE = "Copilot could not remove the staged Symposium HTML.";

function getDirectHandoffName(stagedHtmlPath: string): string {
  const prefix = `${SYMPOSIUM_AGENT_HANDOFF_DIR}/`;
  const fileName = stagedHtmlPath.startsWith(prefix) ? stagedHtmlPath.slice(prefix.length) : "";
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !fileName.toLowerCase().endsWith(".html")
  ) {
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  }
  return fileName;
}

async function getHandoffRoot(vaultRootAbs: string): Promise<string> {
  const symposiumRoot = path.resolve(vaultRootAbs, ".symposium");
  const handoffRoot = path.join(symposiumRoot, "handoffs");
  try {
    const [symposiumStats, handoffStats] = await Promise.all([
      lstat(symposiumRoot),
      lstat(handoffRoot),
    ]);
    if (!symposiumStats.isDirectory() || !handoffStats.isDirectory()) {
      throw new Error("unsafe handoff root");
    }
  } catch {
    throw new SymposiumAgentHandoffError(UNSAFE_ROOT_MESSAGE);
  }
  return handoffRoot;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SymposiumAgentHandoffError("Staged Symposium HTML must be valid UTF-8.");
  }
}

async function removeHandoff(stagedPath: string): Promise<void> {
  try {
    await unlink(stagedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new SymposiumAgentHandoffError(CLEANUP_FAILED_MESSAGE);
    }
  }
}

/**
 * Reads one bounded handoff exactly once and removes it before review can open,
 * so every later publish, cancel, regenerate, or failure outcome is already clean.
 *
 * @param vaultRootAbs The absolute desktop vault root that owns the handoff.
 * @param stagedHtmlPath The normalized vault-relative staged HTML path.
 */
export async function consumeSymposiumAgentHandoff(
  vaultRootAbs: string,
  stagedHtmlPath: string
): Promise<string> {
  const fileName = getDirectHandoffName(stagedHtmlPath);
  const handoffRoot = await getHandoffRoot(vaultRootAbs);
  const stagedPath = path.join(handoffRoot, fileName);

  try {
    const stats = await lstat(stagedPath);
    if (!stats.isFile()) {
      throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
    }
    if (stats.size > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumAgentHandoffError(
        `Symposium HTML is ${stats.size} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    }

    const bytes = await readFile(stagedPath);
    if (bytes.byteLength > SYMPOSIUM_MAX_HTML_BYTES) {
      throw new SymposiumAgentHandoffError(
        `Symposium HTML is ${bytes.byteLength} bytes; the limit is ${SYMPOSIUM_MAX_HTML_BYTES} bytes.`
      );
    }
    return decodeUtf8(Uint8Array.from(bytes));
  } catch (error) {
    if (error instanceof SymposiumAgentHandoffError) throw error;
    throw new SymposiumAgentHandoffError(UNSAFE_FILE_MESSAGE);
  } finally {
    await removeHandoff(stagedPath);
  }
}
