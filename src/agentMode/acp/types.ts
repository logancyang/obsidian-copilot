import type { BackendId } from "@/agentMode/session/types";
import type { PlanUsageReading } from "@/agentMode/session/planUsage";

/**
 * Spawn descriptor for an ACP-speaking agent backend. Backends produce these
 * lazily because they may need to read settings (BYOK keys, backend config) at
 * spawn time.
 */
export interface AcpSpawnDescriptor {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * One ACP-track agent backend. Implementers (OpencodeBackend, CodexBackend,
 * etc.) own the spawn-time contract. The rest of Agent Mode —
 * `AcpBackendProcess`, `AgentSession`, `VaultClient` — stays
 * backend-agnostic.
 */
export interface AcpBackend {
  /** Stable identifier, used for logging and settings selection. */
  readonly id: BackendId;
  /** Human-readable name surfaced in the UI. */
  readonly displayName: string;
  /** Build the spawn descriptor (BYOK keys decrypted, env composed). */
  buildSpawnDescriptor(ctx: { vaultBasePath: string }): Promise<AcpSpawnDescriptor>;
  /** Return false to keep backend-owned agent-message text out of the session. */
  readonly shouldRouteAgentMessageText?: (text: string) => boolean;
  /**
   * Read the account's plan-cap utilization, for backends that have somewhere to read it
   * from. Optional because ACP has no session update for caps: a backend that reports
   * them at all reports them off the wire, in a way only that backend knows about.
   * Omitting this is how a backend says its caps are unavailable, and the meters stay off.
   *
   * Called at turn boundaries, so it must resolve rather than throw.
   */
  readPlanUsage?(): Promise<PlanUsageReading>;
  /**
   * Whether the account's plan caps meter a session currently on this model. Optional:
   * omitting it means they always do (a Claude or Codex login meters every model that
   * agent serves). A backend that routes to more than one billing source — opencode
   * serves Copilot Plus models next to BYOK ones — answers per model, so a session on
   * the user's own key shows no cap meters. Pure and synchronous: it is consulted every
   * time a cap snapshot is dispatched or the session's model changes.
   *
   * @param wireModelId - Model id as it travels to the agent, provider prefix included.
   *   Null when the session's model is not known yet, which must read as "not metered".
   */
  planUsageAppliesTo?(wireModelId: string | null | undefined): boolean;
  /**
   * Context window of a model the agent does not advertise one for, in tokens.
   *
   * Most agents report the window on the wire. Backends serving hosted models sometimes
   * cannot, and only the vendor's own catalog knows the number, so this lets that backend
   * supply it rather than the meter falling back to a bare token count.
   *
   * @param wireModelId - Model id as it travels to the agent, provider prefix included.
   */
  readContextWindow?(wireModelId: string | null | undefined): Promise<number | null>;
}
