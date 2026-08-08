/**
 * One-time migration (settings v5): stamp an explicit `Provider.requiresApiKey`
 * on every row persisted before the flag existed.
 *
 * "Does this provider need an API key" is an authoritative, persisted flag —
 * never inferred from self-hosting at runtime (self-hosted ≠ keyless). Every
 * creation path now writes it (BYOK setup, agent setup, Plus sign-in), so the
 * only flagless rows are legacy ones. This backfill resolves them by identity
 * once, here, so the runtime read point (`providerRequiresApiKey`) can be a
 * pure flag read with no heuristic fallback.
 *
 * This is the ONLY place the identity heuristic lives — relocated from the old
 * runtime `legacyResolveRequiresApiKey`. A one-time migration is where a
 * heuristic is acceptable; the runtime criteria is always the explicit flag.
 */

import { isSelfHostedProvider } from "@/modelManagement";
import type { Provider } from "@/modelManagement";

/**
 * Resolve `requiresApiKey` for a flagless row by provider identity. Defaults to
 * `true` when unknown so a key-gated provider is never silently treated as
 * keyless (which would drop its models downstream).
 */
function resolveByIdentity(provider: Provider): boolean {
  switch (provider.origin.kind) {
    case "agent":
      // Agent-owned providers route through the agent's own auth (native /
      // CLI-managed); the user never supplies a BYOK key for them.
      return false;
    case "copilot-plus":
      // Provisioned by Plus sign-in, not a user-entered key.
      return false;
    case "byok":
      // Catalog-backed BYOK providers are hosted clouds — all require a key.
      if (provider.origin.catalogProviderId) return true;
      // Catalog-less BYOK: a self-hosted runner (Ollama / LM Studio / local
      // proxy) commonly runs key-less; anything else (custom hosted proxy)
      // needs one.
      return !isSelfHostedProvider(provider);
    default:
      return true;
  }
}

/**
 * Pure planner: returns a new `providers` map with `requiresApiKey` backfilled
 * on every flagless row, or `null` when nothing changed (so the caller can skip
 * a redundant write — referential stability, see AGENTS.md).
 */
export function planRequiresApiKeyBackfill(
  providers: Record<string, Provider>
): Record<string, Provider> | null {
  let changed = false;
  const next: Record<string, Provider> = {};
  for (const [id, provider] of Object.entries(providers)) {
    if (provider.requiresApiKey === undefined) {
      next[id] = { ...provider, requiresApiKey: resolveByIdentity(provider) };
      changed = true;
    } else {
      next[id] = provider;
    }
  }
  return changed ? next : null;
}
