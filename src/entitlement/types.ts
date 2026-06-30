/** Normalized subscription tier rank, ascending. */
export type EntitlementTier = "free" | "lite" | "plus" | "pro";

/** Server-granted capability flags. The server owns the plan→features policy. */
export type EntitlementFeature = "multi_agent" | "self_host";

/**
 * Claims carried by a server-signed entitlement token (JWS payload). The server
 * is the single source of truth for `tier` and `features`; the client only reads
 * them, never maps plan names. See the "Copilot Entitlement Token Design" doc.
 */
export interface EntitlementClaims {
  /** Account the token is bound to; must match the local `userId`. */
  user_id: string;
  /** Raw plan name, for display/telemetry only — never gated on. */
  plan: string;
  /** Normalized tier rank. */
  tier: EntitlementTier;
  /** Granted capabilities. */
  features: EntitlementFeature[];
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds — the offline trust window. */
  exp: number;
}
