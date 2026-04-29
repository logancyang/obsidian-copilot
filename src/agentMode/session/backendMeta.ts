/**
 * Normalized hints derived from a backend's vendor `_meta` payload on a
 * tool_call or tool_call_update notification. Each backend's parser maps its
 * own vendor shape into this surface; downstream session/UI code reads only
 * these normalized fields.
 *
 * Add a field here only when at least one consumer (session or UI) actually
 * branches on it — premature normalization invents fields backends don't
 * really emit.
 */
export interface NormalizedToolCallMeta {
  /** Vendor-original tool identity, e.g. "ExitPlanMode", "Bash", "Glob". */
  vendorToolName?: string;
  /** True iff this tool call is the agent's plan-finalization signal. */
  isPlanProposal?: boolean;
  /** Parent tool-call id, for nested tools (e.g. Claude's Task subagents). */
  parentToolCallId?: string;
}

/**
 * Per-backend strategy for turning vendor `_meta` into normalized hints.
 * Each backend declares one of these in its descriptor; the session layer
 * never reads vendor shapes directly.
 */
export interface BackendMetaParser {
  parseToolCallMeta(meta: unknown): NormalizedToolCallMeta | null;
}

/** Fallback parser: returns null. Used by backends with no vendor meta. */
export const noopBackendMetaParser: BackendMetaParser = {
  parseToolCallMeta: () => null,
};
