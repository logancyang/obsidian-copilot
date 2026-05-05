import { COPILOT_FOLDER_ROOT } from "@/constants";
import { ensureFolderExists } from "@/utils";
import { TFile } from "obsidian";

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

const LOG_PATH = `${COPILOT_FOLDER_ROOT}/acp-frames.ndjson`;
const ROTATED_PATH = `${COPILOT_FOLDER_ROOT}/acp-frames.old.ndjson`;
const ROTATE_BYTES = 50 * 1024 * 1024;
const ROTATE_CHECK_EVERY = 100;
const MAX_PAYLOAD_CHARS = 400;

/**
 * Sidecar logger for full backend frames. Writes are append-only NDJSON to
 * keep the file grep/jq-friendly. Writes are serialized through a single
 * promise chain so concurrent calls don't interleave partial lines.
 *
 * Rotation: every ROTATE_CHECK_EVERY writes, stat the file; if it exceeds
 * ROTATE_BYTES, rename to `.old.ndjson` (overwriting any prior `.old`) and
 * start a fresh file. Bounds disk use without losing the most recent session.
 */
class FrameSink {
  private writeChain: Promise<void> = Promise.resolve();
  private folderEnsured = false;
  private writeCount = 0;

  getPath(): string {
    return LOG_PATH;
  }

  /** Schedule a write. Returns immediately; failures are swallowed. */
  append(record: FrameRecord): void {
    this.writeChain = this.writeChain.then(() => this.doAppend(record)).catch(() => {});
  }

  async clear(): Promise<void> {
    const task = this.writeChain.then(async () => {
      if (!this.hasVault()) return;
      await removeIfExists(LOG_PATH);
      await removeIfExists(ROTATED_PATH);
    });
    this.writeChain = task.catch(() => {});
    return task;
  }

  async open(): Promise<void> {
    const task = this.writeChain.then(async () => {
      if (!this.hasVault()) return;
      await this.ensureFolder();
      if (!(await app.vault.adapter.exists(LOG_PATH))) {
        await app.vault.adapter.write(LOG_PATH, "");
      }
    });
    this.writeChain = task.catch(() => {});
    await task;
    if (!this.hasVault()) return;
    const file = app.vault.getAbstractFileByPath(LOG_PATH);
    if (file instanceof TFile) {
      await app.workspace.getLeaf(true).openFile(file);
    }
  }

  private hasVault(): boolean {
    return typeof app !== "undefined" && !!app.vault?.adapter;
  }

  private async ensureFolder(): Promise<void> {
    if (this.folderEnsured) return;
    await ensureFolderExists(COPILOT_FOLDER_ROOT);
    this.folderEnsured = true;
  }

  private async doAppend(record: FrameRecord): Promise<void> {
    if (!this.hasVault()) return;
    let line: string;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      // Payload not serializable (e.g. circular). Fall back to a stub so the
      // frame still shows up in the log.
      line =
        JSON.stringify({
          ...record,
          payload: { __unserializable: true },
        }) + "\n";
    }

    try {
      await this.ensureFolder();
      await app.vault.adapter.append(LOG_PATH, line);
    } catch {
      // Adapter `append` fails if the file is missing on some platforms; fall
      // back to write.
      try {
        await app.vault.adapter.write(LOG_PATH, line);
      } catch {
        return;
      }
    }

    this.writeCount++;
    if (this.writeCount % ROTATE_CHECK_EVERY === 0) {
      await this.maybeRotate();
    }
  }

  private async maybeRotate(): Promise<void> {
    try {
      const stat = await app.vault.adapter.stat(LOG_PATH);
      if (!stat || stat.size < ROTATE_BYTES) return;
      await removeIfExists(ROTATED_PATH);
      await app.vault.adapter.rename(LOG_PATH, ROTATED_PATH);
    } catch {
      // ignore
    }
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await app.vault.adapter.remove(path);
  } catch {
    // ignore — file already gone or adapter unavailable
  }
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
    s = String(value);
  }
  if (s.length <= MAX_PAYLOAD_CHARS) return s;
  return s.slice(0, MAX_PAYLOAD_CHARS) + `…(+${s.length - MAX_PAYLOAD_CHARS})`;
}
