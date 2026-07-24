import { FileError, JsonlSessionStorage, Session } from "@earendil-works/pi-agent-core";
import type { PiFileStore } from "@/pi/types";

/** Folder name transcripts live under, inside the plugin's own data folder. */
export const PI_SESSIONS_FOLDER = "pi-sessions";

/** The subset of pi's `FileSystem` that `JsonlSessionStorage` actually calls. */
type JsonlFileSystem = Parameters<typeof JsonlSessionStorage.open>[0];

/**
 * Path of one conversation's transcript.
 *
 * @param dir the transcript folder, resolved by the host from the vault's
 * configurable config directory
 */
export function piSessionPath(dir: string, sessionId: string): string {
  return `${dir}/${sessionId}.jsonl`;
}

/**
 * Adapt a vault-backed file store to the filesystem pi's JSONL session storage
 * expects. Obsidian's adapter is the only file API available on every
 * platform, so routing transcripts through it is what keeps resume working
 * off the desktop. Errors are converted into pi's `Result` shape rather than
 * thrown, which is how pi distinguishes "no transcript yet" from a real fault.
 *
 * @param store the vault adapter operations, injected so this module stays testable
 */
export function createPiFileSystem(store: PiFileStore): JsonlFileSystem {
  return {
    readTextFile: async (path: string) => {
      try {
        return { ok: true as const, value: await store.read(path) };
      } catch (error) {
        return { ok: false as const, error: toFileError(error, path) };
      }
    },
    readTextLines: async (path: string, options?: { maxLines?: number }) => {
      try {
        const lines = (await store.read(path)).split("\n");
        const limited = options?.maxLines ? lines.slice(0, options.maxLines) : lines;
        return { ok: true as const, value: limited };
      } catch (error) {
        return { ok: false as const, error: toFileError(error, path) };
      }
    },
    writeFile: async (path: string, content: string | Uint8Array) => {
      try {
        await store.mkdir(store.dir);
        await store.write(path, asText(content));
        return { ok: true as const, value: undefined };
      } catch (error) {
        return { ok: false as const, error: toFileError(error, path) };
      }
    },
    appendFile: async (path: string, content: string | Uint8Array) => {
      try {
        await store.mkdir(store.dir);
        await store.append(path, asText(content));
        return { ok: true as const, value: undefined };
      } catch (error) {
        return { ok: false as const, error: toFileError(error, path) };
      }
    },
  };
}

function asText(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

function toFileError(error: unknown, path: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /not exist|not found|ENOENT/i.test(message) ? "not_found" : "unknown";
  return new FileError(code, message, path);
}

/**
 * Open the conversation whose transcript is already on disk, so a resumed chat
 * continues with the history the model previously saw.
 *
 * @param store vault adapter operations
 * @param sessionId the conversation to reopen
 */
export async function openPiSession(store: PiFileStore, sessionId: string): Promise<Session> {
  const storage = await JsonlSessionStorage.open(
    createPiFileSystem(store),
    piSessionPath(store.dir, sessionId)
  );
  return new Session(storage);
}

/**
 * Start a new conversation whose transcript is written as it goes.
 *
 * @param store vault adapter operations
 * @param sessionId the conversation to create
 */
export async function createPiSession(store: PiFileStore, sessionId: string): Promise<Session> {
  const storage = await JsonlSessionStorage.create(
    createPiFileSystem(store),
    piSessionPath(store.dir, sessionId),
    { cwd: store.dir, sessionId }
  );
  return new Session(storage);
}
