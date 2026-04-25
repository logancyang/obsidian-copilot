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
 * One pluggable agent backend. v1 ships only `OpencodeBackend`; future
 * backends (Claude Code, Codex) implement this same interface so the rest of
 * the Agent Mode plumbing — AcpBackendProcess, AgentSession, VaultClient —
 * stays backend-agnostic.
 */
export interface AcpBackend {
  /** Stable identifier, used for logging and settings selection. */
  readonly id: "opencode" | "claude-code" | "codex";
  /** Human-readable name surfaced in the UI. */
  readonly displayName: string;
  /** Build the spawn descriptor (BYOK keys decrypted, env composed). */
  buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor>;
}
