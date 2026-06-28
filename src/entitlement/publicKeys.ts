/**
 * Public keys that verify entitlement tokens, keyed by the token header's `kid`
 * so a new signing key can roll out before old tokens expire. These are PUBLIC
 * (verify-only) — safe to ship in open-source client code; they grant no power
 * to mint tokens.
 *
 * TODO(entitlement): populate with the real server key(s) when the `/license`
 * token-signing change ships. Until then this is empty, so `verifyEntitlement`
 * returns null for any token and the no-token fallback in `plusUtils` governs
 * (existing behavior preserved). See the "Copilot Entitlement Token Design" doc
 * and obsidian-copilot-preview#201.
 */
export const ENTITLEMENT_PUBLIC_KEYS: Record<string, JsonWebKey> = {};
