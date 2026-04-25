import type {
  Client,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionId,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { logInfo, logWarn } from "@/logger";
import { App, FileSystemAdapter, normalizePath } from "obsidian";
import * as path from "node:path";

export interface PermissionPrompter {
  (req: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

export interface VaultClientHandlers {
  /** Routes a session/update to the right AgentSession. */
  onSessionUpdate: (sessionId: SessionId, update: SessionNotification) => void;
  /** Opens the permission UI; resolves with the user's choice. */
  requestPermission: PermissionPrompter;
}

/**
 * Implements the ACP `Client` interface against an Obsidian vault.
 *
 * - `readTextFile`/`writeTextFile` route through `app.vault.adapter`, with
 *   strict vault-relative path resolution. Out-of-vault paths are rejected
 *   with `invalidParams` so the agent gets a clear error.
 * - `sessionUpdate` is demultiplexed via `handlers.onSessionUpdate`.
 * - `requestPermission` defers to `handlers.requestPermission` which opens
 *   the modal UI.
 *
 * Terminal capabilities are deliberately *not* implemented — we don't
 * advertise the capability, and opencode falls back to its internal PTY.
 */
export class VaultClient implements Client {
  constructor(
    private readonly app: App,
    private readonly handlers: VaultClientHandlers
  ) {}

  async sessionUpdate(params: SessionNotification): Promise<void> {
    try {
      this.handlers.onSessionUpdate(params.sessionId, params);
    } catch (e) {
      logWarn(`[AgentMode] sessionUpdate handler threw`, e);
    }
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return this.handlers.requestPermission(params);
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const rel = this.resolveVaultRelative(params.path);
    const full = await this.app.vault.adapter.read(rel);
    const content = sliceLines(full, params.line ?? null, params.limit ?? null);
    logInfo(`[AgentMode] readTextFile ${rel} (${content.length} chars)`);
    return { content };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const rel = this.resolveVaultRelative(params.path);
    const adapter = this.app.vault.adapter;
    const dir = path.posix.dirname(rel);
    if (dir && dir !== "." && dir !== "/" && !(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
    await adapter.write(rel, params.content);
    logInfo(`[AgentMode] writeTextFile ${rel} (${params.content.length} chars)`);
    return {};
  }

  /**
   * Resolve `p` against the vault root. Returns a vault-relative,
   * forward-slashed path for `app.vault.adapter`. Throws
   * `RequestError.invalidParams` if the path escapes the vault.
   */
  private resolveVaultRelative(p: string): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw RequestError.invalidParams(
        undefined,
        "Agent Mode requires a FileSystemAdapter (desktop)."
      );
    }
    const vaultBase = path.resolve(adapter.getBasePath());
    const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(vaultBase, p);
    const rel = path.relative(vaultBase, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw RequestError.invalidParams(
        { path: p },
        `Path "${p}" is outside the vault and cannot be accessed by Agent Mode.`
      );
    }
    const normalized = normalizePath(rel.split(path.sep).join("/"));
    // Block dotfile dirs/files at the vault root (`.obsidian/`, `.copilot/`,
    // `.git/`, etc.). They contain plugin settings — including encrypted-at-
    // rest API keys, hotkey config, vault metadata — that the agent has no
    // business reading or writing without an explicit user-facing flow.
    const firstSegment = normalized.split("/")[0] ?? "";
    if (firstSegment.startsWith(".")) {
      throw RequestError.invalidParams(
        { path: p },
        `Path "${p}" is in a hidden directory (${firstSegment}) and is not accessible to Agent Mode.`
      );
    }
    return normalized;
  }
}

/**
 * Extract a 1-based line slice with an optional limit. Mirrors ACP's
 * `ReadTextFileRequest.{line, limit}` semantics: read N lines starting from
 * line `line`. Out-of-range starts return empty.
 */
export function sliceLines(content: string, line: number | null, limit: number | null): string {
  if (line == null && limit == null) return content;
  const lines = content.split("\n");
  const start = line != null ? Math.max(0, line - 1) : 0;
  const end = limit != null ? Math.min(lines.length, start + limit) : lines.length;
  if (start >= lines.length) return "";
  return lines.slice(start, end).join("\n");
}
