/** Stable identifier for a registered backend. New backends extend the registry; the type stays open. */
export type BackendId = string;

/**
 * Spawn descriptor for an ACP-speaking agent backend. Backends produce these
 * lazily because they may need to read settings (BYOK keys, MCP config) at
 * spawn time.
 */
export interface AcpSpawnDescriptor {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * One pluggable agent backend. Implementers (OpencodeBackend, future
 * ClaudeCodeBackend, etc.) own the spawn-time contract. The rest of Agent
 * Mode — AcpBackendProcess, AgentSession, VaultClient — stays
 * backend-agnostic.
 */
export interface AcpBackend {
  /** Stable identifier, used for logging and settings selection. */
  readonly id: BackendId;
  /** Human-readable name surfaced in the UI. */
  readonly displayName: string;
  /** Build the spawn descriptor (BYOK keys decrypted, env composed). */
  buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor>;
}

/**
 * Thrown by `AcpBackendProcess.setSessionModel` when the connected agent does
 * not implement `unstable_setSessionModel`. Callers should catch this and
 * degrade gracefully (e.g. disable the model picker).
 */
export class MethodUnsupportedError extends Error {
  constructor(method: string) {
    super(`Agent does not implement ${method}`);
    this.name = "MethodUnsupportedError";
  }
}

/** JSON-RPC standard "Method not found" error code. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
